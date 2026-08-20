import { many, one } from '../../db/pool.js'
import { config } from '../../config.js'
import { getFiscalProvider } from './index.js'

/**
 * Emissão de nota fiscal.
 *
 * A loja vende mercadoria: o documento é NF-e modelo 55, autorizada pela
 * SEFAZ. Duas coisas moldam tudo o que está aqui:
 *
 * 1. **A emissão é assíncrona.** Pedir a nota devolve "processando", não a
 *    nota. A chave de acesso chega depois, por webhook. Só quando ela chega é
 *    que a etiqueta pode ser comprada, porque é a chave que vai impressa nela.
 *
 * 2. **Nota errada é problema fiscal, não bug.** Por isso nada aqui "tenta o
 *    melhor possível": faltando NCM ou unidade em qualquer item, a emissão
 *    para e o motivo aparece no painel. Emitir nota torta é pior que não
 *    emitir, porque a correção depois é ofício de contador.
 */

const VALIDADE_CACHE_MS = 30_000
let cache = { valor: null, lidoEm: 0 }

const limpar = (v) => String(v ?? '').trim().replace(/\s+/g, '')

async function chaveAtual() {
  const agora = Date.now()
  if (cache.valor !== null && agora - cache.lidoEm < VALIDADE_CACHE_MS) return cache.valor

  let doBanco = ''
  try {
    const row = await one(`SELECT fiscal_key FROM settings WHERE id = true`)
    doBanco = limpar(row?.fiscal_key)
  } catch (err) {
    console.error('[nota] não foi possível ler a chave do banco:', err.message)
  }

  cache = { valor: doBanco || config.fiscalKey, lidoEm: agora }
  return cache.valor
}

/** Chamado ao salvar as configurações, para a troca valer na hora. */
export function esquecerChaveFiscal() {
  cache = { valor: null, lidoEm: 0 }
}

/** O que a tela pode mostrar sem expor o segredo. */
export async function resumoDoFiscal() {
  const chave = await chaveAtual()
  const cfg = await one(
    `SELECT fiscal_key, auto_invoice, fiscal_sandbox FROM settings WHERE id = true`,
  ).catch(() => null)

  return {
    emissor: chave ? 'base' : 'nenhum',
    presente: Boolean(chave),
    tamanho: chave.length,
    automatica: cfg?.auto_invoice !== false,
    homologacao: Boolean(cfg?.fiscal_sandbox),
    origem: limpar(cfg?.fiscal_key) ? 'painel' : 'variável de ambiente',
  }
}

/**
 * A emissão só entra no caminho do pedido quando está configurada.
 *
 * Sem chave, a loja se comporta exatamente como antes — inclusive comprando a
 * etiqueta assim que o pagamento confirma. Configurar a nota é que muda a
 * ordem das coisas, e essa é a única maneira de a mudança não pegar ninguém
 * de surpresa.
 */
export async function emissaoAtiva() {
  const chave = await chaveAtual()
  if (!chave) return false
  const cfg = await one(`SELECT auto_invoice FROM settings WHERE id = true`).catch(() => null)
  return cfg?.auto_invoice !== false
}

export const notaDoPedido = (orderId) =>
  one(
    `SELECT * FROM invoices
      WHERE order_id = $1 AND status NOT IN ('rejeitada', 'cancelada')
      ORDER BY created_at DESC LIMIT 1`,
    [orderId],
  )

/** Chave de acesso da nota autorizada, ou '' — é o que a etiqueta carrega. */
export async function chaveDaNota(orderId) {
  const nf = await notaDoPedido(orderId)
  return nf?.status === 'autorizada' ? (nf.chave ?? '') : ''
}

/* -------------------------------------------------------------------------- */
/* Cadastros no emissor                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Id do comprador no emissor.
 *
 * Guardamos em `customers.fiscal_id` quando o pedido tem cadastro na loja.
 * Compra sem cadastro cria um cliente a cada vez — o emissor reconhece pelo
 * documento, que vai em `externalReference`.
 */
