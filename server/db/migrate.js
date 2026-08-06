import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { pool } from './pool.js'

const here = dirname(fileURLToPath(import.meta.url))

const run = async () => {
  const sql = await readFile(join(here, 'schema.sql'), 'utf8')
  console.log('[db] aplicando esquema…')
  await pool.query(sql)
  console.log('[db] esquema aplicado.')
  await pool.end()
}

run().catch(async (err) => {
  console.error('[db] falha ao migrar:', err.message)
  await pool.end()
  process.exit(1)
})
