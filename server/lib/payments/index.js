import { config } from '../../config.js'
import { manual } from './manual.js'
import { asaas } from './asaas.js'

/**
 * Camada de pagamento.
 *
 * A loja não conhece nenhuma processadora — conhece este contrato. Trocar de
 * Mercado Pago para Asaas é escrever um arquivo novo aqui e mudar uma variável
 * de ambiente; nenhuma rota, tela ou tabela muda.
 *
 * ---------------------------------------------------------------------------
 * O contrato que cada processadora precisa implementar
 * ---------------------------------------------------------------------------
 *
 *   id: string
 *     Nome curto, gravado na coluna `payments.provider`.
 *
 *   async createCharge({ order, items, customer, method, amount }) → {
 *     providerRef,    identificador da cobrança lá
 *     checkoutUrl,    para onde mandar o cliente pagar (null se não houver)
 *     status,         estado inicial: 'pendente' na maioria dos casos
 *     expiresAt,      Date ou null
 *     raw,            resposta crua, guardada para depuração
 *   }
 *
 *   verifySignature({ rawBody, headers }) → boolean
 *     Confere que a notificação veio mesmo da processadora. Sem isto,
 *     qualquer pessoa que descubra a URL do webhook marca pedidos como pagos.
 *
 *   parseEvent({ body, headers }) → {
 *     eventId,        identificador único do evento, para não aplicar duas vezes
 *     eventType,
 *     providerRef,    a qual cobrança se refere
 *     status,         um valor de payment_status
 *     paidAt,         Date ou null
 *   } | null                (null = evento que não nos interessa)
 *
 * ---------------------------------------------------------------------------
 * O que NUNCA passa por aqui
 * ---------------------------------------------------------------------------
 *
 * Número de cartão, validade e CVV. O cliente digita esses dados na página da
 * processadora (checkout hospedado) ou em campos que são iframes dela
 * (tokenização). Guardar ou sequer trafegar esses dados exige certificação
 * PCI-DSS. Se algum dia um adaptador daqui receber um número de cartão, o
 * desenho está errado.
 */

/** Adaptadores disponíveis. Novos entram aqui. */
const providers = {
  manual,
  asaas,
}

export function getProvider(id = config.paymentProvider) {
  const provider = providers[id]
  if (!provider) {
    const conhecidos = Object.keys(providers).join(', ')
    throw new Error(
      `Processadora "${id}" não existe. Disponíveis: ${conhecidos}. ` +
        `Ajuste PAYMENT_PROVIDER no ambiente.`,
    )
  }
  return provider
}

export const listProviders = () => Object.keys(providers)

/** Só o método 'manual' aceita pagamento combinado fora do site. */
export const isManual = () => config.paymentProvider === 'manual'
