import { one, transaction } from '../../db/pool.js'
import { getProvider } from './index.js'
import { config } from '../../config.js'

/**
 * Ponte entre o pedido e a processadora.
 *
 * As rotas falam com este arquivo; ele fala com o adaptador e com o banco.
 * Assim a lógica de "criar cobrança e registrar" existe num lugar só,
 * independente de qual processadora esteja ativa.
 */

/**
 * Cria a cobrança de um pedido e registra a tentativa.
 *
 * Falha na processadora não derruba o pedido: ele já existe, o estoque já foi
 * baixado, e o cliente já viu a confirmação. Registramos o pagamento como
 * falho e seguimos — dá para tentar cobrar de novo pelo painel.
 */
export async function createCharge({ order, customer }) {
  const provider = getProvider()

  let charge
  try {
    charge = await provider.createCharge({
      order,
      customer,
      method: order.payment,
      amount: Number(order.total),
      returnUrl: `${config.publicUrl}/pedido/${order.id}`,
    })
  } catch (err) {
    console.error(`[pagamento] ${provider.id} recusou a cobrança:`, err.message)
    charge = {
      providerRef: null,
      checkoutUrl: null,
      status: 'falhou',
      expiresAt: null,
      raw: { erro: err.message },
    }
  }

  const row = await one(
    `INSERT INTO payments
       (order_id, provider, provider_ref, method, status, amount, checkout_url, raw, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
     RETURNING *`,
    [
      order.id, provider.id, charge.providerRef, order.payment, charge.status,
      order.total, charge.checkoutUrl, JSON.stringify(charge.raw ?? {}),
      charge.expiresAt ?? null,
    ],
  )

  return row
}

/** Pagamento mais recente de um pedido. */
export const latestPayment = (orderId) =>
  one(
    `SELECT * FROM payments WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [orderId],
  )

/**
 * Aplica o resultado de um evento de webhook.
 *
 * Roda em transação com o pedido: se o pagamento foi confirmado, o pedido
 * passa a 'pago' junto. Ou as duas coisas acontecem, ou nenhuma.
 */
export async function applyPaymentEvent({ provider, providerRef, status, paidAt, payload }) {
  return transaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE payments
          SET status = $1,
              paid_at = COALESCE($2, paid_at),
              raw = raw || $3::jsonb
        WHERE provider = $4 AND provider_ref = $5
        RETURNING *`,
      [status, paidAt ?? null, JSON.stringify({ ultimoEvento: payload ?? {} }), provider, providerRef],
    )

    const payment = rows[0]
    if (!payment) return { applied: false, reason: 'cobrança não encontrada' }

    // O pedido só avança sozinho até 'pago'. Depois disso quem manda é a
    // loja: um pedido já enviado não volta de status por causa de um evento
    // atrasado da processadora.
    if (status === 'pago') {
      await client.query(
        `UPDATE orders SET status = 'pago'
          WHERE id = $1 AND status = 'pendente'`,
        [payment.order_id],
      )
    }

    if (status === 'estornado') {
      await client.query(
        `UPDATE orders SET status = 'cancelado'
          WHERE id = $1 AND status IN ('pendente', 'pago')`,
        [payment.order_id],
      )
    }

    return { applied: true, payment }
  })
}
