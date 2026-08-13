import { Router } from 'express'
import { many, one } from '../db/pool.js'
import { wrap, badRequest, notFound } from '../lib/http.js'
import { validarUuid } from '../lib/validate.js'
import { requireAdmin } from '../lib/auth.js'
import { limiteExterno } from '../lib/ratelimit.js'
import { config } from '../config.js'
import { currentShippingProvider } from '../lib/shipping/index.js'
import { buyLabel, createShipment, syncShipment } from '../lib/shipping/service.js'
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
