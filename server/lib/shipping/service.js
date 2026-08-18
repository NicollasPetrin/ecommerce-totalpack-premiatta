import { many, one, transaction } from '../../db/pool.js'
import { config } from '../../config.js'
import { getShippingProvider } from './index.js'
import { avisarPedidoEnviado } from '../email/service.js'

/**
 * Cotação para a loja: quanto o cliente vai pagar de frete.
 *
 * As medidas vêm sempre do banco, nunca do navegador — quem manda o peso
 * decide o preço, e isso é a mesma classe de furo que deixar o navegador
 * mandar o preço do produto.
 *
 * Devolve `{ options, erro }` em vez de lançar: erro de cotação é resposta
 * legítima para o cliente ("não entregamos aí"), não falha do servidor.
 */
export async function quoteForCart({ cep, itens }) {
  const destino = String(cep ?? '').replace(/\D/g, '')
  if (destino.length !== 8) return { options: [], erro: 'CEP incompleto.' }
  if (!itens.length) return { options: [], erro: 'Sacola vazia.' }

  const cfg = await one(`SELECT * FROM settings WHERE id = true`)
  if (!cfg.sender_cep) {
    return { options: [], erro: 'A loja ainda não configurou o endereço de origem.' }
  }

  /* Produto sem medida não pode ser cotado. Cair num valor padrão faria a
     loja cobrar um frete e pagar outro, sem ninguém perceber. */
  const semMedida = itens.filter(
    (i) => !i.weightG || !i.lengthCm || !i.widthCm || !i.heightCm,
  )
  if (semMedida.length) {
    return {
      options: [],
      erro: 'Um dos itens está sem peso ou medidas cadastradas.',
      detalhe: semMedida.map((i) => i.name),
    }
  }

  try {
    const servicos = await getShippingProvider(config.shippingProvider).cotar({
      remetente: { cep: cfg.sender_cep },
      destinatario: { cep: destino },
      itens,
    })

    if (!servicos.length) return { options: [], erro: 'Nenhuma transportadora atende este CEP.' }
    return { options: servicos }
  } catch (err) {
    console.error('[frete] cotação falhou:', err.message, err.body ?? '')
    return {
      options: [],
      erro: 'Não foi possível calcular o frete agora. Tente em instantes.',
      /* A causa real vai junto, mas só o admin recebe (ver a rota). O cliente
         não tem o que fazer com "401 Unauthenticated", e a mensagem da
         transportadora pode revelar detalhe da conta. */
      causa: err.message,
      corpo: err.body ?? null,
    }
  }
}

/**
 * Carrega os itens da sacola com as medidas do catálogo.
 *
 * Recebe só ids e quantidades; tudo que influencia preço vem do banco.
 */
export async function itensComMedidas(linhas) {
  if (!linhas.length) return []

  const produtos = await many(
    `SELECT id, name, price, promo, weight_g, length_cm, width_cm, height_cm
       FROM products WHERE id = ANY($1::uuid[]) AND active`,
    [linhas.map((l) => l.productId)],
  )
  const porId = new Map(produtos.map((p) => [p.id, p]))

  return linhas
    .map((l) => {
      const p = porId.get(l.productId)
      if (!p) return null
      return {
        id: p.id,
        name: p.name,
        qty: l.qty,
        price: Number(p.promo) > 0 && Number(p.promo) < Number(p.price)
          ? Number(p.promo)
          : Number(p.price),
        weightG: Number(p.weight_g ?? 0),
        lengthCm: Number(p.length_cm ?? 0),
        widthCm: Number(p.width_cm ?? 0),
        heightCm: Number(p.height_cm ?? 0),
      }
    })
    .filter(Boolean)
}

/**
 * Regras de envio que não dependem de transportadora.
 *
 * A tabela `shipments` é a memória do processo. O Melhor Envio cobra no
 * passo do checkout, então tudo aqui é escrito de forma que uma falha no meio
 * seja retomada — nunca refeita do zero.
 */

/**
 * Etiqueta pronta: o pedido passa a "enviado" e o cliente recebe o rastreio.
 *
 * A trava contra repetição é a própria transição de status: o UPDATE só casa
 * enquanto o pedido está em 'pendente' ou 'pago', então a segunda chamada não
 * altera linha nenhuma e não dispara e-mail. Um pedido já marcado como
 * entregue também não volta para enviado por causa de um evento atrasado.
 *
 * Não lança: aviso ao cliente não pode derrubar a compra da etiqueta que
 * acabou de dar certo.
 */
async function marcarEnviado(orderId, envio) {
  try {
    const mudou = await one(
      `UPDATE orders SET status = 'enviado'
        WHERE id = $1 AND status IN ('pendente', 'pago')
        RETURNING id`,
      [orderId],
    )
    if (!mudou) return { marcado: false, motivo: 'pedido já saiu de pago' }

    await avisarPedidoEnviado(orderId, envio ?? {})
    return { marcado: true }
  } catch (err) {
    console.error('[envio] falha ao marcar como enviado:', err.message)
    return { marcado: false, motivo: err.message }
  }
}

