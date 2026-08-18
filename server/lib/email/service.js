import { many, one } from '../../db/pool.js'
import { config } from '../../config.js'
import { getEmailProvider } from './index.js'
import { modelos } from './modelos.js'

/**
 * Envio de avisos por e-mail.
 *
 * Regras que valem para todos:
 *
 * - **Nunca lança.** Nenhum aviso pode derrubar o que o disparou. Um pedido
 *   não pode falhar porque o servidor de e-mail está fora do ar, e um
 *   pagamento confirmado não pode voltar atrás por isso.
 * - **Um de cada tipo por pedido.** A trava é um índice único no banco, não
 *   uma checagem no código: o webhook da processadora reenvia eventos, e
 *   receber "seu pedido foi enviado" três vezes corrói a confiança de quem
 *   comprou.
 * - **A chave vem do painel primeiro**, do ambiente depois — mesma escolha
 *   feita para a transportadora, pelo mesmo motivo (trocar variável exige
 *   deploy, e deploy falha).
 */

const VALIDADE_CACHE_MS = 30_000
let cache = { valor: null, lidoEm: 0 }

const limparChave = (v) =>
  String(v ?? '')
    .trim()
    .replace(/^Bearer\s+/i, '')
    .replace(/\s+/g, '')

async function chaveAtual() {
  const agora = Date.now()
  if (cache.valor !== null && agora - cache.lidoEm < VALIDADE_CACHE_MS) return cache.valor

  let doBanco = ''
  try {
    const row = await one(`SELECT email_key FROM settings WHERE id = true`)
    doBanco = limparChave(row?.email_key)
  } catch (err) {
    console.error('[email] não foi possível ler a chave do banco:', err.message)
  }

  cache = { valor: doBanco || config.emailKey, lidoEm: agora }
  return cache.valor
}

/** Chamado ao salvar as configurações, para a troca valer na hora. */
export function esquecerChaveEmail() {
  cache = { valor: null, lidoEm: 0 }
}

/** O que a tela pode mostrar sem expor o segredo. */
export async function resumoDoEmail() {
  const chave = await chaveAtual()
  const row = await one(`SELECT email_key FROM settings WHERE id = true`).catch(() => null)
  return {
    provedor: config.emailProvider,
    remetente: config.emailFrom,
    presente: Boolean(chave),
    tamanho: chave.length,
    // As chaves do Resend começam com "re_"; isto não revela nada e evita
    // colar o valor errado.
    pareceChave: /^re_/.test(chave),
    origem: limparChave(row?.email_key) ? 'painel' : 'variável de ambiente',
  }
}

/** Pedido com itens, no formato que os modelos esperam. */
async function carregarPedido(orderId) {
  const p = await one(`SELECT * FROM orders WHERE id = $1`, [orderId])
  if (!p) return null

  const itens = await many(
    `SELECT name, variant_name, price, qty FROM order_items WHERE order_id = $1 ORDER BY name`,
    [orderId],
  )

  return {
    seq: p.seq,
    payment: p.payment,
    note: p.note,
    deliveryZone: p.delivery_zone,
    shipping: Number(p.shipping),
    total: Number(p.total),
    items: itens.map((i) => ({
      name: i.name,
      variantName: i.variant_name,
      price: Number(i.price),
      qty: i.qty,
    })),
    customer: {
      name: p.customer_name,
      email: p.customer_email,
      phone: p.customer_phone,
      address: p.street,
      number: p.number,
      complement: p.complement,
      district: p.district,
      city: p.city,
      state: p.state,
      cep: p.cep,
    },
  }
}

/**
 * Envia um aviso, uma única vez por pedido e tipo.
 *
 * O registro no `email_log` vem **antes** do envio: o índice único é o que
 * garante a unicidade, e se duas chamadas correrem juntas, só uma consegue
 * inserir. A perdedora desiste sem mandar nada.
 */
