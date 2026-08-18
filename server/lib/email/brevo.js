/**
 * Adaptador do Brevo (ex-Sendinblue).
 *
 * Três diferenças em relação ao Resend, todas pequenas e todas capazes de
 * gastar uma tarde de quem não as conhece:
 *
 * 1. A chave vai no cabeçalho `api-key`, e **não** em `Authorization: Bearer`.
 *    Mandar como Bearer devolve 401 sem dizer por quê.
 * 2. O remetente é objeto (`{ name, email }`), não a string "Nome <e-mail>".
 * 3. O corpo é `htmlContent`, e o destinatário é lista de objetos.
 */

import { config } from '../../config.js'

const PADRAO = 'https://api.brevo.com/v3'
const base = () => config.emailBaseUrl || PADRAO

/**
 * "TotalPack <contato@totalpack.app.br>" → { name, email }.
 *
 * O formato com o nome na frente é o que o resto do sistema usa, porque é o
 * que aparece na caixa de entrada de quem recebe. Aceita também o e-mail
 * puro, para o caso de alguém configurar sem nome.
 */
function pessoa(valor) {
  const texto = String(valor ?? '').trim()
  const m = texto.match(/^\s*(.*?)\s*<([^>]+)>\s*$/)
  if (m) return { name: m[1] || m[2], email: m[2].trim() }
  return { email: texto }
}

export const brevo = {
  id: 'brevo',
  label: 'Brevo',
  // As chaves do Brevo começam assim; serve para escolher o adaptador certo
  // pela chave colada, sem obrigar ninguém a declarar o fornecedor.
  prefixo: /^xkeysib-/,

  async enviar({ chave, de, para, assunto, html, responderPara }) {
    let r
    try {
      r = await fetch(`${base()}/smtp/email`, {
        method: 'POST',
        headers: {
          'api-key': chave,
          accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sender: pessoa(de),
          to: [{ email: para }],
          subject: assunto,
          htmlContent: html,
          ...(responderPara ? { replyTo: pessoa(responderPara) } : {}),
        }),
      })
    } catch (e) {
      // Falha antes de haver resposta: rede, DNS, cabeçalho inválido.
      throw new Error(`[brevo] não foi possível chamar a API: ${e.message}`)
    }

    const texto = await r.text()
    let corpo
    try {
      corpo = texto ? JSON.parse(texto) : {}
    } catch {
      corpo = { raw: texto.slice(0, 300) }
    }

    if (!r.ok) {
      const detalhe = corpo?.message ?? corpo?.raw ?? 'sem detalhe'
      // O Brevo devolve o motivo em `code`, e alguns são acionáveis por quem
      // está configurando — vale carregar junto.
      const codigo = corpo?.code ? ` (${corpo.code})` : ''
      const err = new Error(`[brevo] HTTP ${r.status}${codigo} — ${detalhe}`)
      err.status = r.status
      err.body = corpo
      throw err
    }

    return { id: corpo?.messageId ?? '' }
  },
}
