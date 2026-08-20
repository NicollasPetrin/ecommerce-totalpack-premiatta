/**
 * Adaptador do Base ERP (Asaas).
 *
 * Emite NF-e modelo 55 — o documento de mercadoria. É o que a loja precisa:
 * NFS-e é nota de serviço, e papel não é serviço.
 *
 * O fluxo do Base é encadeado, e cada elo precisa do id do anterior:
 *
 *   cliente → produtos → pedido de venda → nota
 *
 * A emissão é **assíncrona**: `POST /invoice` devolve "PROCESSANDO" e a nota
 * fica numa fila do lado de lá. A chave de acesso só aparece depois, por
 * webhook. Quem tratar a resposta como final vai gravar nota sem chave e
 * mandar etiqueta sem documento.
 */

import { config } from '../../config.js'

const PRODUCAO = 'https://api.baseerp.com.br'
const HOMOLOGACAO = 'https://api-sandbox.baseerp.com.br'

const base = (sandbox) =>
  config.fiscalBaseUrl || (sandbox ? HOMOLOGACAO : PRODUCAO)

/**
 * Situações que o Base devolve, traduzidas para os cinco estados que a loja
 * entende. A lista de origem tem mais de vinte valores; a maioria são fases
 * intermediárias da fila e da SEFAZ, e para a loja significam a mesma coisa:
 * ainda não dá para despachar.
 */
const SITUACOES = {
  // Ainda em andamento — não despachar.
  GRAVADA: 'processando',
  INICIADA: 'processando',
  PROCESSANDO: 'processando',
  PENDENTE: 'processando',
  PENDENTE_ENVIO_NOTAS: 'processando',
  PENDENTE_ENVIO_NFE_A3: 'processando',
  EM_PROCESSO_AUTORIZACAO: 'processando',
  ENVIADA: 'processando',
  CONTIGENCIA: 'processando',
  ENVIO_CARTA_CORRECAO: 'processando',

  // Autorizada: existe chave, a mercadoria pode viajar.
  EMITIDA: 'autorizada',
  NOTA_AUTORIZADA_DFE: 'autorizada',
  // Cancelamento recusado: a nota original continua valendo.
  CANCELAMENTO_NEGADO: 'autorizada',

  REJEITADA: 'rejeitada',
  NEGADA: 'rejeitada',
  DENEGADA: 'rejeitada',
  ERRO_ENVIO: 'rejeitada',
  AJUSTES_NECESSARIOS: 'rejeitada',

  CANCELADA: 'cancelada',
  INUTILIZADA: 'cancelada',
  // Cancelamento em curso conta como cancelada de propósito: entre despachar
  // uma nota que talvez morra e segurar o pacote, segurar é o erro barato.
  EM_PROCESSO_CANCELAMENTO: 'cancelada',
}

/** Situação desconhecida vira 'processando': espera é melhor que ficção. */
export const traduzirSituacao = (s) => SITUACOES[String(s ?? '').toUpperCase()] ?? 'processando'

const soDigitos = (v) => String(v ?? '').replace(/\D/g, '')

/** O Base recusa campo acima do limite em vez de cortar; cortamos antes. */
const ate = (v, n) => String(v ?? '').trim().slice(0, n)

/** AAAA-MM-DD no fuso de São Paulo — data de emissão não pode "voltar um dia". */
function hoje() {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  return f.format(new Date())
}

