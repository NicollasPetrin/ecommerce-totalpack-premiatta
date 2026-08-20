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

const NF_ROTULO = {
  rascunho: 'não pedida',
  processando: 'aguardando SEFAZ',
  autorizada: 'autorizada',
  rejeitada: 'recusada',
  cancelada: 'cancelada',
}

const NF_TOM = {
  rascunho: 'gray',
  processando: 'gold',
  autorizada: 'green',
  rejeitada: 'red',
  cancelada: 'red',
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
  // null enquanto não carregou: sem isto, uma falha na busca mostrava
  // "nenhuma transportadora integrada", que é uma afirmação falsa.
  const [provider, setProvider] = useState(null)
  const [servicos, setServicos] = useState(null)
  const [nota, setNota] = useState(null)
  const [emiteNota, setEmiteNota] = useState(false)
  const [carregando, setCarregando] = useState('')
  const [erro, setErro] = useState('')

  const carregar = useCallback(async () => {
    try {
      const r = await api.get(`/orders/${order.id}/shipments`)
      setEnvios(r.shipments ?? [])
      setProvider(r.provider ?? 'manual')
      setNota(r.invoice ?? null)
      setEmiteNota(Boolean(r.emiteNota))
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
      const r = await api.post(`/orders/${order.id}/shipments/quote`)
      setServicos(r.servicos ?? [])
      if (!r.servicos?.length) toast?.('Nenhum serviço disponível para este CEP.', 'err')
    })

  const escolher = (servicoId) =>
    acao('escolher', async () => {
      await api.post(`/orders/${order.id}/shipments`, { servicoId })
      setServicos(null)
      toast?.('Envio criado. Agora compre a etiqueta.')
    })

  const comprar = (id) =>
    acao('comprar', async () => {
      await api.post(`/shipments/${id}/buy`)
      toast?.('Etiqueta comprada e gerada.')
    })

  const conferir = (id) => acao('conferir', () => api.post(`/shipments/${id}/sync`))

  const emitir = () =>
    acao('emitir', async () => {
      const r = await api.post(`/orders/${order.id}/invoice`)
      // A recusa vem em 200: o problema é o cadastro, não a requisição.
      toast?.(r.ok ? 'Nota pedida ao emissor.' : r.motivo, r.ok ? 'ok' : 'err')
    })

  const cancelar = (id) =>
    acao('cancelar', async () => {
      await api.post(`/shipments/${id}/cancel`)
      toast?.('Envio cancelado.')
    })

  if (provider === null) {
    return (
      <section className="ship">
        <h3 className="odetail__title">Envio</h3>
        <p className="hint">
          {erro ? `Não foi possível carregar: ${erro}` : 'Carregando…'}
        </p>
      </section>
    )
  }

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

  /* Com nota ligada, a etiqueta espera a SEFAZ. Dizer isso explicitamente
     evita a leitura errada — "a etiqueta falhou" — quando na verdade está
     tudo certo e só falta autorizar. */
  const esperandoNota = emiteNota && !ativo && nota?.status === 'processando'

  return (
    <section className="ship">
      <h3 className="odetail__title">Envio</h3>

      {emiteNota && (
        <div className="ship__nf">
          <div className="ship__nfhead">
            <strong>Nota fiscal</strong>
            {nota ? (
              <span className={`tag tag--${NF_TOM[nota.status] ?? 'gray'}`}>
                {NF_ROTULO[nota.status] ?? nota.status}
              </span>
            ) : (
              <span className="tag tag--gray">sem nota</span>
            )}
          </div>

          {nota?.status === 'autorizada' && (
            <p className="hint">
              Nº {nota.numero || '—'}
              {nota.serie && ` · série ${nota.serie}`} · chave {nota.chave}
              {nota.pdfUrl && (
                <>
                  {' · '}
                  <a href={nota.pdfUrl} target="_blank" rel="noreferrer">
                    DANFE
                  </a>
                </>
              )}
              {nota.xmlUrl && (
                <>
                  {' · '}
                  <a href={nota.xmlUrl} target="_blank" rel="noreferrer">
                    XML
                  </a>
                </>
              )}
            </p>
          )}

          {nota?.status === 'processando' && (
            <p className="hint">
              Pedida ao emissor. A etiqueta sai sozinha quando a SEFAZ autorizar —
              a chave da nota vai impressa nela.
            </p>
          )}

          {nota?.error && <p className="ship__erro">{nota.error}</p>}

          {(!nota || ['rejeitada', 'cancelada'].includes(nota.status)) && (
            <button
              className="btn btn--sm"
              onClick={emitir}
              disabled={carregando === 'emitir'}
            >
              {carregando === 'emitir'
                ? 'Emitindo…'
                : nota
                  ? 'Tentar emitir de novo'
                  : 'Emitir nota'}
            </button>
          )}
        </div>
      )}

      {esperandoNota && (
        <p className="hint">
          A compra da etiqueta está esperando a nota autorizar. Não é erro.
        </p>
      )}

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
