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

  /* ---- Asaas ----
     O endereço da API muda entre sandbox e produção, e já mudou de forma ao
     longo do tempo — por isso é configurável em vez de fixo no código.
     Confira o valor atual na documentação antes de apontar para produção. */
  asaasBaseUrl: (
    process.env.ASAAS_BASE_URL ?? 'https://api-sandbox.asaas.com/v3'
  ).replace(/\/+$/, ''),
  /** Dias até o vencimento do boleto/PIX gerado. */
  asaasDueDays: Number(process.env.ASAAS_DUE_DAYS ?? 3),

  /** Nome usado na descrição da cobrança que o cliente vê. */
  storeLabel: process.env.STORE_LABEL ?? 'TotalPack',

  /* ---- Envio ----
     'manual' = sem transportadora integrada; a etiqueta é emitida fora do
     site, como é hoje. O frete cobrado do cliente continua saindo da tabela
     de faixas de CEP em qualquer caso — a transportadora entra só para
     emitir a etiqueta, que é mais previsível para quem compra. */
  shippingProvider: process.env.SHIPPING_PROVIDER ?? 'manual',

  melhorEnvio: {
    baseUrl: (
      process.env.MELHORENVIO_BASE_URL ?? 'https://sandbox.melhorenvio.com.br'
    ).replace(/\/+$/, ''),
    token: process.env.MELHORENVIO_TOKEN ?? '',
    // O access_token vale 30 dias e o refresh 45. Sem estes dois, a renovação
    // não acontece e a emissão para de funcionar em um mês, sem aviso.
    clientId: process.env.MELHORENVIO_CLIENT_ID ?? '',
    clientSecret: process.env.MELHORENVIO_CLIENT_SECRET ?? '',
    refreshToken: process.env.MELHORENVIO_REFRESH_TOKEN ?? '',
    /* Cabeçalho obrigatório: a API recusa requisição sem nome da aplicação e
       e-mail de contato. */
    userAgent: process.env.MELHORENVIO_USER_AGENT ?? '',
  },
}

/**
 * Guarda contra o acidente mais caro possível: apontar para a API de produção
 * do Asaas com uma chave de sandbox, ou o contrário. As chaves têm prefixos
 * diferentes, então dá para conferir.
 */
if (config.paymentProvider === 'asaas' && config.paymentSecretKey) {
  const chaveDeProducao = config.paymentSecretKey.includes('_prod_')

  // A conferência só vale para endereços reais do Asaas. Um servidor local
  // (teste automatizado, mock) não é nem produção nem sandbox — opinar sobre
  // ele só atrapalharia, e não é dali que sai cobrança de verdade.
  const ehAsaas = /(^|\.)asaas\.com/.test(config.asaasBaseUrl)
  const apiDeProducao = ehAsaas && !config.asaasBaseUrl.includes('sandbox')

  if (ehAsaas && chaveDeProducao !== apiDeProducao) {
    console.error(
      '\n[config] Chave do Asaas e endereço da API não combinam:\n' +
        `         chave: ${chaveDeProducao ? 'produção' : 'sandbox'}\n` +
        `         API:   ${config.asaasBaseUrl}\n` +
        '         Ajuste ASAAS_BASE_URL ou PAYMENT_SECRET_KEY.\n',
    )
    process.exit(1)
  }

  if (chaveDeProducao && ehAsaas && !isProduction) {
    console.warn(
      '\n[config] ATENÇÃO: chave de PRODUÇÃO do Asaas fora do ambiente de\n' +
        '         produção. Cobranças criadas aqui são reais.\n',
    )
  }
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

if (config.shippingProvider === 'melhorenvio') {
  if (!config.melhorEnvio.token) {
    console.error('\n[config] SHIPPING_PROVIDER=melhorenvio exige MELHORENVIO_TOKEN.\n')
    process.exit(1)
  }

  if (!config.melhorEnvio.userAgent) {
    console.error(
      '\n[config] MELHORENVIO_USER_AGENT é obrigatório: a API recusa requisição\n' +
        '         sem nome da aplicação e e-mail de contato.\n' +
        '         Exemplo: "TOTALPACK (contato@totalpack.app.br)"\n',
    )
    process.exit(1)
  }

  /* Mesmo guarda do Asaas: apontar a chave de produção para o sandbox (ou o
     contrário) só aparece quando a etiqueta errada já foi comprada. */
  const ehSandbox = config.melhorEnvio.baseUrl.includes('sandbox')
  if (isProduction && ehSandbox) {
    console.warn(
      '\n[config] ATENÇÃO: em produção apontando para o sandbox do Melhor Envio.\n' +
        '         As etiquetas geradas aqui não valem para postagem.\n',
    )
  }

  if (!config.melhorEnvio.refreshToken || !config.melhorEnvio.clientId) {
    console.warn(
      '\n[config] Melhor Envio sem dados de renovação (CLIENT_ID/REFRESH_TOKEN).\n' +
        '         O token vale 30 dias e a emissão vai parar quando ele vencer.\n',
    )
  }
}

if (isProduction && config.jwtSecret.length < 32) {
  console.error('\n[config] JWT_SECRET curto demais para produção (mínimo 32 caracteres).\n')
  process.exit(1)
}