/**
 * Compra a etiqueta de um pedido sem intervenção.
 *
 * Chamado quando o pagamento é confirmado. Nunca lança: a confirmação do
 * pagamento não pode falhar por causa da etiqueta — o dinheiro já entrou, e o
 * pedido tem que ficar pago mesmo que a transportadora esteja fora do ar. O
 * que der errado fica gravado em `shipments.error`, visível no painel, e o
 * dono termina pelo botão.
 *
 * Idempotente pelo estado: pedido que já tem envio ativo não gera outro. Isso
 * importa porque a processadora reenvia o webhook quando não recebe 200 — sem
 * a checagem, um reenvio compraria a segunda etiqueta e cobraria de novo.
 */
export async function autoBuyLabel(orderId) {
  const cfg = await one(`SELECT * FROM settings WHERE id = true`)
  if (!cfg?.auto_label) return { feito: false, motivo: 'automação desligada' }
  if (config.shippingProvider === 'manual') {
    return { feito: false, motivo: 'sem transportadora integrada' }
  }

  const jaTem = await one(
    `SELECT id FROM shipments
      WHERE order_id = $1 AND status NOT IN ('cancelado', 'erro')
      LIMIT 1`,
    [orderId],
  )
  if (jaTem) return { feito: false, motivo: 'pedido já tem etiqueta' }

  const pedido = await one(`SELECT * FROM orders WHERE id = $1`, [orderId])
  if (!pedido) return { feito: false, motivo: 'pedido não encontrado' }

  /** Registra a falha para aparecer no painel em vez de sumir no log. */
  const anotarFalha = async (mensagem) => {
    console.error(`[etiqueta] pedido ${pedido.seq}: ${mensagem}`)
    await one(
      `INSERT INTO shipments (order_id, provider, status, error)
       VALUES ($1, $2, 'erro', $3) RETURNING id`,
      [orderId, config.shippingProvider, mensagem],
    ).catch(() => {})
    return { feito: false, motivo: mensagem }
  }

  try {
    const itens = await many(
      `SELECT i.name, i.qty, i.price, i.product_id,
              p.weight_g, p.length_cm, p.width_cm, p.height_cm
         FROM order_items i
         LEFT JOIN products p ON p.id = i.product_id
        WHERE i.order_id = $1`,
      [orderId],
    )

    const semMedida = itens.filter(
      (i) => !i.weight_g || !i.length_cm || !i.width_cm || !i.height_cm,
    )
    if (semMedida.length) {
      return anotarFalha(
        `sem peso ou medidas: ${[...new Set(semMedida.map((i) => i.name))].join(', ')}`,
      )
    }

    const paraEnvio = itens.map((i) => ({
      id: i.product_id,
      name: i.name,
      qty: i.qty,
      price: Number(i.price),
      weightG: Number(i.weight_g),
      lengthCm: Number(i.length_cm),
      widthCm: Number(i.width_cm),
      heightCm: Number(i.height_cm),
    }))

    /* Recotamos em vez de reaproveitar o preço do pedido: a transportadora
       exige um carrinho novo, e o id do serviço só vale dentro de uma cotação. */
    const { options, erro } = await quoteForCart({ cep: pedido.cep, itens: paraEnvio })
    if (erro || !options.length) return anotarFalha(erro ?? 'nenhum serviço disponível')

    /* O serviço que o cliente escolheu. Se ele sumiu da lista, cai no mais
       barato — deixar sem etiqueta seria pior, e a diferença de preço fica
       visível no painel. */
    const escolhido =
      options.find((o) => o.servicoId === pedido.shipping_service_id) ??
      [...options].sort((a, b) => a.preco - b.preco)[0]

    const remetente = {
      nome: cfg.sender_name || cfg.store_name,
      doc: cfg.sender_doc,
      telefone: cfg.phone,
      email: cfg.email,
      cep: cfg.sender_cep,
      rua: cfg.sender_street,
      numero: cfg.sender_number,
      complemento: cfg.sender_compl,
      bairro: cfg.sender_district,
      cidade: cfg.sender_city,
      uf: cfg.sender_state,
    }

    if (!remetente.cep || !remetente.doc) {
      return anotarFalha('endereço da loja incompleto em Configurações')
    }

    const envio = await createShipment({
      providerId: config.shippingProvider,
      order: {
        id: pedido.id,
        codigo: `#${String(pedido.seq).padStart(4, '0')}`,
        total: Number(pedido.total),
        destinatario: {
          nome: pedido.customer_name,
          telefone: pedido.customer_phone,
          email: pedido.customer_email,
          doc: pedido.customer_doc,
          cep: pedido.cep,
          rua: pedido.street,
          numero: pedido.number,
          complemento: pedido.complement,
          bairro: pedido.district,
          cidade: pedido.city,
          uf: pedido.state,
        },
      },
      remetente,
      itens: paraEnvio,
      servicoId: escolhido.servicoId,
    })

    const pronto = await buyLabel({ providerId: config.shippingProvider, shipmentId: envio.id })
    console.log(`[etiqueta] pedido ${pedido.seq}: gerada (${pronto.tracking || 'sem rastreio ainda'})`)
    return { feito: true, shipmentId: pronto.id, tracking: pronto.tracking }
  } catch (err) {
    // Saldo insuficiente cai aqui, e é o caso mais provável na prática.
    return anotarFalha(err.message)
  }
}

