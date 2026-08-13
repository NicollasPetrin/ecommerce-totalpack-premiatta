import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import express from 'express'
import cookieParser from 'cookie-parser'
import cors from 'cors'
import { config } from './config.js'
import { pool } from './db/pool.js'
import { readSession } from './lib/auth.js'
import { securityHeaders } from './lib/security.js'
import { limiteGeral } from './lib/ratelimit.js'
import { errorHandler, notFound } from './lib/http.js'
import { authRoutes } from './routes/auth.js'
import { catalogRoutes } from './routes/catalog.js'
import { orderRoutes } from './routes/orders.js'
import { storeRoutes } from './routes/store.js'
import { shipmentRoutes } from './routes/shipments.js'
import { webhookRoutes } from './routes/webhooks.js'

const app = express()

app.disable('x-powered-by')
app.set('trust proxy', 1)

// Antes de tudo, inclusive dos webhooks: cabeçalho de segurança não depende
// de rota e não deve poder ser esquecido em nenhuma delas.
app.use(securityHeaders)

/**
 * Webhooks vêm antes do express.json de propósito: a conferência de assinatura
 * precisa dos bytes exatos que a processadora enviou, e interpretar o JSON
 * aqui destruiria isso. A rota traz o próprio express.raw.
 */
app.use('/api/webhooks', webhookRoutes)

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

/* Teto geral da API. Fica depois dos webhooks de propósito: a processadora
   pode mandar uma rajada de notificações legítimas, e barrá-la faria a loja
   perder confirmação de pagamento. Aquela rota se defende pela assinatura. */
app.use('/api', limiteGeral)

app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1')
    res.json({ ok: true, db: 'conectado', pagamento: config.paymentProvider })
  } catch (err) {
    res.status(503).json({ ok: false, db: 'indisponível', error: err.message })
  }
})

app.use('/api/auth', authRoutes)
app.use('/api/orders', orderRoutes)
app.use('/api', catalogRoutes)
app.use('/api', storeRoutes)
app.use('/api', shipmentRoutes)

// Precisa vir antes dos arquivos estáticos: uma rota /api inexistente é erro
// de API, não um endereço da loja para o React resolver.
app.use('/api', (_req, _res, next) => next(notFound('Rota não encontrada.')))

/**
 * Em produção o Express também entrega o site. No desenvolvimento quem serve
 * o front é o Vite, então este bloco fica inativo enquanto `dist/` não existe.
 */
const distDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')

if (existsSync(distDir)) {
  // Os arquivos com hash no nome nunca mudam de conteúdo; o index.html sim.
  app.use(
    express.static(distDir, {
      maxAge: '1y',
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache')
      },
    }),
  )

  // Endereços como /catalogo ou /admin existem só no roteador do React:
  // qualquer caminho não encontrado devolve o index.html.
  app.get('*', (_req, res) => res.sendFile(join(distDir, 'index.html')))
} else if (config.isProduction) {
  console.warn('[api] dist/ não encontrado — rode `npm run build` antes de `npm start`.')
}

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
