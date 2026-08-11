import { useMemo, useState } from 'react'
import { useStore, ORDER_STATUS, PAYMENT_LABEL } from '../../store/StoreContext'
import { dateTime, maskCep, money, norm, orderCode } from '../../lib/format'
import Modal, { ConfirmDialog } from '../../components/Modal'
import ProductArt from '../../components/ProductArt'
import Icon from '../../components/Icon'

const FLOW = ['pendente', 'pago', 'enviado', 'entregue']

/** Situação da cobrança — diferente do status do pedido. */
const CHARGE_LABEL = {
  pendente: 'aguardando pagamento',
  processando: 'processando',
  pago: 'pago',
  falhou: 'cobrança falhou',
  estornado: 'estornado',
  expirado: 'expirado',
}

const CHARGE_TONE = {
  pendente: 'orange',
  processando: 'teal',
  pago: 'green',
  falhou: 'red',
  estornado: 'red',
  expirado: 'gray',
}

export default function AdminOrders() {
  const {
    orders, updateOrderStatus, deleteOrder, rechargeOrder, syncOrderPayment, settings, toast,
  } = useStore()
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [open, setOpen] = useState(null)
  const [removing, setRemoving] = useState(null)

  const list = useMemo(() => {
    const term = norm(q)
    return orders
      .filter((o) => {
        if (status && o.status !== status) return false
        if (!term) return true
        return norm(
          `${orderCode(o.seq, o.createdAt)} ${o.customer.name} ${o.customer.phone} ${o.customer.email}`,
        ).includes(term)
      })
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
  }, [orders, q, status])

  const counts = useMemo(() => {
    const c = { '': orders.length }
    Object.keys(ORDER_STATUS).forEach((k) => {
      c[k] = orders.filter((o) => o.status === k).length
    })
    return c
  }, [orders])

  const revenue = list
    .filter((o) => o.status !== 'cancelado')
    .reduce((s, o) => s + o.total, 0)

  const current = open ? orders.find((o) => o.id === open) : null

  return (
    <>
      <header className="apage__head">
        <div>
          <h1>Pedidos</h1>
          <p>
            {list.length} {list.length === 1 ? 'pedido' : 'pedidos'} · {money(revenue)} em
            vendas válidas
          </p>
        </div>
      </header>

      <div className="atoolbar">
        <div className="asearch">
          <Icon name="search" size={17} />
          <input
            className="input"
            placeholder="Buscar por número, cliente ou telefone…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {q && (
            <button className="icon-btn" onClick={() => setQ('')} aria-label="Limpar">
              <Icon name="close" size={15} />
            </button>
          )}
        </div>

        <div className="segmented segmented--scroll" role="tablist">
          <button
            role="tab"
            aria-selected={status === ''}
            className={status === '' ? 'is-on' : ''}
            onClick={() => setStatus('')}
          >
            Todos <em>{counts['']}</em>
          </button>
          {Object.entries(ORDER_STATUS).map(([k, s]) => (
            <button
              key={k}
              role="tab"
              aria-selected={status === k}
              className={status === k ? 'is-on' : ''}
              onClick={() => setStatus(k)}
            >
              {s.label} <em>{counts[k]}</em>
            </button>
          ))}
        </div>
      </div>

      <section className="acard acard--flush">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                {/* No celular ficam só as colunas que identificam o pedido —
                    o resto aparece ao tocar na linha. */}
                <th className="hide-sm">Pedido</th>
                <th>Cliente</th>
                <th className="hide-sm hide-md">Data</th>
                <th className="hide-sm">Entrega</th>
                <th className="hide-sm">Pagamento</th>
                <th>Status</th>
                <th className="ta-right">Total</th>
                <th className="ta-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {list.map((o) => (
                <tr key={o.id} className="is-clickable" onClick={() => setOpen(o.id)}>
                  <td className="mono nowrap hide-sm">{orderCode(o.seq, o.createdAt)}</td>
                  <td>
                    {/* No celular o número entra aqui, liberando uma coluna. */}
                    <div className="mono show-sm">{orderCode(o.seq, o.createdAt)}</div>
                    <strong>{o.customer.name}</strong>
                    <div className="cellsub hide-sm">{o.customer.phone}</div>
                  </td>
                  <td className="nowrap hide-sm hide-md">{dateTime(o.createdAt)}</td>
                  <td className="nowrap hide-sm">
                    {o.delivery === 'retirada' ? 'Retirada' : 'Entrega'}
                  </td>
                  <td className="nowrap hide-sm">{PAYMENT_LABEL[o.payment]}</td>
                  <td>
                    <span className={`tag tag--${ORDER_STATUS[o.status].tone}`}>
                      {ORDER_STATUS[o.status].label}
                    </span>
                  </td>
                  <td className="ta-right nowrap">
                    <strong>{money(o.total)}</strong>
                  </td>
                  <td className="ta-right nowrap" onClick={(e) => e.stopPropagation()}>
                    {/* No celular tocar na linha já abre o pedido. */}
                    <button
                      className="icon-btn hide-sm"
                      onClick={() => setOpen(o.id)}
                      aria-label="Ver pedido"
                    >
                      <Icon name="eye" size={17} />
                    </button>
                    <button
                      className="icon-btn icon-btn--danger"
                      onClick={() => setRemoving(o)}
                      aria-label="Excluir pedido"
                    >
                      <Icon name="trash" size={17} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {list.length === 0 && (
          <div className="empty">
            <Icon name="receipt" size={40} strokeWidth={1.2} />
            <h3>Nenhum pedido aqui</h3>
            <p>Assim que um cliente finalizar a compra, ele aparece nesta lista.</p>
          </div>
        )}
      </section>

      {/* ----------------------------------------------------- Detalhe */}
      {current && (
        <Modal
          open
          wide
          onClose={() => setOpen(null)}
          title={`Pedido ${orderCode(current.seq, current.createdAt)}`}
          footer={
            <>
              {/* Conferência manual, para quando o webhook não chegou. */}
              {current.charge &&
                current.charge.provider !== 'manual' &&
                current.charge.status !== 'pago' && (
                  <button
                    className="btn btn--secondary"
                    onClick={async () => {
                      try {
                        const r = await syncOrderPayment(current.id)
                        toast(
                          r.changed
                            ? 'Pagamento atualizado.'
                            : `Sem mudança — segue como "${CHARGE_LABEL[r.status] ?? r.status}".`,
                        )
                      } catch (err) {
                        toast(err.message, 'err')
                      }
                    }}
                  >
                    <Icon name="refresh" size={16} /> Conferir pagamento
                  </button>
                )}

              {/* Só faz sentido com processadora: sem ela não há o que refazer. */}
              {current.charge &&
                current.charge.provider !== 'manual' &&
                ['falhou', 'expirado'].includes(current.charge.status) && (
                  <button
                    className="btn btn--secondary"
                    onClick={async () => {
                      try {
                        await rechargeOrder(current.id)
                        toast('Nova cobrança criada.')
                      } catch (err) {
                        toast(err.message, 'err')
                      }
                    }}
                  >
                    <Icon name="refresh" size={16} /> Refazer cobrança
                  </button>
                )}

              {current.customer.email && (
                <a
                  className="btn btn--secondary"
                  href={`mailto:${current.customer.email}?subject=${encodeURIComponent(
                    `Pedido ${orderCode(current.seq, current.createdAt)}`,
                  )}`}
                >
                  <Icon name="mail" size={16} /> Enviar e-mail
                </a>
              )}
              <a className="btn btn--secondary" href={`tel:${current.customer.phone.replace(/\D/g, '')}`}>
                <Icon name="phone" size={16} /> Ligar
              </a>
              <button className="btn btn--primary" onClick={() => setOpen(null)}>
                Fechar
              </button>
            </>
          }
        >
          <div className="odetail">
            {/* Linha do tempo do status */}
            <div className="ostatus">
              <span className="label">Status do pedido</span>
              <div className="ostatus__flow">
                {FLOW.map((s) => {
                  const idx = FLOW.indexOf(current.status)
                  const here = FLOW.indexOf(s)
                  const done = idx >= 0 && here <= idx
                  return (
                    <button
                      key={s}
                      className={`ostep${done ? ' is-done' : ''}${
                        current.status === s ? ' is-now' : ''
                      }`}
                      onClick={async () => {
                        try {
                          await updateOrderStatus(current.id, s)
                          toast(`Pedido marcado como ${ORDER_STATUS[s].label.toLowerCase()}.`)
                        } catch (err) {
                          toast(err.message, 'err')
                        }
                      }}
                      disabled={current.status === 'cancelado'}
                    >
                      <span className="ostep__dot">
                        {done && <Icon name="check" size={12} strokeWidth={3} />}
                      </span>
                      {ORDER_STATUS[s].label}
                    </button>
                  )
                })}
              </div>

              {current.status === 'cancelado' ? (
                <button
                  className="btn btn--secondary btn--sm"
                  onClick={() => updateOrderStatus(current.id, 'pendente')}
                >
                  <Icon name="refresh" size={15} /> Reabrir pedido
                </button>
              ) : (
                <button
                  className="btn btn--danger btn--sm"
                  onClick={async () => {
                    try {
                      await updateOrderStatus(current.id, 'cancelado')
                      toast('Pedido cancelado.')
                    } catch (err) {
                      toast(err.message, 'err')
                    }
                  }}
                >
                  Cancelar pedido
                </button>
              )}
            </div>

            <div className="odetail__grid">
              <section>
                <h3 className="odetail__title">Itens</h3>
                <ul className="summary__items">
                  {current.items.map((i) => (
                    <li key={i.productId}>
                      <span className="summary__art">
                        <ProductArt product={i} />
                        <em>{i.qty}</em>
                      </span>
                      <span className="summary__name">
                        {i.name}
                        <span className="mono">{i.sku}</span>
                      </span>
                      <strong>{money(i.price * i.qty)}</strong>
                    </li>
                  ))}
                </ul>

                <dl className="totals">
                  <div>
                    <dt>Subtotal</dt>
                    <dd>{money(current.subtotal)}</dd>
                  </div>
                  <div>
                    <dt>{current.delivery === 'retirada' ? 'Retirada' : 'Entrega'}</dt>
                    <dd>
                      {current.shipping === 0 ? (
                        <span className="free">Grátis</span>
                      ) : (
                        money(current.shipping)
                      )}
                    </dd>
                  </div>
                  <div className="totals__grand">
                    <dt>Total</dt>
                    <dd>{money(current.total)}</dd>
                  </div>
                </dl>
              </section>

              <section>
                <h3 className="odetail__title">Cliente e entrega</h3>
                <dl className="deflist">
                  <div>
                    <dt>Nome</dt>
                    <dd>{current.customer.name}</dd>
                  </div>
                  <div>
                    <dt>Telefone</dt>
                    <dd>{current.customer.phone}</dd>
                  </div>
                  {current.customer.email && (
                    <div>
                      <dt>E-mail</dt>
                      <dd>{current.customer.email}</dd>
                    </div>
                  )}
                  <div>
                    <dt>Pagamento</dt>
                    <dd>
                      {PAYMENT_LABEL[current.payment]}
                      {current.charge && (
                        <>
                          {' · '}
                          <span className={`tag tag--${CHARGE_TONE[current.charge.status]}`}>
                            {CHARGE_LABEL[current.charge.status]}
                          </span>
                          {current.charge.provider !== 'manual' && (
                            <div className="cellsub">via {current.charge.provider}</div>
                          )}
                        </>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>Modalidade</dt>
                    <dd>
                      {current.delivery === 'retirada'
                        ? `Retirada — ${settings.address}`
                        : current.deliveryZone
                          ? `Entrega — ${current.deliveryZone} (${
                              current.deliveryDays === 1
                                ? '1 dia útil'
                                : `${current.deliveryDays} dias úteis`
                            })`
                          : 'Entrega no endereço'}
                    </dd>
                  </div>
                  {current.delivery === 'entrega' && (
                    <div>
                      <dt>Endereço</dt>
                      <dd>
                        {current.customer.address}, {current.customer.number}
                        {current.customer.complement && ` — ${current.customer.complement}`}
                        <br />
                        {current.customer.district} · {current.customer.city}/
                        {current.customer.state}
                        <br />
                        CEP {maskCep(current.customer.cep)}
                      </dd>
                    </div>
                  )}
                  <div>
                    <dt>Criado em</dt>
                    <dd>{dateTime(current.createdAt)}</dd>
                  </div>
                  <div>
                    <dt>Atualizado</dt>
                    <dd>{dateTime(current.updatedAt)}</dd>
                  </div>
                </dl>

                {current.note && (
                  <div className="onote">
                    <span className="label">Observação do cliente</span>
                    <p>{current.note}</p>
                  </div>
                )}
              </section>
            </div>
          </div>
        </Modal>
      )}

      <ConfirmDialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          try {
            await deleteOrder(removing.id)
            toast('Pedido excluído.')
          } catch (err) {
            toast(err.message, 'err')
          }
        }}
        title="Excluir pedido"
        message={`O pedido ${
          removing ? orderCode(removing.seq, removing.createdAt) : ''
        } será apagado do histórico. O estoque não é devolvido automaticamente.`}
      />
    </>
  )
}