async function garantirCliente({ provider, chave, sandbox, pedido }) {
  if (pedido.customer_id) {
    const c = await one(`SELECT fiscal_id FROM customers WHERE id = $1`, [pedido.customer_id])
    if (c?.fiscal_id) return c.fiscal_id
  }

  const id = await provider.criarCliente({
    chave,
    sandbox,
    cliente: {
      nome: pedido.customer_name,
      doc: pedido.customer_doc,
      email: pedido.customer_email,
      telefone: pedido.customer_phone,
      cep: pedido.cep,
      rua: pedido.street,
      numero: pedido.number,
      complemento: pedido.complement,
      bairro: pedido.district,
      cidade: pedido.city,
      uf: pedido.state,
    },
  })

  if (pedido.customer_id && id) {
    await one(`UPDATE customers SET fiscal_id = $1 WHERE id = $2 RETURNING id`, [
      id,
      pedido.customer_id,
    ]).catch(() => {})
  }

  return id
}

/** Id do produto no emissor, cadastrado uma vez e reaproveitado. */
async function garantirProduto({ provider, chave, sandbox, produto }) {
  if (produto.fiscal_id) return produto.fiscal_id

  const id = await provider.criarProduto({
    chave,
    sandbox,
    produto: {
      id: produto.id,
      nome: produto.name,
      // O código é o SKU da loja; sem SKU, o próprio id serve.
      codigo: produto.sku || produto.id.slice(0, 8),
      ncm: produto.ncm,
      unidade: produto.unit_trib,
      gtin: produto.gtin,
      preco: Number(produto.price),
      cclassTrib: produto.cclass_trib,
    },
  })

  if (id) {
    await one(`UPDATE products SET fiscal_id = $1 WHERE id = $2 RETURNING id`, [
      id,
      produto.id,
    ]).catch(() => {})
  }

  return id
}

/* -------------------------------------------------------------------------- */
/* Emissão                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Emite a nota do pedido.
 *
 * Nunca lança: é chamada a partir da confirmação de pagamento, e pagamento
 * confirmado não pode voltar atrás porque o emissor está fora do ar. A falha
 * fica gravada em `invoices.error` e aparece no painel.
 */
export async function emitirNota(orderId) {
  const chave = await chaveAtual()
  if (!chave) return { feito: false, motivo: 'sem chave do emissor' }

  const cfg = await one(`SELECT * FROM settings WHERE id = true`)
  const provider = getFiscalProvider('base')
  const sandbox = Boolean(cfg?.fiscal_sandbox)

  const jaTem = await notaDoPedido(orderId)
  if (jaTem) return { feito: false, motivo: 'pedido já tem nota', nota: jaTem }

  const pedido = await one(`SELECT * FROM orders WHERE id = $1`, [orderId])
  if (!pedido) return { feito: false, motivo: 'pedido não encontrado' }

  /** Registra a falha para aparecer no painel em vez de sumir no log. */
  const anotarFalha = async (mensagem, externalId = '') => {
    console.error(`[nota] pedido ${pedido.seq}: ${mensagem}`)
    await one(
      `INSERT INTO invoices (order_id, provider, external_id, status, error)
       VALUES ($1, $2, $3, 'rejeitada', $4) RETURNING id`,
      [orderId, provider.id, externalId, mensagem],
    ).catch(() => {})
    return { feito: false, motivo: mensagem }
  }

  try {
    const itens = await many(
      `SELECT i.qty, i.price, i.product_id,
              p.id, p.name, p.sku, p.ncm, p.unit_trib, p.gtin, p.cclass_trib,
              p.fiscal_id, p.price AS p_price
         FROM order_items i
         LEFT JOIN products p ON p.id = i.product_id
        WHERE i.order_id = $1`,
      [orderId],
    )

    if (!itens.length) return anotarFalha('pedido sem itens')

    /* Mesma lógica da conferência de medidas do envio: o que falta é dito pelo
       nome, porque quem vai corrigir precisa saber qual produto abrir. */
    const semFiscal = itens.filter((i) => !i.ncm || !i.unit_trib)
    if (semFiscal.length) {
      const nomes = [...new Set(semFiscal.map((i) => i.name ?? 'produto removido'))]
      return anotarFalha(`sem NCM ou unidade fiscal: ${nomes.join(', ')}`)
    }

    const clienteId = await garantirCliente({ provider, chave, sandbox, pedido })
    if (!clienteId) return anotarFalha('emissor não devolveu id do cliente')

    const comId = []
    for (const i of itens) {
      const produtoId = await garantirProduto({
        provider,
        chave,
        sandbox,
        produto: { ...i, id: i.product_id, price: i.p_price },
      })
      if (!produtoId) return anotarFalha(`emissor não cadastrou o produto ${i.name}`)
      comId.push({ ...i, produtoId })
    }

    const pedidoExternoId = await provider.criarPedido({
      chave,
      sandbox,
      pedido: {
        id: pedido.id,
        clienteId,
        observacao: pedido.note,
        frete: Number(pedido.shipping ?? 0),
        total: Number(pedido.total ?? 0),
        formaPagamento: pedido.payment,
        bankId: cfg?.fiscal_bank_id || '',
        itens: comId.map((i) => ({
          produtoId: i.produtoId,
          qtd: i.qty,
          preco: Number(i.price),
          cclassTrib: i.cclass_trib,
        })),
      },
    })
    if (!pedidoExternoId) return anotarFalha('emissor não devolveu id do pedido de venda')

    /* A linha nasce antes de pedir a emissão: se a chamada seguinte cair no
       meio, o pedido de venda já existe do lado de lá e o painel precisa
       conseguir mostrá-lo em vez de criar outro na próxima tentativa. */
    const registro = await one(
      `INSERT INTO invoices (order_id, provider, external_id, status)
       VALUES ($1, $2, $3, 'rascunho') RETURNING *`,
      [orderId, provider.id, pedidoExternoId],
    )

    const r = await provider.emitir({ chave, sandbox, pedidoExternoId })

    const atualizado = await one(
      `UPDATE invoices
          SET invoice_id = $1, numero = $2, status = $3,
              raw = $4::jsonb, error = '', updated_at = now()
        WHERE id = $5 RETURNING *`,
      [r.invoiceId, r.numero, r.status, JSON.stringify(r.raw ?? {}), registro.id],
    )

    console.error(`[nota] pedido ${pedido.seq}: ${r.status}${r.numero ? ` nº ${r.numero}` : ''}`)
    return { feito: true, nota: atualizado }
  } catch (err) {
    return anotarFalha(err.message)
  }
}

