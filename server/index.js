import express from 'express'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import { config } from './config.js'
import { pool } from './db/pool.js'
import { readSession } from './lib/auth.js'
import { errorHandler, notFound } from './lib/http.js'
import { authRoutes } from './routes/auth.js'
import { catalogRoutes } from './routes/catalog.js'
import { orderRoutes } from './routes/orders.js'
import { storeRoutes } from './routes/store.js'

const app = express()

app.disable('x-powered-by')
app.set('trust proxy', 1)

// Imagens de produto chegam como data URI em base64; o limite padrão de 100 kb
// do Express derrubaria o cadastro.
app.use(express.json({ limit: '2mb' }))
app.use(cookieParser())

app.use(
  cors({
    origin: config.corsOrigin,
    // Necessário para o cookie de sessão atravessar portas diferentes no dev.
    credentials: true,
  }),
)

app.use(readSession)

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1')
    res.json({ ok: true, db: 'conectado' })
  } catch (err) {
    res.status(503).json({ ok: false, db: 'indisponível', error: err.message })
  }
})

app.use('/api/auth', authRoutes)
app.use('/api/orders', orderRoutes)
app.use('/api', catalogRoutes)
app.use('/api', storeRoutes)

app.use('/api', (_req, _res, next) => next(notFound('Rota não encontrada.')))
app.use(errorHandler)

const server = app.listen(config.port, () => {
  console.log(`[api] ouvindo em http://localhost:${config.port}`)
  console.log(`[api] front autorizado: ${config.corsOrigin}`)
})

/** Encerra conexões antes de sair, para não deixar sessões penduradas no banco. */
const shutdown = async (signal) => {
  console.log(`\n[api] ${signal} recebido, encerrando…`)
  server.close(async () => {
    await pool.end()
    process.exit(0)
  })
  setTimeout(() => process.exit(1), 10_000).unref()
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
