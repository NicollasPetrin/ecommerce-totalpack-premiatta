import { Router } from 'express'
import { many, one, transaction } from '../db/pool.js'
import { wrap, badRequest, notFound, conflict } from '../lib/http.js'
import { parse, schemas } from '../lib/validate.js'
import { requireAdmin } from '../lib/auth.js'
import { findZone, normalizeCep } from '../lib/shipping.js'
import { createCharge, latestPayment, syncCharge } from '../lib/payments/service.js'
import { restoreStock } from '../lib/stock.js'
import * as s from '../lib/serialize.js'

export const orderRoutes = Router()

/**
 * Carrega pedidos com itens e pagamento. Três consultas no total,
 * independente da quantidade de pedidos — nada de N+1.
 */
async function withItems(rows) {
  if (!rows.length) return []
  const ids = rows.map((r) => r.id)

  const [items, payments] = await Promise.all([
    many(`SELECT * FROM order_items WHERE order_id = ANY($1::uuid[]) ORDER BY name`, [ids]),
    // DISTINCT ON devolve só a cobrança mais recente de cada pedido.
    many(
      `SELECT DISTINCT ON (order_id) *
         FROM payments
        WHERE order_id = ANY($1::uuid[])
        ORDER BY order_id, created_at DESC`,
      [ids],
    ),
  ])

  const byOrder = new Map()
  for (const item of items) {
    if (!byOrder.has(item.order_id)) byOrder.set(item.order_id, [])
    byOrder.get(item.order_id).push(item)
  }

  const paymentByOrder = new Map(payments.map((p) => [p.order_id, p]))

  // `payment` no pedido é o método escolhido ('pix', 'cartao'); a cobrança
  // vai em `charge`, para os dois não se atropelarem.
  return rows.map((r) => ({
    ...s.order({ ...r, items: byOrder.get(r.id) ?? [] }),
    charge: s.payment(paymentByOrder.get(r.id)),
  }))
}

/* ------------------------------------------------------------ Criar pedido */

orderRoutes.post(
  '/',
  wrap(async (req, res) => {
    const d = parse(schemas.order, req.body)
    const customerId = req.user?.role === 'customer' ? req.user.sub : null

    const settings = await one(`SELECT * FROM settings WHERE id = true`)

    // Todo pedido é entrega — a retirada saiu da loja. Frete conferido antes
    // da transação: erro de área não deve travar linhas de produto.
    const zone = await findZone(d.cep)
    if (!zone) {
      throw badRequest('Ainda não entregamos neste CEP.', { cep: 'Fora da área de entrega.' })
    }

    const order = await transaction(async (client) => {
      // FOR UPDATE trava as linhas até o commit: dois pedidos simultâneos do
      // mesmo produto não conseguem levar o estoque abaixo de zero.
      const { rows: products } = await client.query(
        `SELECT id, name, sku, art, tint, price, promo, stock, active
           FROM products
          WHERE id = ANY($1::uuid[])
          FOR UPDATE`,
        [d.items.map((i) => i.productId)],
      )

      const byId = new Map(products.map((p) => [p.id, p]))
      const lines = []

      for (const item of d.items) {
        const product = byId.get(item.productId)
        if (!product || !product.active) {
          throw conflict(`Um dos produtos saiu do catálogo. Revise a sacola.`)
        }
        if (product.stock < item.qty) {
          throw conflict(
            `“${product.name}” tem apenas ${product.stock} em estoque.`,
          )
        }
        // Preço do banco, nunca o que o navegador mandou.
        const price =
          Number(product.promo) > 0 && Number(product.promo) < Number(product.price)
            ? Number(product.promo)
            : Number(product.price)

        lines.push({ product, qty: item.qty, price })
      }

      const subtotal = lines.reduce((acc, l) => acc + l.price * l.qty, 0)
      const free = subtotal >= Number(settings.free_shipping_from) && subtotal > 0
      const shipping = free ? 0 : Number(zone.fee)
      const total = subtotal + shipping

      const { rows: created } = await client.query(
        `INSERT INTO orders (
           customer_id, customer_name, customer_email, customer_phone, customer_doc,
           delivery, delivery_zone, delivery_days,
           cep, street, number, complement, district, city, state,
           payment, note, subtotal, shipping, total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
         RETURNING *`,
        [
          customerId, d.name, d.email, d.phone, d.cpfCnpj,
          'entrega', zone.name, zone.days,
          normalizeCep(d.cep), d.street, d.number, d.complement,
          d.district, d.city, d.state,
          d.payment, d.note, subtotal, shipping, total,
        ],
      )
      const orderRow = created[0]

      for (const line of lines) {
        await client.query(
          `INSERT INTO order_items (order_id, product_id, name, sku, art, tint, price, qty)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            orderRow.id, line.product.id, line.product.name, line.product.sku,
            line.product.art, line.product.tint, line.price, line.qty,
          ],
        )
        await client.query(`UPDATE products SET stock = stock - $1 WHERE id = $2`, [
          line.qty,
          line.product.id,
        ])
      }

      // O documento fica guardado na conta para não ser redigitado na próxima
      // compra. Só grava se ainda não houver um.
      if (customerId) {
        await client.query(
          `UPDATE customers SET doc = $1 WHERE id = $2 AND coalesce(doc, '') = ''`,
          [d.cpfCnpj, customerId],
        )
      }

      // Guarda o endereço na conta, se o cliente pediu.
      if (customerId && d.saveAddress) {
        const { rows: existing } = await client.query(
          `SELECT id FROM addresses WHERE customer_id = $1`,
          [customerId],
        )
        const isDefault = existing.length === 0
        await client.query(
          `INSERT INTO addresses
             (customer_id, label, cep, street, number, complement, district, city, state, is_default)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            customerId, d.addressLabel || 'Endereço', normalizeCep(d.cep), d.street,
            d.number, d.complement, d.district, d.city, d.state, isDefault,
          ],
        )
      }

      const { rows: items } = await client.query(
        `SELECT * FROM order_items WHERE order_id = $1`,
        [orderRow.id],
      )
      return s.order({ ...orderRow, items })
    })

    /**
     * A cobrança é criada depois da transação, não dentro dela.
     *
     * Chamar a processadora com a transação aberta seguraria as linhas de
     * produto travadas durante uma requisição de rede — bastaria a
     * processadora demorar para a loja inteira parar de vender. E se a
     * cobrança falhar, o pedido já está gravado e o cliente já tem o número.
     */
    const payment = await createCharge({ order, customer: d })

    res.status(201).json({ order: { ...order, charge: s.payment(payment) } })
  }),
)

