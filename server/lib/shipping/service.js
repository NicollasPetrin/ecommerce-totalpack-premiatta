import { one, transaction } from '../../db/pool.js'
import { getShippingProvider } from './index.js'

/**
 * Regras de envio que não dependem de transportadora.
 *
 * A tabela `shipments` é a memória do processo. O Melhor Envio cobra no
 * passo do checkout, então tudo aqui é escrito de forma que uma falha no meio
 * seja retomada — nunca refeita do zero.
 */

/**
 * Traz o estado real de uma etiqueta da transportadora e grava.
 *
 * Chamado pelo webhook e pelo botão de conferir no painel. O corpo da
 * notificação nunca é usado como verdade: só como aviso de que algo mudou.
 */
export async function syncShipment(providerId, externalId) {
  const registro = await one(
    `SELECT * FROM shipments WHERE provider = $1 AND external_id = $2`,
    [providerId, String(externalId)],
  )

  // Etiqueta que não é nossa (ou notificação forjada): nada a fazer.
  if (!registro) return { updated: false, reason: 'etiqueta desconhecida' }

  const provider = getShippingProvider(providerId)
  const atual = await provider.consultar({ externalId: String(externalId) })

  /* Estado final não volta atrás. Uma notificação atrasada chegando depois de
     "entregue" não pode rebaixar a etiqueta para "postado" — foi o mesmo
     cuidado que o pagamento exigiu. */
  const finais = ['entregue', 'cancelado']
  if (finais.includes(registro.status) && registro.status !== atual.status) {
    return { updated: false, reason: `já está em ${registro.status}` }
  }

  await one(
    `UPDATE shipments
        SET status = $1, tracking = $2, carrier = $3, service_name = $4,
            cost = $5, raw = $6::jsonb, updated_at = now()
      WHERE id = $7 RETURNING id`,
    [
      atual.status,
      atual.tracking,
      atual.carrier,
      atual.servico,
      atual.custo,
      JSON.stringify(atual.raw ?? {}),
      registro.id,
    ],
  )

  return { updated: true, status: atual.status, tracking: atual.tracking }
}

/**
 * Compra e emite a etiqueta de um pedido, retomando de onde parou.
 *
 * Os quatro passos ficam gravados conforme avançam. Se a conexão cair depois
 * do checkout, a próxima chamada não compra de novo — ela vê que já está
 * paga e segue para a geração.
 */
export async function buyLabel({ providerId, shipmentId }) {
  const provider = getShippingProvider(providerId)

  const registro = await one(`SELECT * FROM shipments WHERE id = $1`, [shipmentId])
  if (!registro) throw new Error('Envio não encontrado.')
  if (!registro.external_id) throw new Error('Envio ainda não está no carrinho da transportadora.')

  const externalId = registro.external_id
  const marcar = (status, extra = {}) =>
    one(
      `UPDATE shipments
          SET status = $1, label_url = COALESCE($2, label_url),
              error = $3, updated_at = now()
        WHERE id = $4 RETURNING *`,
      [status, extra.labelUrl ?? null, extra.error ?? '', shipmentId],
    )

  try {
    if (registro.status === 'rascunho') {
      await provider.comprar({ externalId })
      await marcar('pago')
    }

    if (['rascunho', 'pago'].includes(registro.status)) {
      await provider.gerar({ externalId })
    }

    const url = await provider.imprimir({ externalId })
    const atualizado = await marcar('gerada', { labelUrl: url })
    return atualizado
  } catch (err) {
    await marcar(registro.status, { error: err.message }).catch(() => {})
    throw err
  }
}

/**
 * Cria o rascunho do envio: cota, escolhe o serviço e põe no carrinho.
 *
 * Um pedido pode ter mais de um envio ao longo do tempo (a primeira etiqueta
 * cancelada, uma segunda emitida), por isso não há restrição de um por pedido
 * — o que existe é o índice único no id da transportadora, que impede a mesma
 * etiqueta ser gravada duas vezes.
 */
export async function createShipment({ providerId, order, remetente, itens, servicoId }) {
  const provider = getShippingProvider(providerId)

  const { externalId, raw } = await provider.adicionarAoCarrinho({
    servicoId,
    remetente,
    destinatario: order.destinatario,
    itens,
    pedido: order,
  })

  return transaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO shipments (order_id, provider, external_id, status, raw)
       VALUES ($1, $2, $3, 'rascunho', $4::jsonb)
       ON CONFLICT (provider, external_id) WHERE external_id <> ''
       DO UPDATE SET raw = EXCLUDED.raw, updated_at = now()
       RETURNING *`,
      [order.id, providerId, externalId, JSON.stringify(raw ?? {})],
    )
    return rows[0]
  })
}
