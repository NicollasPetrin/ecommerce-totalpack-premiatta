import { pool } from './pool.js'

/**
 * Apaga tudo e devolve o banco ao estado vazio. Destrutivo de propósito —
 * pensado para desenvolvimento, nunca para produção.
 */
const run = async () => {
  if (process.env.NODE_ENV === 'production') {
    console.error('[db] reset bloqueado em produção.')
    process.exit(1)
  }

  console.log('[db] apagando o esquema público…')
  await pool.query(`DROP SCHEMA public CASCADE; CREATE SCHEMA public;`)
  console.log('[db] pronto. Rode: npm run db:migrate && npm run db:seed')
  await pool.end()
}

run().catch(async (err) => {
  console.error('[db] falha ao resetar:', err.message)
  await pool.end()
  process.exit(1)
})
