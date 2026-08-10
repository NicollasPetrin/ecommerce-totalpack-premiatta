import 'dotenv/config'

const required = (name, fallback) => {
  const value = process.env[name] ?? fallback
  if (value === undefined) {
    console.error(`\n[config] Falta a variável ${name}. Copie .env.example para .env.\n`)
    process.exit(1)
  }
  return value
}

const isProduction = process.env.NODE_ENV === 'production'

export const config = {
  isProduction,
  // API_PORT tem prioridade: alguns ambientes (o preview do editor, por
  // exemplo) definem PORT para o servidor do front, e as duas coisas
  // acabariam disputando a mesma porta.
  port: Number(process.env.API_PORT ?? process.env.PORT ?? 3333),
  databaseUrl: required('DATABASE_URL'),
  jwtSecret: required('JWT_SECRET'),
  // Origem do front no desenvolvimento; em produção o front é servido junto.
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
  cookieName: 'totalpack_session',
  // 7 dias
  sessionMaxAge: 7 * 24 * 60 * 60 * 1000,

  /* ---- Pagamento ----
     'manual' = sem processadora, acerto fora do site (comportamento atual).
     Ao integrar uma de verdade, troque PAYMENT_PROVIDER e preencha as chaves.
     A chave secreta e o segredo do webhook nunca entram no repositório. */
  paymentProvider: process.env.PAYMENT_PROVIDER ?? 'manual',
  paymentPublicKey: process.env.PAYMENT_PUBLIC_KEY ?? '',
  paymentSecretKey: process.env.PAYMENT_SECRET_KEY ?? '',
  paymentWebhookSecret: process.env.PAYMENT_WEBHOOK_SECRET ?? '',
  /** Base pública da loja, para montar as URLs de retorno e de webhook. */
  publicUrl: (process.env.PUBLIC_URL ?? 'http://localhost:5173').replace(/\/+$/, ''),
}

if (config.paymentProvider !== 'manual' && !config.paymentSecretKey) {
  console.error(
    `\n[config] PAYMENT_PROVIDER=${config.paymentProvider} exige PAYMENT_SECRET_KEY.\n`,
  )
  process.exit(1)
}

if (isProduction && config.paymentProvider !== 'manual' && !config.paymentWebhookSecret) {
  console.error(
    '\n[config] Em produção, PAYMENT_WEBHOOK_SECRET é obrigatório: sem ele não dá\n' +
      '         para confirmar que a notificação veio mesmo da processadora.\n',
  )
  process.exit(1)
}

if (isProduction && config.jwtSecret.length < 32) {
  console.error('\n[config] JWT_SECRET curto demais para produção (mínimo 32 caracteres).\n')
  process.exit(1)
}
