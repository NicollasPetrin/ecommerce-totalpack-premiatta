import { useMemo, useState } from 'react'
import { useStore, ORDER_STATUS, PAYMENT_LABEL } from '../../store/StoreContext'
import { dateTime, money, norm, orderCode } from '../../lib/format'
import Modal, { ConfirmDialog } from '../../components/Modal'
import ProductArt from '../../components/ProductArt'
import Icon from '../../components/Icon'

const FLOW = ['pendente', 'pago', 'enviado', 'entregue']

export default function AdminOrders() {
  const { orders, updateOrderStatus, deleteOrder, settings, toast } = useStore()
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
                <th>Pedido</th>
                <th>Cliente</th>
                <th>Data</th>
                <th>Entrega</th>
                <th>Pagamento</th>
                <th>Status</th>
                <th className="ta-right">Total</th>
                <th className="ta-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {list.map((o) => (
                <tr key={o.id} className="is-clickable" onClick={() => setOpen(o.id)}>
                  <td className="mono nowrap">{orderCode(o.seq, o.createdAt)}</td>
                  <td>
                    <strong>{o.customer.name}</strong>
                    <div className="cellsub">{o.customer.phone}</div>
                  </td>
                  <td className="nowrap">{dateTime(o.createdAt)}</td>
                  <td className="nowrap">
                    {o.delivery === 'retirada' ? 'Retirada' : 'Entrega'}
                  </td>
                  <td className="nowrap">{PAYMENT_LABEL[o.payment]}</td>
                  <td>
                    <span className={`tag tag--${ORDER_STATUS[o.status].tone}`}>
                      {ORDER_STATUS[o.status].label}
                    </span>
                  </td>
                  <td className="ta-right nowrap">
                    <strong>{money(o.total)}</strong>
                  </td>
                  <td className="ta-right nowrap" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="icon-btn"
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
              <a
                className="btn btn--secondary"
                href={`https://wa.me/${current.customer.phone.replace(/\D/g, '')}`}
                target="_blank"
                rel="noreferrer"
              >
                <Icon name="whatsapp" size={16} /> Falar com o cliente
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
                      onClick={() => {
                        updateOrderStatus(current.id, s)
                        toast(`Pedido marcado como ${ORDER_STATUS[s].label.toLowerCase()}.`)
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
                  onClick={() => {
                    updateOrderStatus(current.id, 'cancelado')
                    toast('Pedido cancelado.')
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
                    <dt>WhatsApp</dt>
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
                    <dd>{PAYMENT_LABEL[current.payment]}</dd>
                  </div>
                  <div>
                    <dt>Modalidade</dt>
                    <dd>
                      {current.delivery === 'retirada'
                        ? `Retirada — ${settings.address}`
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
                        CEP {current.customer.cep}
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
        onConfirm={() => {
          deleteOrder(removing.id)
          toast('Pedido excluído.')
        }}
        title="Excluir pedido"
        message={`O pedido ${
          removing ? orderCode(removing.seq, removing.createdAt) : ''
        } será apagado do histórico. O estoque não é devolvido automaticamente.`}
      />
    </>
  )
}
