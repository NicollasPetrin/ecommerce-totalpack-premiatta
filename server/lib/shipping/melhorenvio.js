import { config } from '../../config.js'
import { tokenDaTransportadora } from './credenciais.js'

/**
 * Adaptador do Melhor Envio.
 *
 * O ciclo de uma etiqueta lá tem quatro passos, e cada um pode falhar sozinho:
 *
 *   1. `/cart`      — coloca o frete no carrinho (ainda não custa nada)
 *   2. `/checkout`  — paga com o saldo da carteira
 *   3. `/generate`  — emite a etiqueta
 *   4. `/print`     — devolve o PDF para imprimir
 *
 * Guardamos o id do carrinho já no passo 1: se o processo morrer no meio, a
 * próxima tentativa retoma de onde parou em vez de comprar de novo.
 */

const cfg = () => config.melhorEnvio

/** Os quatro passos mapeados para o nosso status. */
const STATUS = {
  pending: 'rascunho',
  paid: 'pago',
  generating: 'pago',
  released: 'gerada',
  posted: 'postado',
  delivered: 'entregue',
  canceled: 'cancelado',
  expired: 'cancelado',
}

async function call(caminho, opts = {}) {
  const { baseUrl, userAgent } = cfg()
  // O token vem do painel quando houver; senão, da variável de ambiente.
  const token = await tokenDaTransportadora()
  const url = `${baseUrl}/api/v2${caminho}`

  let r
  try {
    r = await fetch(url, {
      ...opts,
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        // Obrigatório: a API recusa requisição sem isto.
        'User-Agent': userAgent,
        ...opts.headers,
      },
    })
  } catch (e) {
    /* Falha antes de haver resposta: DNS, TLS, rede, ou cabeçalho inválido.
       Sem isto o erro chegaria como "fetch failed", que não diz nada. */
    const err = new Error(`[melhorenvio] falha de rede ao chamar ${url}: ${e.message}`)
    err.body = { causa: e.cause?.message ?? String(e), url }
    throw err
  }

  const texto = await r.text()
  let corpo
  try {
    corpo = texto ? JSON.parse(texto) : {}
  } catch {
    // Resposta que não é JSON costuma ser página de erro ou de login.
    corpo = { raw: texto.slice(0, 400) }
  }

  if (!r.ok) {
    // A API devolve o erro em formatos diferentes conforme o endpoint.
    const detalhe =
      corpo?.message ??
      corpo?.error ??
      (corpo?.errors && Object.values(corpo.errors).flat().join('; ')) ??
      corpo?.raw ??
      'sem detalhe'

    // O status vai sempre na mensagem: é o que separa credencial (401),
    // permissão (403) e endereço errado (404).
    const err = new Error(`[melhorenvio] HTTP ${r.status} em ${caminho} — ${detalhe}`)
    err.status = r.status
    err.body = corpo
    throw err
  }

  return corpo
}

/**
 * Documento no campo certo.
 *
 * A API separa pessoa física de jurídica: `document` só aceita CPF e
 * `company_document` só aceita CNPJ. Mandar CNPJ em `document` devolve 422
 * dizendo que o campo "deve ter um CPF válido" — que soa como valor inválido,
 * mas é campo trocado.
 */
function documentoDe(doc) {
  const digitos = String(doc ?? '').replace(/\D/g, '')
  if (digitos.length === 14) return { company_document: digitos }
  if (digitos.length === 11) return { document: digitos }
  // Nem um nem outro: manda vazio e deixa a API dizer o que falta.
  return { document: digitos }
}

/** Converte um pedido nosso no formato de volume que a API espera. */
function montarVolumes(itens) {
  return itens.map((i) => ({
    // Gramas para quilos: a API trabalha em kg.
    weight: Math.max(0.01, (i.weightG ?? 0) / 1000),
    width: Math.max(1, i.widthCm ?? 0),
    height: Math.max(1, i.heightCm ?? 0),
    length: Math.max(1, i.lengthCm ?? 0),
    insurance_value: Number(i.price ?? 0),
    quantity: i.qty,
  }))
}

