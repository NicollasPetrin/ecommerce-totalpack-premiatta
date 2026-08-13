import { useCallback, useEffect, useState } from 'react'
import { api } from '../../lib/api'
import { money } from '../../lib/format'
import Icon from '../../components/Icon'

/**
 * Emissão de etiqueta dentro do detalhe do pedido.
 *
 * Fica aqui, e não numa aba separada, porque é onde já estão o endereço e os
 * itens — a decisão de qual serviço usar depende de olhar os dois.
 *
 * O fluxo tem dois botões de propósito: cotar não custa nada, comprar gasta
 * saldo. Juntar os dois num clique só faria alguém comprar sem ver o preço.
 */

const STATUS_ROTULO = {
  rascunho: 'No carrinho',
  pago: 'Pago, gerando',
  gerada: 'Etiqueta pronta',
  postado: 'Postado',
  entregue: 'Entregue',
  cancelado: 'Cancelado',
  erro: 'Erro',
}

const STATUS_TOM = {
  rascunho: 'gray',
  pago: 'blue',
  gerada: 'green',
  postado: 'blue',
  entregue: 'green',
  cancelado: 'red',
  erro: 'red',
}

export default function ShipmentPanel({ order, toast }) {
  const [envios, setEnvios] = useState([])
  const [provider, setProvider] = useState('manual')
  const [servicos, setServicos] = useState(null)
  const [carregando, setCarregando] = useState('')
  const [erro, setErro] = useState('')

  const carregar = useCallback(async () => {
    try {
      const r = await api.get(`/api/orders/${order.id}/shipments`)
      setEnvios(r.shipments ?? [])
      setProvider(r.provider ?? 'manual')
    } catch (e) {
      setErro(e.message)
    }
  }, [order.id])

  useEffect(() => {
    carregar()
  }, [carregar])

  const acao = async (nome, fn) => {
    setCarregando(nome)
    setErro('')
    try {
      await fn()
      await carregar()
    } catch (e) {
      setErro(e.message)
      toast?.(e.message, 'err')
    } finally {
      setCarregando('')
    }
  }

  const cotar = () =>
    acao('cotar', async () => {
      const r = await api.post(`/api/orders/${order.id}/shipments/quote`)
      setServicos(r.servicos ?? [])
      if (!r.servicos?.length) toast?.('Nenhum serviço disponível para este CEP.', 'err')
    })

  const escolher = (servicoId) =>
    acao('escolher', async () => {
      await api.post(`/api/orders/${order.id}/shipments`, { servicoId })
      setServicos(null)
      toast?.('Envio criado. Agora compre a etiqueta.')
    })

  const comprar = (id) =>
    acao('comprar', async () => {
      await api.post(`/api/shipments/${id}/buy`)
      toast?.('Etiqueta comprada e gerada.')
    })

  const conferir = (id) => acao('conferir', () => api.post(`/api/shipments/${id}/sync`))

  const cancelar = (id) =>
    acao('cancelar', async () => {
      await api.post(`/api/shipments/${id}/cancel`)
      toast?.('Envio cancelado.')
    })

  if (provider === 'manual') {
    return (
      <section className="ship">
        <h3 className="odetail__title">Envio</h3>
        <p className="hint">
          Nenhuma transportadora integrada. A etiqueta continua sendo emitida fora
          do site.
        </p>
      </section>
    )
  }

  const ativo = envios.find((e) => !['cancelado', 'erro'].includes(e.status))

  return (
    <section className="ship">
      <h3 className="odetail__title">Envio</h3>

      {erro && (
        <p className="err ship__erro">
          <Icon name="alert" size={14} /> {erro}
        </p>
      )}

      {envios.map((e) => (
        <div key={e.id} className="ship__row">
          <div className="ship__info">
            <span className={`tag tag--${STATUS_TOM[e.status] ?? 'gray'}`}>
              {STATUS_ROTULO[e.status] ?? e.status}
            </span>
            {e.carrier && <strong>{e.carrier}</strong>}
            {e.serviceName && <span className="cellsub">{e.serviceName}</span>}
            {e.cost > 0 && <span className="cellsub">{money(e.cost)}</span>}
            {e.tracking && <span className="mono">{e.tracking}</span>}
            {e.error && <span className="err">{e.error}</span>}
          </div>

          <div className="ship__acoes">
            {e.status === 'rascunho' && (
              <button
                className="btn btn--primary btn--sm"
                disabled={Boolean(carregando)}
                onClick={() => comprar(e.id)}
              >
                {carregando === 'comprar' ? 'Comprando…' : 'Comprar etiqueta'}
              </button>
            )}

            {e.labelUrl && (
              <a
                className="btn btn--outline btn--sm"
                href={e.labelUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                <Icon name="download" size={15} /> Imprimir
              </a>
            )}

            <button
              className="btn btn--ghost btn--sm"
              disabled={Boolean(carregando)}
              onClick={() => conferir(e.id)}
            >
              <Icon name="refresh" size={15} /> Conferir
            </button>

            {!['entregue', 'cancelado'].includes(e.status) && (
              <button
                className="btn btn--ghost btn--sm"
                disabled={Boolean(carregando)}
                onClick={() => cancelar(e.id)}
              >
                Cancelar
              </button>
            )}
          </div>
        </div>
      ))}

      {!ativo && (
        <>
          {servicos === null ? (
            <button
              className="btn btn--outline btn--sm"
              disabled={Boolean(carregando)}
              onClick={cotar}
            >
              <Icon name="truck" size={15} />
              {carregando === 'cotar' ? 'Consultando…' : 'Cotar frete'}
            </button>
          ) : (
            <ul className="ship__servicos">
              {servicos.map((sv) => (
                <li key={sv.servicoId}>
                  <div>
                    <strong>{sv.transportadora}</strong>{' '}
                    <span className="cellsub">{sv.nome}</span>
                    <div className="cellsub">
                      {money(sv.preco)} · {sv.prazoDias} dia(s) útil(eis)
                    </div>
                  </div>
                  <button
                    className="btn btn--primary btn--sm"
                    disabled={Boolean(carregando)}
                    onClick={() => escolher(sv.servicoId)}
                  >
                    Usar este
                  </button>
                </li>
              ))}
              <li>
                <button className="btn btn--ghost btn--sm" onClick={() => setServicos(null)}>
                  Voltar
                </button>
              </li>
            </ul>
          )}
        </>
      )}
    </section>
  )
}
