import { Router } from 'express'
import express from 'express'
import { one } from '../db/pool.js'
import { wrap } from '../lib/http.js'
import { getProvider, listProviders } from '../lib/payments/index.js'
import { applyPaymentEvent } from '../lib/payments/service.js'
import { getShippingProvider, listShippingProviders } from '../lib/shipping/index.js'
import { autoBuyLabel, syncShipment } from '../lib/shipping/service.js'
import { listFiscalProviders } from '../lib/fiscal/index.js'
import { aplicarEventoFiscal } from '../lib/fiscal/service.js'
import { segredoConfere } from '../lib/security.js'
import { abrir } from '../lib/cofre.js'

export const webhookRoutes = Router()

/**
 * Notificações das processadoras.
 *
 * Três cuidados que definem se isto funciona ou vira um buraco:
 *
 * 1. **Corpo cru.** A assinatura é calculada sobre os bytes exatos que foram
 *    enviados. Se o JSON for interpretado antes, a reserialização muda espaços
 *    e ordem de chaves, e a conferência falha sempre. Por isso esta rota usa
 *    `express.raw` em vez do `express.json` global.
 *
 * 2. **Assinatura conferida antes de qualquer coisa.** Sem isso, quem
 *    descobrir a URL marca pedidos como pagos mandando um JSON.
 *
 * 3. **Idempotência.** A processadora reenvia o mesmo evento quando não recebe
 *    200. Registramos o `event_id` numa tabela com chave única: o segundo
 *    envio é reconhecido e ignorado, em vez de contabilizar o pagamento duas
 *    vezes.
 *
 * Respondemos 200 mesmo em evento repetido ou irrelevante — para a
 * processadora, 200 significa "recebi", não "concordo". Devolver erro faria
 * ela reenviar para sempre.
 */
webhookRoutes.post(
  '/payments/:provider',
  express.raw({ type: '*/*', limit: '1mb' }),
  wrap(async (req, res) => {
    const providerId = req.params.provider

    if (!listProviders().includes(providerId)) {
      // 404 e nada de detalhes: não confirmamos quais rotas existem.
      return res.status(404).json({ error: 'Não encontrado.' })
    }

    const provider = getProvider(providerId)
    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from('')

    if (!provider.verifySignature({ rawBody, headers: req.headers })) {
      console.warn(`[webhook] assinatura inválida de "${providerId}" — descartado`)
      return res.status(401).json({ error: 'Assinatura inválida.' })
    }

    let body
    try {
      body = JSON.parse(rawBody.toString('utf8') || '{}')
    } catch {
      return res.status(400).json({ error: 'Corpo inválido.' })
    }

    const event = provider.parseEvent({ body, headers: req.headers })
    if (!event) {
      // Evento que não nos diz respeito (mudança de cadastro, teste do painel).
      return res.json({ ok: true, ignorado: true })
    }

    // Registro antes de aplicar. O índice único derruba a segunda tentativa.
    let registro
    try {
      registro = await one(
        `INSERT INTO webhook_events (provider, event_id, event_type, payload)
         VALUES ($1,$2,$3,$4::jsonb)
         ON CONFLICT (provider, event_id) DO NOTHING
         RETURNING id`,
        [providerId, event.eventId, event.eventType ?? '', JSON.stringify(body)],
      )
    } catch (err) {
      console.error('[webhook] falha ao registrar evento:', err.message)
      return res.status(500).json({ error: 'Erro ao registrar evento.' })
    }

    if (!registro) {
      // Já tínhamos este evento. Nada a fazer, e está tudo certo.
      return res.json({ ok: true, repetido: true })
    }

    try {
      const resultado = await applyPaymentEvent({
        provider: providerId,
        providerRef: event.providerRef,
        status: event.status,
        paidAt: event.paidAt,
        payload: body,
      })

      await one(
        `UPDATE webhook_events SET processed_at = now(), error = $1
          WHERE id = $2 RETURNING id`,
        [resultado.applied ? null : resultado.reason, registro.id],
      )

      res.json({ ok: true, aplicado: resultado.applied })
    } catch (err) {
      console.error('[webhook] falha ao aplicar evento:', err.message)
      await one(`UPDATE webhook_events SET error = $1 WHERE id = $2 RETURNING id`, [
        err.message,
        registro.id,
      ]).catch(() => {})
      // 500 faz a processadora reenviar — é o que queremos num erro nosso.
      res.status(500).json({ error: 'Erro ao processar evento.' })
    }
  }),
)

/* ============================================================= Transportadora */

