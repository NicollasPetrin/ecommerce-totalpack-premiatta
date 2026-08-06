import pg from 'pg'
import { config } from '../config.js'

/**
 * NUMERIC chega do driver como string, para não perder precisão. Como todos os
 * nossos NUMERIC são dinheiro com 2 casas, converter para Number é seguro e
 * evita `"27.90"` vazando para o front.
 */
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => (v === null ? null : Number(v)))

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
})

pool.on('error', (err) => {
  console.error('[db] erro no pool de conexões:', err.message)
})

/** Consulta simples. Sempre com parâmetros — nunca concatene SQL. */
export const query = (text, params) => pool.query(text, params)

/** Primeira linha, ou null. */
export async function one(text, params) {
  const { rows } = await pool.query(text, params)
  return rows[0] ?? null
}

/** Todas as linhas. */
export async function many(text, params) {
  const { rows } = await pool.query(text, params)
  return rows
}

/**
 * Executa uma função dentro de uma transação, com rollback automático em erro.
 * Usado onde várias tabelas mudam juntas — criar pedido, por exemplo.
 */
export async function transaction(fn) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await fn(client)
    await client.query('COMMIT')
    return result
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
