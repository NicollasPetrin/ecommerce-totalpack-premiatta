import { config } from '../../config.js'
import { melhorenvio } from './melhorenvio.js'

/**
 * Registro de transportadoras.
 *
 * Mesma forma do registro de pagamento: a loja fala com o contrato, não com a
 * transportadora. Trocar de fornecedor é acrescentar um arquivo aqui, sem
 * mexer em rota nem em tela.
 */

/** Sem transportadora integrada — a etiqueta é emitida fora do site. */
const manual = {
  id: 'manual',
  label: 'Sem integração',
  async cotar() {
    return []
  },
  async adicionarAoCarrinho() {
    throw new Error('Nenhuma transportadora integrada. Configure SHIPPING_PROVIDER.')
  },
  async comprar() {
    throw new Error('Nenhuma transportadora integrada.')
  },
  async gerar() {
    throw new Error('Nenhuma transportadora integrada.')
  },
  async imprimir() {
    return ''
  },
  async consultar() {
    return { status: 'rascunho', tracking: '', carrier: '', servico: '', custo: 0, raw: {} }
  },
  async cancelar() {
    return { ok: true }
  },
  parseEvent() {
    return []
  },
}

const PROVEDORES = { manual, melhorenvio }

export const listShippingProviders = () => Object.keys(PROVEDORES)

export function getShippingProvider(id = config.shippingProvider) {
  const p = PROVEDORES[id]
  if (!p) throw new Error(`Transportadora desconhecida: ${id}`)
  return p
}

/** A que está configurada agora. */
export const currentShippingProvider = () => getShippingProvider(config.shippingProvider)