async function enviarUmaVez({ tipo, orderId, destino, assunto, html, responderPara }) {
  if (!destino) return { enviado: false, motivo: 'sem destinatário' }

  const provider = getEmailProvider()
  if (provider.id === 'nenhum') return { enviado: false, motivo: 'e-mail não configurado' }

  const chave = await chaveAtual()
  if (!chave) return { enviado: false, motivo: 'sem chave de e-mail' }

  let reserva
  try {
    reserva = await one(
      `INSERT INTO email_log (order_id, tipo, destino, status)
       VALUES ($1, $2, $3, 'enviando')
       RETURNING id`,
      [orderId ?? null, tipo, destino],
    )
  } catch (err) {
    // Violação do índice único: alguém já mandou (ou está mandando) este aviso.
    return { enviado: false, motivo: 'já enviado' }
  }

  try {
    await provider.enviar({
      chave,
      de: config.emailFrom,
      para: destino,
      assunto,
      html,
      responderPara,
    })
    await one(`UPDATE email_log SET status = 'enviado' WHERE id = $1 RETURNING id`, [reserva.id])
    console.log(`[email] ${tipo} → ${destino}`)
    return { enviado: true }
  } catch (err) {
    /* Grava a falha e libera a trava: o índice único só vale para status
       'enviado', então uma tentativa futura pode acontecer. */
    await one(`UPDATE email_log SET status = 'falhou', erro = $1 WHERE id = $2 RETURNING id`, [
      err.message,
      reserva.id,
    ]).catch(() => {})
    console.error(`[email] ${tipo} falhou:`, err.message)
    return { enviado: false, motivo: err.message }
  }
}

/** Configurações da loja no formato que os modelos usam. */
async function contexto() {
  const c = await one(`SELECT * FROM settings WHERE id = true`)
  return {
    cfg: {
      email: c?.email ?? '',
      publicUrl: config.publicUrl,
    },
    avisarCliente: c?.notify_customer !== false,
    paraDono: (c?.notify_email || c?.email || '').trim(),
  }
}

/* ------------------------------------------------------------------ Avisos */

/** Pedido criado: confirma para o cliente e avisa a loja. */
export async function avisarPedidoCriado(orderId) {
  const pedido = await carregarPedido(orderId)
  if (!pedido) return

  const { cfg, avisarCliente, paraDono } = await contexto()

  if (avisarCliente && pedido.customer.email) {
    const m = modelos.pedidoRecebido(pedido, cfg)
    await enviarUmaVez({
      tipo: 'pedido-recebido',
      orderId,
      destino: pedido.customer.email,
      ...m,
      responderPara: cfg.email,
    })
  }

  // Este é o aviso que faltava: sem ele a venda só aparecia abrindo o painel.
  const m = modelos.novoPedido(pedido, cfg)
  await enviarUmaVez({
    tipo: 'novo-pedido',
    orderId,
    destino: paraDono,
    ...m,
    responderPara: pedido.customer.email || undefined,
  })
}

export async function avisarPagamentoConfirmado(orderId) {
  const pedido = await carregarPedido(orderId)
  if (!pedido) return

  const { cfg, avisarCliente } = await contexto()
  if (!avisarCliente || !pedido.customer.email) return

  const m = modelos.pagamentoConfirmado(pedido, cfg)
  await enviarUmaVez({
    tipo: 'pagamento-confirmado',
    orderId,
    destino: pedido.customer.email,
    ...m,
    responderPara: cfg.email,
  })
}

/** Etiqueta pronta: leva o código de rastreio. */
export async function avisarPedidoEnviado(orderId, envio) {
  const pedido = await carregarPedido(orderId)
  if (!pedido) return

  const { cfg, avisarCliente } = await contexto()
  if (!avisarCliente || !pedido.customer.email) return

  const m = modelos.pedidoEnviado(pedido, cfg, envio ?? {})
  await enviarUmaVez({
    tipo: 'pedido-enviado',
    orderId,
    destino: pedido.customer.email,
    ...m,
    responderPara: cfg.email,
  })
}