/**
 * Notificações da transportadora sobre etiquetas.
 *
 * Diferente do webhook de pagamento em um ponto importante: o corpo aqui **não
 * é fonte da verdade**. O Melhor Envio não assina a notificação, então
 * qualquer um que descubra a URL pode enviar um JSON dizendo o que quiser.
 *
 * Por isso o corpo serve só para saber *qual* etiqueta mexeu — o estado real é
 * buscado na API deles, com o nosso token, antes de gravar qualquer coisa.
 * Uma notificação forjada, no pior caso, gasta uma consulta à API.
 */
webhookRoutes.post(
  '/shipping/:provider',
  express.json({ limit: '256kb' }),
  wrap(async (req, res) => {
    const providerId = req.params.provider

    if (!listShippingProviders().includes(providerId)) {
      // 404 sem detalhes: não confirmamos quais rotas existem.
      return res.status(404).json({ error: 'Não encontrado.' })
    }

    const referencias = getShippingProvider(providerId).parseEvent(req.body ?? {})

    if (!referencias.length) {
      // Evento que não reconhecemos. 200 mesmo assim: devolver erro faria a
      // transportadora reenviar para sempre.
      return res.json({ ok: true, ignorado: true })
    }

    // Responde antes de sincronizar: a transportadora só precisa saber que
    // recebemos, e a consulta à API dela pode demorar mais que o tempo limite
    // do webhook.
    res.json({ ok: true, etiquetas: referencias.length })

    for (const ref of referencias) {
      try {
        await syncShipment(providerId, ref)
      } catch (err) {
        console.error(`[webhook] falha ao sincronizar etiqueta ${ref}:`, err.message)
      }
    }
  }),
)

/* =================================================================== Nota fiscal */

/**
 * Notificações do emissor sobre a situação da nota.
 *
 * Diferença que muda o desenho em relação ao webhook da transportadora: ali o
 * corpo é só um aviso, e o estado real é reconsultado na API deles. Aqui **o
 * corpo é a fonte da verdade** — a chave de acesso chega por ele e não há de
 * onde reconsultar.
 *
 * Isso torna a autenticação obrigatória, e não uma boa prática. Uma
 * notificação forjada marcaria a nota como autorizada, gravaria uma chave
 * inventada e faria a loja comprar etiqueta e despachar mercadoria com
 * documento falso. Por isso:
 *
 * - **Sem segredo configurado, a rota recusa tudo.** Falhar fechado é o único
 *   padrão aceitável quando o custo do engano é despachar nota falsa.
 * - A comparação é de tempo constante, para não vazar o segredo pela diferença
 *   de tempo entre uma resposta e outra.
 */
webhookRoutes.post(
  '/fiscal/:provider',
  express.json({ limit: '256kb' }),
  wrap(async (req, res) => {
    const providerId = req.params.provider

    if (!listFiscalProviders().includes(providerId) || providerId === 'nenhum') {
      // 404 sem detalhes: não confirmamos quais rotas existem.
      return res.status(404).json({ error: 'Não encontrado.' })
    }

    const cfg = await one(`SELECT fiscal_webhook_secret FROM settings WHERE id = true`)
    const esperado = abrir(cfg?.fiscal_webhook_secret)

    if (!esperado) {
      console.warn('[webhook] nota fiscal chegou sem segredo configurado — recusado')
      return res.status(401).json({ error: 'Não autorizado.' })
    }

    /* O nome do cabeçalho não é fixo entre emissores; aceitamos os dois que o
       Base usa nas suas integrações. Nenhum deles some no proxy. */
    const recebido = String(
      req.get('access_token') ?? req.get('x-webhook-token') ?? '',
    )

    if (!segredoConfere(recebido, esperado)) {
      console.warn('[webhook] segredo inválido na notificação de nota — descartado')
      return res.status(401).json({ error: 'Não autorizado.' })
    }

    const resultado = await aplicarEventoFiscal({ providerId, body: req.body ?? {} })

    if (!resultado.aplicado) {
      // 200 de propósito: evento que não reconhecemos não deve ser reenviado
      // para sempre.
      return res.json({ ok: true, ignorado: true, motivo: resultado.motivo })
    }

    // Responde antes de comprar a etiqueta: o emissor só precisa saber que
    // recebemos, e falar com a transportadora demora mais que o tempo limite
    // de um webhook.
    res.json({ ok: true, status: resultado.nota.status })

    /* A nota autorizada é o que destrava o envio: agora existe chave para
       imprimir na etiqueta. Antes disso a compra ficou esperando de propósito. */
    if (resultado.virouAutorizada) {
      try {
        await autoBuyLabel(resultado.nota.order_id)
      } catch (err) {
        console.error('[webhook] nota autorizada mas etiqueta falhou:', err.message)
      }
    }
  }),
)
