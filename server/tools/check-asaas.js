import { config } from '../config.js'

/**
 * Confere a conexão com o Asaas antes de qualquer teste de compra.
 *
 * Faz uma chamada inofensiva (listar clientes, limite 1) só para descobrir se
 * a chave é aceita e se o endereço da API está certo. Não cria nada.
 *
 * Uso: npm run asaas:check
 */

const mascarar = (chave) =>
  chave ? `${chave.slice(0, 12)}${'•'.repeat(8)}` : '(vazia)'

const run = async () => {
  console.log('\n--- Configuração ---')
  console.log('  processadora:', config.paymentProvider)
  console.log('  API:         ', config.asaasBaseUrl)
  console.log('  chave:       ', mascarar(config.paymentSecretKey))
  console.log('  webhook:     ', config.paymentWebhookSecret ? 'definido' : '(vazio)')
  console.log('  PUBLIC_URL:  ', config.publicUrl)

  if (config.paymentProvider !== 'asaas') {
    console.log('\n[!] PAYMENT_PROVIDER não é "asaas" — nada a conferir.\n')
    process.exit(0)
  }

  if (!config.paymentSecretKey) {
    console.error('\n[x] PAYMENT_SECRET_KEY está vazia.\n')
    process.exit(1)
  }

  const ambiente = config.paymentSecretKey.includes('_prod_') ? 'PRODUÇÃO' : 'sandbox'
  console.log('  ambiente:    ', ambiente)

  if (ambiente === 'PRODUÇÃO') {
    console.warn('\n[!] Esta é uma chave de PRODUÇÃO. Cobranças criadas serão reais.\n')
  }

  console.log('\n--- Testando a conexão ---')

  let resposta
  try {
    resposta = await fetch(`${config.asaasBaseUrl}/customers?limit=1`, {
      headers: {
        'Content-Type': 'application/json',
        access_token: config.paymentSecretKey,
        'User-Agent': 'TotalPack',
      },
    })
  } catch (err) {
    console.error('\n[x] Não foi possível alcançar o endereço.')
    console.error('    ', err.message)
    console.error('\n    Confira ASAAS_BASE_URL. Valores usuais:')
    console.error('      sandbox : https://api-sandbox.asaas.com/v3')
    console.error('      produção: https://api.asaas.com/v3')
    console.error('    Confirme o atual na documentação do Asaas.\n')
    process.exit(1)
  }

  const corpo = await resposta.text()

  if (resposta.status === 401) {
    console.error('\n[x] Chave recusada (401).')
    console.error('    A chave é do mesmo ambiente que a API? Sandbox e produção')
    console.error('    têm chaves diferentes.\n')
    process.exit(1)
  }

  if (!resposta.ok) {
    console.error(`\n[x] Asaas respondeu ${resposta.status}.`)
    console.error('   ', corpo.slice(0, 400), '\n')
    process.exit(1)
  }

  let dados
  try {
    dados = JSON.parse(corpo)
  } catch {
    console.error('\n[x] Resposta não é JSON — o endereço aponta para o lugar certo?')
    console.error('   ', corpo.slice(0, 200), '\n')
    process.exit(1)
  }

  console.log('\n[ok] Conexão funcionando.')
  console.log('     clientes já cadastrados nesta conta:', dados.totalCount ?? '(desconhecido)')

  console.log('\n--- Webhook ---')
  console.log('  Cadastre no painel do Asaas, em Integrações › Webhooks:')
  console.log(`    ${config.publicUrl.replace(':5173', ':3333')}/api/webhooks/payments/asaas`)
  console.log('  Token: o mesmo valor de PAYMENT_WEBHOOK_SECRET.')
  console.log('  Eventos: PAYMENT_CONFIRMED, PAYMENT_RECEIVED, PAYMENT_OVERDUE,')
  console.log('           PAYMENT_REFUNDED.')
  console.log('')
  console.log('  Em teste local, o Asaas não alcança o seu computador. Rode um túnel:')
  console.log('    npx localtunnel --port 3333')
  console.log('  e use a URL que ele devolver no lugar do endereço acima.\n')
}

run()
