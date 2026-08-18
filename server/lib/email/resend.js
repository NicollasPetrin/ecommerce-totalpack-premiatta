/**
 * Adaptador do Resend.
 *
 * A API é uma chamada só: POST /emails com remetente, destinatário, assunto e
 * corpo. Não há estado para guardar nem token para renovar — diferente da
 * transportadora, a chave do Resend não vence.
 */

import { config } from '../../config.js'

const PADRAO = 'https://api.resend.com'
const base = () => config.emailBaseUrl || PADRAO

export const resend = {
  id: 'resend',
  label: 'Resend',
  // Serve para escolher o adaptador certo pela chave colada.
  prefixo: /^re_/,

  async enviar({ chave, de, para, assunto, html, responderPara }) {
    let r
    try {
      r = await fetch(`${base()}/emails`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${chave}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: de,
          to: [para],
          subject: assunto,
          html,
          ...(responderPara ? { reply_to: responderPara } : {}),
        }),
      })
    } catch (e) {
      // Falha antes de haver resposta: rede, DNS, cabeçalho inválido.
      throw new Error(`[resend] não foi possível chamar a API: ${e.message}`)
    }

    const texto = await r.text()
    let corpo
    try {
      corpo = texto ? JSON.parse(texto) : {}
    } catch {
      corpo = { raw: texto.slice(0, 300) }
    }

    if (!r.ok) {
      const detalhe = corpo?.message ?? corpo?.error?.message ?? corpo?.raw ?? 'sem detalhe'
      const err = new Error(`[resend] HTTP ${r.status} — ${detalhe}`)
      err.status = r.status
      err.body = corpo
      throw err
    }

    return { id: corpo?.id ?? '' }
  },
}