export const melhorenvio = {
  id: 'melhorenvio',
  label: 'Melhor Envio',

  /** Serviços disponíveis e preço, para o admin escolher antes de comprar. */
  async cotar({ remetente, destinatario, itens }) {
    const resposta = await call('/me/shipment/calculate', {
      method: 'POST',
      body: JSON.stringify({
        from: { postal_code: remetente.cep },
        to: { postal_code: destinatario.cep },
        products: itens.map((i) => ({
          id: i.id,
          width: Math.max(1, i.widthCm ?? 0),
          height: Math.max(1, i.heightCm ?? 0),
          length: Math.max(1, i.lengthCm ?? 0),
          weight: Math.max(0.01, (i.weightG ?? 0) / 1000),
          insurance_value: Number(i.price ?? 0),
          quantity: i.qty,
        })),
      }),
    })

    // Serviços sem cobertura vêm na mesma lista, com um campo `error`.
    return (Array.isArray(resposta) ? resposta : [])
      .filter((s) => !s.error)
      .map((s) => ({
        servicoId: String(s.id),
        nome: s.name,
        transportadora: s.company?.name ?? '',
        preco: Number(s.price ?? 0),
        prazoDias: Number(s.delivery_time ?? 0),
      }))
  },

  /** Passo 1: põe no carrinho. Ainda não gasta saldo. */
  async adicionarAoCarrinho({ servicoId, remetente, destinatario, itens, pedido }) {
    const resposta = await call('/me/cart', {
      method: 'POST',
      body: JSON.stringify({
        service: Number(servicoId),
        from: {
          name: remetente.nome,
          phone: remetente.telefone,
          email: remetente.email,
          ...documentoDe(remetente.doc),
          address: remetente.rua,
          complement: remetente.complemento,
          number: remetente.numero,
          district: remetente.bairro,
          city: remetente.cidade,
          state_abbr: remetente.uf,
          postal_code: remetente.cep,
        },
        to: {
          name: destinatario.nome,
          phone: destinatario.telefone,
          email: destinatario.email,
          ...documentoDe(destinatario.doc),
          address: destinatario.rua,
          complement: destinatario.complemento,
          number: destinatario.numero,
          district: destinatario.bairro,
          city: destinatario.cidade,
          state_abbr: destinatario.uf,
          postal_code: destinatario.cep,
        },
        products: itens.map((i) => ({
          name: i.name,
          quantity: i.qty,
          unitary_value: Number(i.price ?? 0),
        })),
        volumes: montarVolumes(itens),
        options: {
          insurance_value: Number(pedido.total ?? 0),
          receipt: false,
          own_hand: false,
          reverse: false,
          non_commercial: true,
          // Aparece na etiqueta e liga a encomenda ao pedido na loja.
          invoice: { key: '' },
          platform: 'TotalPack',
          tags: [{ tag: pedido.codigo, url: null }],
        },
      }),
    })

    return { externalId: String(resposta.id), raw: resposta }
  },

  /** Passo 2: paga com o saldo da carteira. */
  async comprar({ externalId }) {
    return call('/me/shipment/checkout', {
      method: 'POST',
      body: JSON.stringify({ orders: [externalId] }),
    })
  },

  /** Passo 3: emite. */
  async gerar({ externalId }) {
    return call('/me/shipment/generate', {
      method: 'POST',
      body: JSON.stringify({ orders: [externalId] }),
    })
  },

  /** Passo 4: devolve a URL do PDF. */
  async imprimir({ externalId }) {
    const r = await call('/me/shipment/print', {
      method: 'POST',
      body: JSON.stringify({ mode: 'private', orders: [externalId] }),
    })
    return r?.url ?? ''
  },

  /** Estado atual de uma etiqueta, direto da fonte. */
  async consultar({ externalId }) {
    const r = await call(`/me/orders/${encodeURIComponent(externalId)}`)
    return {
      status: STATUS[r.status] ?? 'erro',
      tracking: r.tracking ?? '',
      carrier: r.company?.name ?? '',
      servico: r.service?.name ?? '',
      custo: Number(r.price ?? 0),
      raw: r,
    }
  },

  async cancelar({ externalId, motivo = 'Cancelado pela loja' }) {
    return call('/me/shipment/cancel', {
      method: 'POST',
      body: JSON.stringify({
        order: { id: externalId, reason_id: '2', description: motivo },
      }),
    })
  },

  /**
   * Extrai os ids de etiqueta de uma notificação.
   *
   * O corpo não é confiável — serve só para saber o que consultar. O formato
   * varia conforme o evento, então aceitamos as três formas conhecidas em vez
   * de assumir uma.
   */
  parseEvent(corpo) {
    const ids = new Set()

    const coletar = (v) => {
      if (!v) return
      if (typeof v === 'string' || typeof v === 'number') ids.add(String(v))
      else if (Array.isArray(v)) v.forEach(coletar)
      else if (typeof v === 'object') coletar(v.id)
    }

    coletar(corpo.id)
    coletar(corpo.order_id)
    coletar(corpo.orders)
    coletar(corpo.data)

    return [...ids].filter(Boolean)
  },
}