async function chamar(caminho, { chave, sandbox, method = 'GET', body } = {}) {
  let r
  try {
    r = await fetch(`${base(sandbox)}${caminho}`, {
      method,
      headers: {
        // O Base usa um cabeçalho próprio; não é Authorization: Bearer.
        access_token: chave,
        accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch (e) {
    throw new Error(`[base] não foi possível chamar a API: ${e.message}`)
  }

  const texto = await r.text()
  let corpo
  try {
    corpo = texto ? JSON.parse(texto) : {}
  } catch {
    corpo = { raw: texto.slice(0, 300) }
  }

  if (!r.ok) {
    // O Base devolve os problemas em `errors[]`, cada um com `description`.
    const lista = Array.isArray(corpo?.errors)
      ? corpo.errors.map((e) => e.description ?? e.code ?? '').filter(Boolean).join('; ')
      : ''
    const detalhe = lista || corpo?.message || corpo?.raw || 'sem detalhe'
    const err = new Error(`[base] HTTP ${r.status} — ${detalhe}`)
    err.status = r.status
    err.body = corpo
    throw err
  }

  return corpo
}

export const baseErp = {
  id: 'base',
  label: 'Base ERP (Asaas)',

  /**
   * Cadastra o comprador. `externalReference` carrega o documento para o Base
   * reconhecer quem já existe — sem isso, cada compra criaria um cadastro novo.
   */
  async criarCliente({ chave, sandbox, cliente }) {
    const doc = soDigitos(cliente.doc)
    const r = await chamar('/api/v1/customers', {
      chave,
      sandbox,
      method: 'POST',
      body: {
        name: ate(cliente.nome, 60),
        cpfCnpj: ate(doc, 14),
        email: ate(cliente.email, 60),
        mobilePhone: ate(soDigitos(cliente.telefone), 14),
        externalReference: ate(doc, 250),
        billingAddress: {
          zipCode: soDigitos(cliente.cep),
          street: ate(cliente.rua, 120),
          number: ate(cliente.numero, 20),
          complement: ate(cliente.complemento, 60),
          neighborhood: ate(cliente.bairro, 60),
          city: ate(cliente.cidade, 60),
          state: ate(cliente.uf, 2).toUpperCase(),
        },
      },
    })
    return String(r?.id ?? '')
  },

  /**
   * Cadastra o produto. NCM e unidade são exigidos pelo Base para a nota sair;
   * o resto do tratamento fiscal fica na configuração do emissor.
   */
  async criarProduto({ chave, sandbox, produto }) {
    const r = await chamar('/api/v1/products', {
      chave,
      sandbox,
      method: 'POST',
      body: {
        name: ate(produto.nome, 120),
        code: ate(produto.codigo, 60),
        ncm: ate(soDigitos(produto.ncm), 8),
        unit: ate(produto.unidade, 6),
        ...(produto.gtin ? { barcode: ate(soDigitos(produto.gtin), 14) } : {}),
        ...(produto.preco ? { salePrice: Number(produto.preco) } : {}),
        externalReference: ate(produto.id, 255),
        ...(produto.cclassTrib ? { cClassTrib: ate(produto.cclassTrib, 20) } : {}),
      },
    })
    return String(r?.id ?? '')
  },

  /**
   * Pedido de venda: é dele que a nota nasce.
   *
   * O frete vai em `costOfShipping` porque compõe a base de cálculo da NF-e —
   * deixar de fora emite nota de valor menor que o cobrado.
   */
  async criarPedido({ chave, sandbox, pedido }) {
    const r = await chamar('/api/v1/salesOrders', {
      chave,
      sandbox,
      method: 'POST',
      body: {
        issueDate: hoje(),
        customerId: Number(pedido.clienteId),
        externalReference: ate(pedido.id, 250),
        observations: ate(pedido.observacao, 255),
        costOfShipping: Number(pedido.frete ?? 0),
        orderItems: pedido.itens.map((i) => ({
          productId: Number(i.produtoId),
          quantity: Number(i.qtd),
          unitPrice: Number(i.preco),
          ...(i.cclassTrib ? { cClassTrib: ate(i.cclassTrib, 20) } : {}),
        })),
        // Sem conta configurada no emissor não há como lançar o recebimento —
        // e a nota sai igual, porque `orderPayments` é opcional.
        ...(pedido.bankId
          ? {
              orderPayments: [
                {
                  dueDate: hoje(),
                  value: Number(pedido.total),
                  bankId: Number(pedido.bankId),
                  billingType: pedido.formaPagamento === 'boleto' ? 'BOLETO' : 'PIX',
                  ...(pedido.pagamentoId ? { paymentId: String(pedido.pagamentoId) } : {}),
                },
              ],
            }
          : {}),
      },
    })
    return String(r?.id ?? '')
  },

  /**
   * Pede a emissão. Devolve situação, não a nota pronta: o retorno normal aqui
   * é "PROCESSANDO", e a chave chega depois pelo webhook.
   */
  async emitir({ chave, sandbox, pedidoExternoId }) {
    const r = await chamar(`/api/v1/salesOrders/${pedidoExternoId}/invoice`, {
      chave,
      sandbox,
      method: 'POST',
      // 55 = NF-e (mercadoria). 65 seria NFC-e, que é venda presencial.
      body: { type: '55' },
    })

    return {
      invoiceId: String(r?.invoiceId ?? ''),
      numero: String(r?.invoiceNumber ?? ''),
      status: traduzirSituacao(r?.invoiceStatus),
      raw: r,
    }
  },

  /**
   * Lê a notificação de mudança de situação.
   *
   * Os nomes de campo variam conforme o evento, e a documentação pública não
   * fixa o formato — por isso a leitura é tolerante e o corpo cru fica gravado
   * em `raw`. Se algum campo vier com outro nome, o dado não se perde: aparece
   * no painel e o mapeamento se corrige aqui, num lugar só.
   */
  parseEvent({ body }) {
    const nf = body?.invoice ?? body?.nfe ?? body?.data ?? body ?? {}
    const pedidoExternoId = String(
      nf.salesOrderId ?? nf.orderId ?? body?.salesOrderId ?? body?.id ?? '',
    )
    if (!pedidoExternoId) return null

    const evento = String(body?.event ?? '')
    // O evento é mais confiável que a situação quando os dois vêm juntos:
    // ele é o motivo da notificação.
    const porEvento = /AUTHORIZED|AUTORIZAD/i.test(evento)
      ? 'autorizada'
      : /CANCEL/i.test(evento)
        ? 'cancelada'
        : /REJECT|DENIED|ERROR/i.test(evento)
          ? 'rejeitada'
          : null

    return {
      pedidoExternoId,
      invoiceId: String(nf.invoiceId ?? nf.id ?? ''),
      status: porEvento ?? traduzirSituacao(nf.invoiceStatus ?? nf.status),
      numero: String(nf.invoiceNumber ?? nf.number ?? ''),
      serie: String(nf.series ?? nf.serie ?? ''),
      // 44 dígitos. É o que vai na etiqueta de envio.
      chave: soDigitos(nf.accessKey ?? nf.key ?? nf.chaveAcesso ?? ''),
      pdfUrl: String(nf.danfeUrl ?? nf.pdfUrl ?? nf.danfe ?? ''),
      xmlUrl: String(nf.xmlUrl ?? nf.xml ?? ''),
      erro: String(nf.rejectionReason ?? nf.errorMessage ?? nf.message ?? ''),
      raw: body,
    }
  },
}
