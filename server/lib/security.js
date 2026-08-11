import { config } from '../config.js'

/**
 * Cabeçalhos de segurança.
 *
 * Escrito à mão em vez de usar o helmet: são quinze linhas, e cada dependência
 * nova é também uma porta de entrada — ataque de cadeia de suprimentos é hoje
 * mais comum que falha de código próprio. Aqui dá para ler tudo que é enviado.
 */

/**
 * A loja só carrega o que ela mesma serve. As exceções são deliberadas:
 *
 * - `img-src data:` porque as fotos de produto são gravadas como data URI.
 * - `style-src 'unsafe-inline'` porque o React aplica estilo por atributo
 *   (`style={{…}}`), e sem isto a página perde o layout. Não abre caminho para
 *   execução de script.
 * - `form-action` inclui o Asaas: o checkout leva o cliente para a tela de
 *   pagamento deles.
 *
 * `frame-ancestors 'none'` impede que a loja seja embutida em outro site, que
 * é como se monta um ataque de clickjacking no botão de finalizar compra.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "form-action 'self' https://*.asaas.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  'upgrade-insecure-requests',
].join('; ')

export function securityHeaders(_req, res, next) {
  res.setHeader('Content-Security-Policy', CSP)

  // Impede o navegador de "adivinhar" o tipo do arquivo. Sem isto, um upload
  // com conteúdo inesperado pode ser interpretado como HTML e executar.
  res.setHeader('X-Content-Type-Options', 'nosniff')

  // Redundante com frame-ancestors, mas ainda lido por navegadores antigos.
  res.setHeader('X-Frame-Options', 'DENY')

  // O endereço completo da página não vaza para sites de terceiros — o id do
  // pedido está na URL da confirmação.
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')

  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), payment=()')
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')

  // Só em produção: em desenvolvimento o site é http, e o HSTS deixaria o
  // navegador se recusando a abrir localhost por muito tempo.
  if (config.isProduction) {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains')
  }

  next()
}
