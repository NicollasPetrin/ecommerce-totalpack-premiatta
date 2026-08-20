import { baseErp } from './base.js'

/**
 * Registro de emissores de nota fiscal.
 *
 * Mesma forma dos registros de pagamento, frete e e-mail: a loja fala com o
 * contrato, e trocar de emissor é acrescentar um arquivo aqui.
 */

/** Sem emissor: a loja vende normalmente, só não emite nota daqui. */
const nenhum = {
  id: 'nenhum',
  label: 'Sem emissão de nota',
  async criarCliente() {
    throw new Error('Nenhum emissor de nota configurado.')
  },
  async criarProduto() {
    throw new Error('Nenhum emissor de nota configurado.')
  },
  async criarPedido() {
    throw new Error('Nenhum emissor de nota configurado.')
  },
  async emitir() {
    throw new Error('Nenhum emissor de nota configurado.')
  },
  parseEvent: () => null,
}

const EMISSORES = { nenhum, base: baseErp }

export const listFiscalProviders = () => Object.keys(EMISSORES)

export function getFiscalProvider(id = 'base') {
  return EMISSORES[id] ?? nenhum
}
