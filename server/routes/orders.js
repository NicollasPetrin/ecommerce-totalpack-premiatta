import { Router } from 'express'
import { many, one, transaction } from '../db/pool.js'
import { wrap, badRequest, notFound, conflict } from '../lib/http.js'
import { parse, schemas, validarUuid } from '../lib/validate.js'
import { requireAdmin } from '../lib/auth.js'
import { findZone, normalizeCep } from '../lib/zones.js'
import { config } from '../config.js'
import { itensComMedidas, quoteForCart } from '../lib/shipping/service.js'
import { createCharge, latestPayment, syncCharge } from '../lib/payments/service.js'
import { restoreStock } from '../lib/stock.js'
import { avisarPedidoCriado } from '../lib/email/service.js'
import { limitePedido, limiteExterno } from '../lib/ratelimit.js'
import * as s from '../lib/serialize.js'

export const orderRoutes = Router()

// Vale para qualquer rota deste roteador que use :id.
orderRoutes.param('id', validarUuid)

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
  limitePedido,
  wrap(async (req, res) => {
    const d = parse(schemas.order, req.body)
    const customerId = req.user?.role === 'customer' ? req.user.sub : null

    const settings = await one(`SELECT * FROM settings WHERE id = true`)

    /* O frete é resolvido antes da transação: erro de área não deve segurar
       as linhas de produto travadas enquanto se fala com a transportadora. */
    let zone = null
    let freteCotado = null

    if (config.shippingProvider === 'manual') {
      // Tabela de faixas de CEP: o valor é o que a loja definiu.
      zone = await findZone(d.cep)
      if (!zone) {
        throw badRequest('Ainda não entregamos neste CEP.', { cep: 'Fora da área de entrega.' })
      }
    } else {
      /* Com transportadora integrada, o preço é dela. Recotamos aqui em vez
         de aceitar o número do navegador — do contrário qualquer um fecharia
         pedido com frete de um centavo. O cliente escolheu um serviço; nós
         conferimos que ele existe e usamos o nosso preço, não o dele. */
      const itens = await itensComMedidas(d.items)
      const { options, erro } = await quoteForCart({ cep: d.cep, itens })

      if (erro || !options.length) {
        throw badRequest(erro ?? 'Não foi possível calcular o frete.', {
          cep: erro ?? 'Frete indisponível.',
        })
      }

      const escolhido = String(d.shippingServiceId ?? '')
      if (!escolhido) {
        throw badRequest('Escolha uma forma de envio.', {
          cep: 'Escolha uma forma de envio.',
        })
      }

      freteCotado = options.find((o) => o.servicoId === escolhido)
      if (!freteCotado) {
        // O serviço saiu da lista entre a escolha e o envio (preço muda, a
        // transportadora sai do ar). Melhor recusar que cobrar outro valor.
        throw conflict('A opção de frete escolhida não está mais disponível. Refaça a escolha.')
      }
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

      /* As variações também precisam da trava, e não vêm no SELECT acima:
         é o estoque delas que a linha do pedido baixa. */
      const idsVariacao = d.items.map((i) => i.variantId).filter(Boolean)
      const { rows: variacoes } = idsVariacao.length
        ? await client.query(
            `SELECT id, product_id, name, sku, price, promo, stock, active
               FROM product_variants
              WHERE id = ANY($1::uuid[])
              FOR UPDATE`,
            [idsVariacao],
          )
        : { rows: [] }

      /* Quais produtos do pedido exigem escolha. Sem isto, um item de produto
         com variação chegando sem `variantId` cairia no estoque do produto
         pai — que fica zerado nesse caso — e o cliente veria "sem estoque"
         quando o problema é outro. */
      const { rows: comVariacao } = await client.query(
        `SELECT DISTINCT product_id FROM product_variants
          WHERE product_id = ANY($1::uuid[]) AND active`,
        [d.items.map((i) => i.productId)],
      )
      const exigeEscolha = new Set(comVariacao.map((r) => r.product_id))

      const byId = new Map(products.map((p) => [p.id, p]))
      const variacaoPorId = new Map(variacoes.map((v) => [v.id, v]))
      const lines = []

      for (const item of d.items) {
        const product = byId.get(item.productId)
        if (!product || !product.active) {
          throw conflict(`Um dos produtos saiu do catálogo. Revise a sacola.`)
        }

        if (!item.variantId && exigeEscolha.has(product.id)) {
          throw conflict(`Escolha uma opção de “${product.name}” antes de finalizar.`)
        }

        let variant = null
        if (item.variantId) {
          variant = variacaoPorId.get(item.variantId)
          // Precisa existir, estar ativa e pertencer a este produto — senão
          // dava para comprar a variação barata de um item caro.
          if (!variant || !variant.active || variant.product_id !== product.id) {
            throw conflict(`Uma das opções escolhidas saiu do catálogo. Revise a sacola.`)
          }
        }

        // Quem manda no estoque e no preço é a variação, quando existe.
        const origem = variant ?? product
        const rotulo = variant ? `${product.name} (${variant.name})` : product.name

        if (origem.stock < item.qty) {
          throw conflict(`“${rotulo}” tem apenas ${origem.stock} em estoque.`)
        }
        // Preço do banco, nunca o que o navegador mandou.
        const price =
          Number(origem.promo) > 0 && Number(origem.promo) < Number(origem.price)
            ? Number(origem.promo)
            : Number(origem.price)

        lines.push({ product, variant, qty: item.qty, price })
      }

      const subtotal = lines.reduce((acc, l) => acc + l.price * l.qty, 0)

      /* Frete grátis é uma promessa da própria loja e só existe na tabela de
         faixas. Com transportadora integrada, quem paga é sempre o cliente —
         foi a regra escolhida para o frete não sair do bolso da loja. */
      let shipping
      let zoneName
      let zoneDays

      if (freteCotado) {
        shipping = Number(freteCotado.preco)
        zoneName = `${freteCotado.transportadora} ${freteCotado.nome}`.trim()
        zoneDays = Number(freteCotado.prazoDias) || 0
      } else {
        const free = subtotal >= Number(settings.free_shipping_from) && subtotal > 0
        shipping = free ? 0 : Number(zone.fee)
        zoneName = zone.name
        zoneDays = zone.days
      }

      const total = subtotal + shipping

      const { rows: created } = await client.query(
        `INSERT INTO orders (
           customer_id, customer_name, customer_email, customer_phone, customer_doc,
           delivery, delivery_zone, delivery_days,
           cep, street, number, complement, district, city, state,
           payment, note, subtotal, shipping, total, shipping_service_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
         RETURNING *`,
        [
          customerId, d.name, d.email, d.phone, d.cpfCnpj,
          'entrega', zoneName, zoneDays,
          normalizeCep(d.cep), d.street, d.number, d.complement,
          d.district, d.city, d.state,
          d.payment, d.note, subtotal, shipping, total,
          // Guardado para a etiqueta reencontrar o mesmo serviço depois.
          freteCotado?.servicoId ?? '',
        ],
      )
      const orderRow = created[0]

      for (const line of lines) {
        await client.query(
          `INSERT INTO order_items
             (order_id, product_id, variant_id, variant_name,
              name, sku, art, tint, price, qty)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            orderRow.id, line.product.id,
            line.variant?.id ?? null, line.variant?.name ?? '',
            line.product.name,
            // O código da variação é mais específico que o do produto.
            line.variant?.sku || line.product.sku,
            line.product.art, line.product.tint, line.price, line.qty,
          ],
        )

        if (line.variant) {
          await client.query(
            `UPDATE product_variants SET stock = stock - $1 WHERE id = $2`,
            [line.qty, line.variant.id],
          )
        } else {
          await client.query(`UPDATE products SET stock = stock - $1 WHERE id = $2`, [
            line.qty,
            line.product.id,
          ])
        }
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

    /* Avisos depois de responder: o cliente não deve esperar o servidor de
       e-mail para ver a confirmação na tela. Falha aqui não afeta o pedido. */
    avisarPedidoCriado(order.id).catch((e) =>
      console.error('[email] aviso de pedido novo falhou:', e.message),
    )
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
  // Cada chamada aqui vira uma requisição à processadora; sem teto, qualquer
  // um com o link de um pedido consome a cota da conta do Asaas.
  limiteExterno,
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
