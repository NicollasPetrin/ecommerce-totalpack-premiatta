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
}

if (isProduction && config.jwtSecret.length < 32) {
  console.error('\n[config] JWT_SECRET curto demais para produção (mínimo 32 caracteres).\n')
  process.exit(1)
}
