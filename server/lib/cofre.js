import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto'
import { config } from '../config.js'

/**
 * Cofre dos segredos guardados no banco.
 *
 * O que está em jogo: o token da transportadora compra etiqueta com o saldo
 * da carteira, a chave do e-mail manda mensagem em nome do domínio, e a do
 * emissor emite nota fiscal com o CNPJ da loja. Em texto puro, um backup
 * vazado, um dump esquecido ou um acesso indevido ao banco entrega os três de
 * uma vez — sem passar por nenhuma senha da loja.
 *
 * AES-256-GCM, que além de cifrar autentica: um valor adulterado no banco
 * falha ao abrir em vez de devolver lixo silenciosamente.
 *
 * **A chave sai do JWT_SECRET**, por HKDF, e não de uma variável nova. É
 * deliberado: variável a mais é variável que alguém esquece de definir, e o
 * resultado seria a loja rodando sem cifrar sem ninguém perceber. O
 * JWT_SECRET já é obrigatório e já tem tamanho mínimo conferido em produção.
 * ENCRYPTION_KEY continua valendo para quem quiser separar as duas coisas.
 *
 * Consequência que precisa estar escrita: **trocar o JWT_SECRET torna os
 * segredos ilegíveis.** Não quebra a loja — o valor volta vazio, o recurso
 * desliga e o painel pede a chave de novo — mas é preciso recolá-las.
 */

const PREFIXO = 'enc.v1.'

/** 32 bytes derivados, para o segredo bruto não virar chave direto. */
const chave = () => {
  const material = config.encryptionKey || config.jwtSecret
  return Buffer.from(hkdfSync('sha256', Buffer.from(material, 'utf8'), 'totalpack.cofre', 'segredos-do-painel', 32))
}

/** Já está cifrado? Serve para conviver com valores gravados antes disto. */
export const cifrado = (v) => typeof v === 'string' && v.startsWith(PREFIXO)

/**
 * Cifra um segredo. Valor vazio continua vazio — vazio significa "não
 * configurado", e cifrar isso só criaria um valor que parece existir.
 */
export function guardar(texto) {
  const limpo = String(texto ?? '')
  if (!limpo) return ''
  if (cifrado(limpo)) return limpo

  // IV novo a cada gravação: reusar entrega o conteúdo no GCM.
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', chave(), iv)
  const dados = Buffer.concat([cipher.update(limpo, 'utf8'), cipher.final()])

  return PREFIXO + [iv, cipher.getAuthTag(), dados].map((b) => b.toString('base64url')).join('.')
}

/**
 * Abre um segredo cifrado.
 *
 * Valor sem o prefixo volta como está: é o que foi gravado antes de existir
 * cofre, e recusá-lo desligaria a loja de quem já estava rodando.
 *
 * Falha ao abrir devolve vazio em vez de lançar. Um segredo ilegível — chave
 * trocada, linha adulterada — desliga o recurso e aparece no painel como
 * "sem chave", que é recuperável colando de novo. Lançar aqui derrubaria a
 * cotação de frete de todo visitante.
 */
export function abrir(valor) {
  const v = String(valor ?? '')
  if (!v || !cifrado(v)) return v

  try {
    const [iv, tag, dados] = v.slice(PREFIXO.length).split('.').map((p) => Buffer.from(p, 'base64url'))
    /* authTagLength explicito: sem ele o Node aceita tag curta e so avisa que
       isso e depreciado. Tag curta e exatamente o que um atacante mandaria
       para enfraquecer a autenticacao. */
    const decipher = createDecipheriv('aes-256-gcm', chave(), iv, { authTagLength: 16 })
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(dados), decipher.final()]).toString('utf8')
  } catch (err) {
    console.error(
      '[cofre] não foi possível abrir um segredo:', err.message,
      '\n        Se o JWT_SECRET mudou, as chaves precisam ser coladas de novo no painel.',
    )
    return ''
  }
}

/** As colunas de `settings` que guardam segredo. */
const COLUNAS = ['melhorenvio_token', 'email_key', 'fiscal_key', 'fiscal_webhook_secret']

/**
 * Cifra o que já estava gravado em texto puro.
 *
 * Roda uma vez, no start. Sem isto, a proteção só valeria para chave colada
 * depois — e as que já estão lá são justamente as que importam.
 */
export async function protegerSegredosExistentes(pool) {
  try {
    const { rows } = await pool.query(`SELECT ${COLUNAS.join(', ')} FROM settings WHERE id = true`)
    const atual = rows[0]
    if (!atual) return

    const trocar = COLUNAS.filter((c) => atual[c] && !cifrado(atual[c]))
    if (!trocar.length) return

    await pool.query(
      `UPDATE settings SET ${trocar.map((c, i) => `${c} = $${i + 1}`).join(', ')} WHERE id = true`,
      trocar.map((c) => guardar(atual[c])),
    )
    console.log(`[cofre] ${trocar.length} segredo(s) cifrado(s): ${trocar.join(', ')}`)
  } catch (err) {
    // Não pode impedir a loja de subir: sem isto ela roda como rodava antes.
    console.error('[cofre] não foi possível cifrar os segredos existentes:', err.message)
  }
}