/* ------------------------------------------------------- Pedidos do cliente */

orderRoutes.get(
  '/mine',
  wrap(async (req, res) => {
    if (req.user?.role !== 'customer') return res.json({ orders: [] })
    const rows = await many(
      `SELECT * FROM orders WHERE customer_id = $1 ORDER BY created_at DESC`,
      [req.user.sub],
    )
    res.json({ orders: await withItems(rows) })
  }),
)

/**
 * Um pedido específico. O cliente só alcança os próprios; o admin alcança
 * todos. Sem esta checagem, trocar o id na URL exporia pedidos alheios.
 */
orderRoutes.get(
  '/:id',
  wrap(async (req, res) => {
    const row = await one(`SELECT * FROM orders WHERE id = $1`, [req.params.id])
    if (!row) throw notFound('Pedido não encontrado.')

    const isOwner = req.user?.role === 'customer' && row.customer_id === req.user.sub
    const isAdmin = req.user?.role === 'admin'
    // Pedido sem cadastro fica acessível a quem tem o link — é a única forma
    // de o comprador rever a confirmação.
    const isGuestOrder = row.customer_id === null

    if (!isOwner && !isAdmin && !isGuestOrder) throw notFound('Pedido não encontrado.')

    const [order] = await withItems([row])
    res.json({ order })
  }),
)

/* ------------------------------------------------------------------ Admin */

orderRoutes.get(
  '/',
  requireAdmin,
  wrap(async (_req, res) => {
    const rows = await many(`SELECT * FROM orders ORDER BY created_at DESC`)
    res.json({ orders: await withItems(rows) })
  }),
)

orderRoutes.put(
  '/:id/status',
  requireAdmin,
  wrap(async (req, res) => {
    const { status } = parse(schemas.orderStatus, req.body)

    const row = await transaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE orders SET status = $1 WHERE id = $2 RETURNING *`,
        [status, req.params.id],
      )
      if (!rows.length) return null

      // Cancelou: a mercadoria volta para a prateleira.
      if (status === 'cancelado') await restoreStock(client, req.params.id)

      return rows[0]
    })

    if (!row) throw notFound('Pedido não encontrado.')
    const [order] = await withItems([row])
    res.json({ order })
  }),
)

/**
 * Refaz a cobrança de um pedido — boleto vencido, cartão recusado, ou uma
 * cobrança que falhou porque a processadora estava fora do ar. Sem isto, um
 * pedido com cobrança falha vira beco sem saída.
 */
orderRoutes.post(
  '/:id/charge',
  requireAdmin,
  wrap(async (req, res) => {
    const row = await one(`SELECT * FROM orders WHERE id = $1`, [req.params.id])
    if (!row) throw notFound('Pedido não encontrado.')

    if (row.status === 'cancelado') {
      throw conflict('Pedido cancelado não pode receber nova cobrança.')
    }

    const [order] = await withItems([row])
    const payment = await createCharge({ order, customer: order.customer })

    res.status(201).json({ payment: s.payment(payment) })
  }),
)

/**
 * Confere o pagamento direto na processadora.
 *
 * Acessível ao dono do pedido, não só ao admin: se o webhook se perdeu, o
 * cliente que acabou de pagar consegue atualizar a própria tela em vez de
 * ficar olhando "aguardando pagamento".
 */
orderRoutes.post(
  '/:id/sync-payment',
  wrap(async (req, res) => {
    const row = await one(`SELECT * FROM orders WHERE id = $1`, [req.params.id])
    if (!row) throw notFound('Pedido não encontrado.')

    const isOwner = req.user?.role === 'customer' && row.customer_id === req.user.sub
    const isAdmin = req.user?.role === 'admin'
    const isGuestOrder = row.customer_id === null
    if (!isOwner && !isAdmin && !isGuestOrder) throw notFound('Pedido não encontrado.')

    const payment = await latestPayment(row.id)
    if (!payment) throw notFound('Este pedido não tem cobrança registrada.')

    const resultado = await syncCharge(payment)
    const [order] = await withItems([await one(`SELECT * FROM orders WHERE id = $1`, [row.id])])

    res.json({ order, resultado })
  }),
)

orderRoutes.delete(
  '/:id',
  requireAdmin,
  wrap(async (req, res) => {
    const row = await one(`DELETE FROM orders WHERE id = $1 RETURNING id`, [req.params.id])
    if (!row) throw notFound('Pedido não encontrado.')
    res.json({ ok: true })
  }),
)
