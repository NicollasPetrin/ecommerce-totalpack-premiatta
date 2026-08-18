import { config } from '../../config.js'
import { resend } from './resend.js'
import { brevo } from './brevo.js'

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

const PROVEDORES = { nenhum, resend, brevo }

export const listEmailProviders = () => Object.keys(PROVEDORES)

/**
 * Descobre o fornecedor pela cara da chave.
 *
 * Cada um usa um prefixo próprio ("re_", "xkeysib-"), então a chave colada no
 * painel já diz de quem ela é. Isso evita o passo a mais de escolher o
 * fornecedor numa lista — passo que, na prática, é onde se erra: escolher um
 * e colar a chave do outro dá 401 sem explicação.
 */
export function detectarProvedor(chave) {
  const limpa = String(chave ?? '').trim()
  if (!limpa) return 'nenhum'

  for (const p of Object.values(PROVEDORES)) {
    if (p.prefixo?.test(limpa)) return p.id
  }

  // Chave presente mas de formato desconhecido: o Resend é o mais provável,
  // por ser o mais antigo aqui. Tentar e falhar com o erro do fornecedor diz
  // mais a quem configura do que recusar caladamente.
  return 'resend'
}

export function getEmailProvider(id = config.emailProvider) {
  return PROVEDORES[id] ?? nenhum
}
