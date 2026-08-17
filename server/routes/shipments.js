import { Router } from 'express'
import { many, one } from '../db/pool.js'
import { wrap, badRequest, notFound } from '../lib/http.js'
import { validarUuid } from '../lib/validate.js'
import { requireAdmin } from '../lib/auth.js'
import { limiteExterno } from '../lib/ratelimit.js'
import { config } from '../config.js'
import { currentShippingProvider } from '../lib/shipping/index.js'
import { buyLabel, createShipment, quoteForCart, syncShipment } from '../lib/shipping/service.js'
import { resumoDoToken } from '../lib/shipping/credenciais.js'
import * as s from '../lib/serialize.js'

export const shipmentRoutes = Router()

shipmentRoutes.param('id', validarUuid)

/* Tudo aqui é do painel: nenhuma destas rotas é para o cliente. */
shipmentRoutes.use(requireAdmin)

/** Remetente montado a partir das configurações, com o que falta apontado. */
async function remetente() {
  const c = await one(`SELECT * FROM settings WHERE id = true`)

  const dados = {
    nome: c.sender_name || c.store_name,
    doc: c.sender_doc,
    telefone: c.phone,
    email: c.email,
    cep: c.sender_cep,
    rua: c.sender_street,
    numero: c.sender_number,
    complemento: c.sender_compl,
    bairro: c.sender_district,
    cidade: c.sender_city,
    uf: c.sender_state,
  }

  const faltando = [
    ['doc', 'CNPJ/CPF'], ['cep', 'CEP'], ['rua', 'rua'], ['numero', 'número'],
    ['bairro', 'bairro'], ['cidade', 'cidade'], ['uf', 'UF'],
  ]
    .filter(([campo]) => !dados[campo])
    .map(([, rotulo]) => rotulo)

  return { dados, faltando }
}

/**
 * Itens do pedido com peso e medida do produto.
 *
 * As medidas vivem no produto, não no item — o item guarda o histórico de
 * nome e preço. Um produto excluído do catálogo deixa o item sem medida, e
 * é isso que a conferência abaixo pega.
 */
async function itensParaEnvio(orderId) {
  const itens = await many(
    `SELECT i.name, i.qty, i.price, i.product_id,
            p.weight_g, p.length_cm, p.width_cm, p.height_cm
       FROM order_items i
       LEFT JOIN products p ON p.id = i.product_id
      WHERE i.order_id = $1`,
    [orderId],
  )

  const semMedida = itens
    .filter((i) => !i.weight_g || !i.length_cm || !i.width_cm || !i.height_cm)
    .map((i) => i.name)

  return {
    itens: itens.map((i) => ({
      id: i.product_id,
      name: i.name,
      qty: i.qty,
      price: Number(i.price),
      weightG: Number(i.weight_g ?? 0),
      lengthCm: Number(i.length_cm ?? 0),
      widthCm: Number(i.width_cm ?? 0),
      heightCm: Number(i.height_cm ?? 0),
    })),
    semMedida,
  }
}

/** Junta as duas conferências numa mensagem só, para o admin resolver de uma vez. */
function exigirPronto({ faltando, semMedida }) {
  const problemas = []
  if (faltando.length) {
    problemas.push(`Complete o endereço da loja em Configurações: falta ${faltando.join(', ')}.`)
  }
  if (semMedida.length) {
    const lista = [...new Set(semMedida)].slice(0, 3).join(', ')
    problemas.push(`Sem peso ou medidas: ${lista}${semMedida.length > 3 ? '…' : ''}.`)
  }
  if (problemas.length) throw badRequest(problemas.join(' '))
}

/**
 * Teste de conexão com a transportadora.
 *
 * Existe porque o erro de credencial só aparecia no checkout, e a mensagem que
 * o cliente vê é (corretamente) genérica. Aqui o admin dispara uma cotação de
 * mentira com medidas fixas e recebe o retorno cru.
 *
 * Nunca devolve o token — só o suficiente para saber se ele existe, de que
 * ambiente é e se combina com o endereço configurado.
 */
