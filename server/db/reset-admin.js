import { randomBytes } from 'node:crypto'
import { pool } from './pool.js'
import { hashPassword } from '../lib/auth.js'

/**
 * Redefine a senha de um administrador.
 *
 * Serve para o dono da loja recuperar o acesso quando esquece a senha — como o
 * hash é bcrypt (mão única), a senha antiga não pode ser lida, só substituída.
 *
 * Uso:
 *   node server/db/reset-admin.js                  → senha aleatória, mostrada uma vez
 *   NEW_ADMIN_PASSWORD=minhasenha node ...         → define uma senha escolhida
 *   ADMIN_EMAIL=outro@email.com node ...           → escolhe qual admin redefinir
 */

/** Senha aleatória fácil de digitar: sem caracteres ambíguos (0/O, 1/l/I). */
function gerarSenha(tamanho = 14) {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  const bytes = randomBytes(tamanho)
  let senha = ''
  for (let i = 0; i < tamanho; i++) senha += alfabeto[bytes[i] % alfabeto.length]
  return senha
}

const run = async () => {
  const email = process.env.ADMIN_EMAIL ?? 'admin@totalpack.com.br'
  const novaSenha = process.env.NEW_ADMIN_PASSWORD || gerarSenha()

  const { rows } = await pool.query(
    `UPDATE admins SET password_hash = $1 WHERE lower(email) = lower($2)
     RETURNING email`,
    [await hashPassword(novaSenha), email],
  )

  if (rows.length === 0) {
    console.error(`\n[reset] Nenhum admin com o e-mail "${email}".`)
    const { rows: todos } = await pool.query(`SELECT email FROM admins ORDER BY email`)
    if (todos.length) {
      console.error('[reset] Admins cadastrados:')
      todos.forEach((a) => console.error(`         - ${a.email}`))
      console.error('[reset] Rode de novo com ADMIN_EMAIL=<um desses>.')
    }
    await pool.end()
    process.exit(1)
  }

  console.log('\n========================================')
  console.log('  SENHA DO ADMIN REDEFINIDA')
  console.log('========================================')
  console.log(`  E-mail: ${rows[0].email}`)
  console.log(`  Senha:  ${novaSenha}`)
  console.log('========================================')
  console.log('  Entre no painel e troque a senha em')
  console.log('  Configurações. Esta senha não será')
  console.log('  mostrada de novo.')
  console.log('========================================\n')

  await pool.end()
}

run().catch(async (err) => {
  console.error('[reset] falhou:', err.message)
  await pool.end()
  process.exit(1)
})
