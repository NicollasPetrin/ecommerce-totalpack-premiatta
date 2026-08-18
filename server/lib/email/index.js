import { config } from '../../config.js'
import { resend } from './resend.js'

/**
 * Registro de provedores de e-mail.
 *
 * Mesma forma dos registros de pagamento e de frete: a loja fala com o
 * contrato, e trocar de fornecedor é acrescentar um arquivo aqui.
 */

/** Sem provedor: não envia nada, e diz isso em vez de fingir sucesso. */
const nenhum = {
  id: 'nenhum',
  label: 'Sem envio de e-mail',
  async enviar() {
    throw new Error('Nenhum provedor de e-mail configurado.')
  },
}

const PROVEDORES = { nenhum, resend }

export const listEmailProviders = () => Object.keys(PROVEDORES)

export function getEmailProvider(id = config.emailProvider) {
  return PROVEDORES[id] ?? nenhum
}
