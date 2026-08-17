import { one } from '../../db/pool.js'
import { config } from '../../config.js'

/**
 * De onde sai o token da transportadora.
 *
 * Ordem: o que está gravado no painel vence; se estiver vazio, cai na variável
 * de ambiente. Assim quem já configurou no Railway continua funcionando, e
 * quem colar na tela passa a mandar sem precisar de deploy.
 *
 * O cache existe porque toda cotação chamaria o banco — e cotação acontece a
 * cada CEP digitado por qualquer visitante. Trinta segundos é curto o
 * bastante para uma troca de token valer quase de imediato.
 */

const VALIDADE_MS = 30_000

let cache = { valor: null, lidoEm: 0 }

/** Mesma limpeza da variável de ambiente: colar traz lixo junto. */
const limpar = (v) =>
  String(v ?? '')
    .trim()
    .replace(/^Bearer\s+/i, '')
    .replace(/\s+/g, '')

export async function tokenDaTransportadora() {
  const agora = Date.now()
  if (cache.valor !== null && agora - cache.lidoEm < VALIDADE_MS) return cache.valor

  let doBanco = ''
  try {
    const row = await one(`SELECT melhorenvio_token FROM settings WHERE id = true`)
    doBanco = limpar(row?.melhorenvio_token)
  } catch (err) {
    // Banco fora do ar não pode derrubar a cotação de vez: cai no ambiente.
    console.error('[frete] não foi possível ler o token do banco:', err.message)
  }

  cache = { valor: doBanco || config.melhorEnvio.token, lidoEm: agora }
  return cache.valor
}

/** Chamado ao salvar as configurações, para a troca valer na hora. */
export function esquecerToken() {
  cache = { valor: null, lidoEm: 0 }
}

/** Só o que dá para mostrar na tela sem expor o segredo. */
export async function resumoDoToken() {
  const t = await tokenDaTransportadora()
  const row = await one(`SELECT melhorenvio_token FROM settings WHERE id = true`).catch(() => null)

  return {
    presente: Boolean(t),
    tamanho: t.length,
    // Todo JWT começa com "eyJ" — isto não revela nada e separa o token de
    // acesso do client_secret, que é a confusão que já custou horas.
    pareceToken: /^eyJ[\w-]+\.[\w-]+\./.test(t),
    origem: limpar(row?.melhorenvio_token) ? 'painel' : 'variável de ambiente',
  }
}