/**
 * Aplica a notificação do emissor.
 *
 * É aqui que a nota deixa de ser promessa: quando ela autoriza, a chave existe
 * e a etiqueta pode ser comprada. A compra é disparada por quem chama, para
 * esta camada não depender da de envio.
 */
export async function aplicarEventoFiscal({ providerId = 'base', body }) {
  const provider = getFiscalProvider(providerId)
  const evento = provider.parseEvent({ body })
  if (!evento) return { aplicado: false, motivo: 'evento sem pedido de venda' }

  const registro = await one(
    `SELECT * FROM invoices WHERE provider = $1 AND external_id = $2`,
    [providerId, evento.pedidoExternoId],
  )
  if (!registro) return { aplicado: false, motivo: 'nota desconhecida' }

  /* Nota já autorizada não volta a "processando" por evento fora de ordem —
     webhook não garante ordem de entrega, e regredir apagaria a chave. */
  if (registro.status === 'autorizada' && evento.status === 'processando') {
    return { aplicado: false, motivo: 'evento atrasado', nota: registro }
  }

  const atualizado = await one(
    `UPDATE invoices
        SET status = $1,
            invoice_id = COALESCE(NULLIF($2, ''), invoice_id),
            numero     = COALESCE(NULLIF($3, ''), numero),
            serie      = COALESCE(NULLIF($4, ''), serie),
            chave      = COALESCE(NULLIF($5, ''), chave),
            pdf_url    = COALESCE(NULLIF($6, ''), pdf_url),
            xml_url    = COALESCE(NULLIF($7, ''), xml_url),
            error      = $8,
            raw        = $9::jsonb,
            updated_at = now()
      WHERE id = $10 RETURNING *`,
    [
      evento.status,
      evento.invoiceId,
      evento.numero,
      evento.serie,
      evento.chave,
      evento.pdfUrl,
      evento.xmlUrl,
      evento.erro,
      JSON.stringify(evento.raw ?? {}),
      registro.id,
    ],
  )

  return {
    aplicado: true,
    nota: atualizado,
    // Só a transição para autorizada destrava o envio.
    virouAutorizada: registro.status !== 'autorizada' && atualizado.status === 'autorizada',
  }
}