shipmentRoutes.post(
  '/shipping/test',
  limiteExterno,
  wrap(async (req, res) => {
    const cfg = await one(`SELECT * FROM settings WHERE id = true`)
    const me = config.melhorEnvio
    const tk = await resumoDoToken()

    const ambienteUrl = me.baseUrl.includes('sandbox') ? 'sandbox' : 'produção'
    const configuracao = {
      provedor: config.shippingProvider,
      endereco: me.baseUrl,
      ambienteDoEndereco: ambienteUrl,
      tokenPresente: tk.presente,
      tokenTamanho: tk.tamanho,
      pareceToken: tk.pareceToken,
      origemDoToken: tk.origem,
      userAgent: me.userAgent || '(vazio — a API recusa sem isto)',
      renovacaoConfigurada: Boolean(me.clientId && me.refreshToken),
      remetenteCep: cfg.sender_cep || '(vazio)',
    }

    if (config.shippingProvider === 'manual') {
      return res.json({
        ok: false,
        configuracao,
        conclusao: 'SHIPPING_PROVIDER ainda está em "manual". Nenhuma chamada foi feita.',
      })
    }

    // Cotação de mentira: origem e destino conhecidos, caixa pequena.
    const origem = cfg.sender_cep || '01310100'
    const r = await quoteForCart({
      cep: '01310100',
      itens: [
        {
          id: '00000000-0000-0000-0000-000000000000',
          name: 'Teste de conexão',
          qty: 1,
          price: 10,
          weightG: 300,
          lengthCm: 20,
          widthCm: 15,
          heightCm: 5,
        },
      ],
    })

    let conclusao
    if (r.options?.length) {
      conclusao = `Conexão certa. ${r.options.length} serviço(s) responderam para ${origem} → 01310-100.`
    } else if (!configuracao.pareceToken) {
      conclusao =
        `O valor em MELHORENVIO_TOKEN não tem formato de token de acesso ` +
        `(${tk.tamanho} caracteres, e não começa com "eyJ"). O token do ` +
        'Melhor Envio é um JWT longo. Pegue em GERENCIAR → TOKENS no painel ' +
        'deles — não confunda com o client_secret do aplicativo, que tem 40 ' +
        'caracteres.'
    } else if (/unauthenticated|unauthorized|401/i.test(r.causa ?? '')) {
      conclusao =
        'O token tem o formato certo mas foi recusado. Confira se ele é do ' +
        `mesmo ambiente do endereço (${ambienteUrl}), se não venceu (vale 30 ` +
        'dias) e se as permissões de cotação foram marcadas ao gerá-lo.'
    } else if (/403|scope|permiss/i.test(r.causa ?? '')) {
      conclusao =
        'O token existe mas não tem permissão para cotar. Na aplicação do Melhor ' +
        'Envio, marque o escopo de cálculo de frete e gere o token de novo.'
    } else if (/HTTP 404/i.test(r.causa ?? '')) {
      conclusao = `Endereço da API não encontrado. Confira MELHORENVIO_BASE_URL (${me.baseUrl}).`
    } else if (/falha de rede/i.test(r.causa ?? '')) {
      conclusao =
        'A requisição não chegou a sair do servidor. Costuma ser cabeçalho ' +
        'inválido (espaço ou quebra de linha na chave) ou o endereço da API errado.'
    } else if (/HTTP 5\d\d/i.test(r.causa ?? '')) {
      conclusao = 'O Melhor Envio respondeu com erro interno. Tente de novo em alguns minutos.'
    } else {
      conclusao = r.causa ?? r.erro ?? 'Sem serviços para este trajeto.'
    }

    res.json({
      ok: Boolean(r.options?.length),
      configuracao,
      servicos: r.options ?? [],
      causa: r.causa ?? null,
      corpo: r.corpo ?? null,
      conclusao,
    })
  }),
)

/* --------------------------------------------------------------- Consulta */

shipmentRoutes.get(
  '/orders/:id/shipments',
  wrap(async (req, res) => {
    const rows = await many(
      `SELECT * FROM shipments WHERE order_id = $1 ORDER BY created_at DESC`,
      [req.params.id],
    )
    res.json({ shipments: rows.map(s.shipment), provider: config.shippingProvider })
  }),
)

/** Serviços e preços disponíveis para este pedido. */
shipmentRoutes.post(
  '/orders/:id/shipments/quote',
  limiteExterno,
  wrap(async (req, res) => {
    const pedido = await one(`SELECT * FROM orders WHERE id = $1`, [req.params.id])
    if (!pedido) throw notFound('Pedido não encontrado.')

    const { dados, faltando } = await remetente()
    const { itens, semMedida } = await itensParaEnvio(pedido.id)
    exigirPronto({ faltando, semMedida })

    const servicos = await currentShippingProvider().cotar({
      remetente: dados,
      destinatario: { cep: pedido.cep },
      itens,
    })

    res.json({ servicos })
  }),
)

/* ---------------------------------------------------------------- Emissão */

/** Passo 1: põe no carrinho da transportadora. Ainda não gasta saldo. */
shipmentRoutes.post(
  '/orders/:id/shipments',
  limiteExterno,
  wrap(async (req, res) => {
    const servicoId = String(req.body?.servicoId ?? '').trim()
    if (!servicoId) throw badRequest('Escolha um serviço de envio.')

    const pedido = await one(`SELECT * FROM orders WHERE id = $1`, [req.params.id])
    if (!pedido) throw notFound('Pedido não encontrado.')

    const { dados, faltando } = await remetente()
    const { itens, semMedida } = await itensParaEnvio(pedido.id)
    exigirPronto({ faltando, semMedida })

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
      remetente: dados,
      itens,
      servicoId,
    })

    res.status(201).json({ shipment: s.shipment(envio) })
  }),
)

/** Passos 2 a 4: paga, gera e devolve o PDF. Retoma de onde parou. */
shipmentRoutes.post(
  '/shipments/:id/buy',
  limiteExterno,
  wrap(async (req, res) => {
    const envio = await buyLabel({
      providerId: config.shippingProvider,
      shipmentId: req.params.id,
    })
    res.json({ shipment: s.shipment(envio) })
  }),
)

/** Busca o estado real na transportadora. Mesmo caminho do webhook. */
shipmentRoutes.post(
  '/shipments/:id/sync',
  limiteExterno,
  wrap(async (req, res) => {
    const registro = await one(`SELECT * FROM shipments WHERE id = $1`, [req.params.id])
    if (!registro) throw notFound('Envio não encontrado.')

    const resultado = await syncShipment(registro.provider, registro.external_id)
    const atual = await one(`SELECT * FROM shipments WHERE id = $1`, [req.params.id])
    res.json({ shipment: s.shipment(atual), resultado })
  }),
)

shipmentRoutes.post(
  '/shipments/:id/cancel',
  limiteExterno,
  wrap(async (req, res) => {
    const registro = await one(`SELECT * FROM shipments WHERE id = $1`, [req.params.id])
    if (!registro) throw notFound('Envio não encontrado.')

    await currentShippingProvider().cancelar({ externalId: registro.external_id })

    const atual = await one(
      `UPDATE shipments SET status = 'cancelado', updated_at = now()
        WHERE id = $1 RETURNING *`,
      [req.params.id],
    )
    res.json({ shipment: s.shipment(atual) })
  }),
)