/**
 * Traz o estado real de uma etiqueta da transportadora e grava.
 *
 * Chamado pelo webhook e pelo botão de conferir no painel. O corpo da
 * notificação nunca é usado como verdade: só como aviso de que algo mudou.
 */
export async function syncShipment(providerId, externalId) {
  const registro = await one(
    `SELECT * FROM shipments WHERE provider = $1 AND external_id = $2`,
    [providerId, String(externalId)],
  )

  // Etiqueta que não é nossa (ou notificação forjada): nada a fazer.
  if (!registro) return { updated: false, reason: 'etiqueta desconhecida' }

  const provider = getShippingProvider(providerId)
  const atual = await provider.consultar({ externalId: String(externalId) })

  /* Estado final não volta atrás. Uma notificação atrasada chegando depois de
     "entregue" não pode rebaixar a etiqueta para "postado" — foi o mesmo
     cuidado que o pagamento exigiu. */
  const finais = ['entregue', 'cancelado']
  if (finais.includes(registro.status) && registro.status !== atual.status) {
    return { updated: false, reason: `já está em ${registro.status}` }
  }

  await one(
    `UPDATE shipments
        SET status = $1, tracking = $2, carrier = $3, service_name = $4,
            cost = $5, raw = $6::jsonb, updated_at = now()
      WHERE id = $7 RETURNING id`,
    [
      atual.status,
      atual.tracking,
      atual.carrier,
      atual.servico,
      atual.custo,
      JSON.stringify(atual.raw ?? {}),
      registro.id,
    ],
  )

  /* O rastreio costuma aparecer só depois, quando a transportadora informa.
     Por isso marcamos aqui também — a trava de status impede o aviso duplo. */
  if (['gerada', 'postado', 'entregue'].includes(atual.status)) {
    await marcarEnviado(registro.order_id, atual)
  }

  return { updated: true, status: atual.status, tracking: atual.tracking }
}

/**
 * Compra e emite a etiqueta de um pedido, retomando de onde parou.
 *
 * Os quatro passos ficam gravados conforme avançam. Se a conexão cair depois
 * do checkout, a próxima chamada não compra de novo — ela vê que já está
 * paga e segue para a geração.
 */
export async function buyLabel({ providerId, shipmentId }) {
  const provider = getShippingProvider(providerId)

  const registro = await one(`SELECT * FROM shipments WHERE id = $1`, [shipmentId])
  if (!registro) throw new Error('Envio não encontrado.')
  if (!registro.external_id) throw new Error('Envio ainda não está no carrinho da transportadora.')

  const externalId = registro.external_id
  const marcar = (status, extra = {}) =>
    one(
      `UPDATE shipments
          SET status = $1, label_url = COALESCE($2, label_url),
              error = $3, updated_at = now()
        WHERE id = $4 RETURNING *`,
      [status, extra.labelUrl ?? null, extra.error ?? '', shipmentId],
    )

  try {
    if (registro.status === 'rascunho') {
      await provider.comprar({ externalId })
      await marcar('pago')
    }

    if (['rascunho', 'pago'].includes(registro.status)) {
      await provider.gerar({ externalId })
    }

    const url = await provider.imprimir({ externalId })
    const atualizado = await marcar('gerada', { labelUrl: url })

    /* Etiqueta na mão significa que a encomenda vai sair: o pedido vira
       'enviado' e o cliente recebe o rastreio, sem ninguém lembrar de fazer. */
    await marcarEnviado(registro.order_id, atualizado)

    return atualizado
  } catch (err) {
    await marcar(registro.status, { error: err.message }).catch(() => {})
    throw err
  }
}

/**
 * Cria o rascunho do envio: cota, escolhe o serviço e põe no carrinho.
 *
 * Um pedido pode ter mais de um envio ao longo do tempo (a primeira etiqueta
 * cancelada, uma segunda emitida), por isso não há restrição de um por pedido
 * — o que existe é o índice único no id da transportadora, que impede a mesma
 * etiqueta ser gravada duas vezes.
 */
export async function createShipment({ providerId, order, remetente, itens, servicoId }) {
  const provider = getShippingProvider(providerId)

  const { externalId, raw } = await provider.adicionarAoCarrinho({
    servicoId,
    remetente,
    destinatario: order.destinatario,
    itens,
    pedido: order,
  })

  return transaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO shipments (order_id, provider, external_id, status, raw)
       VALUES ($1, $2, $3, 'rascunho', $4::jsonb)
       ON CONFLICT (provider, external_id) WHERE external_id <> ''
       DO UPDATE SET raw = EXCLUDED.raw, updated_at = now()
       RETURNING *`,
      [order.id, providerId, externalId, JSON.stringify(raw ?? {})],
    )
    return rows[0]
  })
}
