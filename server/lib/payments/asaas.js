import { config } from '../../config.js'
import { onlyDigits } from '../document.js'

/**
 * Adaptador do Asaas.
 *
 * Usa o **checkout hospedado** deles: criamos a cobrança pela API e mandamos o
 * cliente para a `invoiceUrl`, uma página do próprio Asaas onde ele paga. Com
 * isso, nenhum dado de cartão passa por este servidor — que é a única forma de
 * aceitar cartão sem certificação PCI-DSS.
 *
 * As três formas ficam disponíveis: PIX, boleto e cartão de crédito. A escolha
 * feita no nosso checkout vira o `billingType`; se vier algo que não
 * reconhecemos, mandamos `UNDEFINED` e o cliente escolhe na página do Asaas.
 *
 * Endereços da API mudam com o tempo — por isso `ASAAS_BASE_URL` é
 * configurável. Confira o valor atual na documentação do Asaas antes de
 * apontar para produção.
 */

const BILLING_TYPE = {
  pix: 'PIX',
  boleto: 'BOLETO',
  cartao: 'CREDIT_CARD',
}

/**
 * Eventos do Asaas → estados da nossa tabela `payments`.
 * Eventos fora desta lista são ignorados (o webhook responde 200 e segue).
 */
const EVENT_STATUS = {
  PAYMENT_CREATED: 'pendente',
  PAYMENT_AWAITING_RISK_ANALYSIS: 'processando',
  PAYMENT_APPROVED_BY_RISK_ANALYSIS: 'processando',
  PAYMENT_AWAITING_CHARGEBACK_REVERSAL: 'processando',
  // CONFIRMED = pago pelo cliente; RECEIVED = dinheiro já liquidado.
  PAYMENT_CONFIRMED: 'pago',
  PAYMENT_RECEIVED: 'pago',
  PAYMENT_OVERDUE: 'expirado',
  PAYMENT_DELETED: 'falhou',
  PAYMENT_REPROVED_BY_RISK_ANALYSIS: 'falhou',
  PAYMENT_REFUNDED: 'estornado',
  PAYMENT_REFUND_IN_PROGRESS: 'estornado',
  PAYMENT_CHARGEBACK_REQUESTED: 'estornado',
  PAYMENT_CHARGEBACK_DISPUTE: 'estornado',
}

const headers = () => ({
  'Content-Type': 'application/json',
  access_token: config.paymentSecretKey,
  'User-Agent': 'TotalPack',
})

/** Chamada à API com erro legível — a resposta do Asaas traz `errors[]`. */
async function call(path, options = {}) {
  const url = `${config.asaasBaseUrl}${path}`
  const response = await fetch(url, { ...options, headers: headers() })

  let body
  try {
    body = await response.json()
  } catch {
    body = {}
  }

  if (!response.ok) {
    const detalhe = body?.errors?.map((e) => e.description).join('; ')
    throw new Error(
      `Asaas respondeu ${response.status}${detalhe ? `: ${detalhe}` : ''}`,
    )
  }

  return body
}

/**
 * Encontra ou cria o cliente no Asaas.
 *
 * Buscamos por documento antes de criar: o mesmo comprador voltando não deve
 * virar um cadastro novo a cada pedido.
 */
async function resolveCustomer({ name, email, phone, cpfCnpj }) {
  const doc = onlyDigits(cpfCnpj)

  const found = await call(`/customers?cpfCnpj=${doc}&limit=1`)
  if (found?.data?.length) return found.data[0].id

  const created = await call('/customers', {
    method: 'POST',
    body: JSON.stringify({
      name,
      cpfCnpj: doc,
      email: email || undefined,
      mobilePhone: onlyDigits(phone) || undefined,
      notificationDisabled: false,
    }),
  })

  return created.id
}

/** Vencimento em dias corridos, no formato que o Asaas espera. */
function dueDate(days) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export const asaas = {
  id: 'asaas',

  async createCharge({ order, customer, method, amount }) {
    const asaasCustomerId = await resolveCustomer({
      name: order.customer.name,
      email: order.customer.email,
      phone: order.customer.phone,
      cpfCnpj: customer?.cpfCnpj ?? order.customer.cpfCnpj,
    })

    const payment = await call('/payments', {
      method: 'POST',
      body: JSON.stringify({
        customer: asaasCustomerId,
        billingType: BILLING_TYPE[method] ?? 'UNDEFINED',
        value: Number(amount),
        dueDate: dueDate(config.asaasDueDays),
        // Liga a cobrança ao nosso pedido — aparece no painel do Asaas e
        // volta nos webhooks, útil para conciliar.
        externalReference: order.id,
        description: `Pedido #${order.seq} — ${config.storeLabel}`,
      }),
    })

    return {
      providerRef: payment.id,
      // invoiceUrl é a página de pagamento do Asaas, com todas as formas
      // que a cobrança permite.
      checkoutUrl: payment.invoiceUrl ?? payment.bankSlipUrl ?? null,
      status: EVENT_STATUS[`PAYMENT_${payment.status}`] ?? 'pendente',
      expiresAt: payment.dueDate ? new Date(`${payment.dueDate}T23:59:59`) : null,
      raw: {
        id: payment.id,
        status: payment.status,
        billingType: payment.billingType,
        invoiceUrl: payment.invoiceUrl,
        dueDate: payment.dueDate,
      },
    }
  },

  /**
   * O Asaas envia, em cada notificação, o token que você cadastrou junto com o
   * webhook — no cabeçalho `asaas-access-token`. Comparamos com o segredo
   * guardado no ambiente.
   *
   * A comparação é feita em tempo constante: comparar strings com `===` vaza,
   * pelo tempo de resposta, quantos caracteres iniciais estavam certos.
   */
  verifySignature({ headers: h }) {
    const esperado = config.paymentWebhookSecret
    if (!esperado) return false

    const recebido = h['asaas-access-token'] ?? h['Asaas-Access-Token'] ?? ''
    if (recebido.length !== esperado.length) return false

    let diff = 0
    for (let i = 0; i < esperado.length; i++) {
      diff |= esperado.charCodeAt(i) ^ recebido.charCodeAt(i)
    }
    return diff === 0
  },

  parseEvent({ body }) {
    const status = EVENT_STATUS[body?.event]
    if (!status || !body?.payment?.id) return null

    return {
      // O Asaas manda `id` do evento nas versões atuais. Sem ele, montamos uma
      // chave estável com o que temos — o índice único de webhook_events
      // continua impedindo o mesmo evento de ser aplicado duas vezes.
      eventId: body.id ?? `${body.event}:${body.payment.id}:${body.payment.status}`,
      eventType: body.event,
      providerRef: body.payment.id,
      status,
      paidAt:
        status === 'pago'
          ? new Date(body.payment.paymentDate ?? body.payment.confirmedDate ?? Date.now())
          : null,
    }
  },
}
