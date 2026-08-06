import { useMemo, useState } from 'react'
import { useStore, ORDER_STATUS } from '../../store/StoreContext'
import { date, maskCep, money, norm, orderCode } from '../../lib/format'
import Modal from '../../components/Modal'
import Icon from '../../components/Icon'

export default function AdminCustomers() {
  const { customers, orders } = useStore()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(null)

  /** Cada conta com seus totais já calculados. */
  const rows = useMemo(() => {
    const term = norm(q)
    return customers
      .map((c) => {
        const own = orders.filter((o) => o.customerId === c.id)
        const valid = own.filter((o) => o.status !== 'cancelado')
        return {
          ...c,
          orderCount: own.length,
          spent: valid.reduce((s, o) => s + o.total, 0),
          lastOrder: own.length
            ? own.reduce((a, b) => (new Date(a.createdAt) > new Date(b.createdAt) ? a : b))
            : null,
        }
      })
      .filter((c) => !term || norm(`${c.name} ${c.email} ${c.phone}`).includes(term))
      .sort((a, b) => b.spent - a.spent)
  }, [customers, orders, q])

  const guestOrders = orders.filter((o) => !o.customerId).length
  const totalSpent = rows.reduce((s, c) => s + c.spent, 0)

  const current = open ? rows.find((c) => c.id === open) : null
  const currentOrders = current
    ? orders
        .filter((o) => o.customerId === current.id)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    : []

  return (
    <>
      <header className="apage__head">
        <div>
          <h1>Clientes</h1>
          <p>
            {customers.length} {customers.length === 1 ? 'conta cadastrada' : 'contas cadastradas'}
            {' · '}
            {money(totalSpent)} em compras identificadas
            {guestOrders > 0 && ` · ${guestOrders} pedido(s) sem cadastro`}
          </p>
        </div>
      </header>

      <div className="atoolbar">
        <div className="asearch">
          <Icon name="search" size={17} />
          <input
            className="input"
            placeholder="Buscar por nome, e-mail ou telefone…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {q && (
            <button className="icon-btn" onClick={() => setQ('')} aria-label="Limpar">
              <Icon name="close" size={15} />
            </button>
          )}
        </div>
      </div>

      <section className="acard acard--flush">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Cliente</th>
                <th>Contato</th>
                <th className="ta-right">Endereços</th>
                <th className="ta-right">Pedidos</th>
                <th>Último pedido</th>
                <th className="ta-right">Total gasto</th>
                <th className="ta-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="is-clickable" onClick={() => setOpen(c.id)}>
                  <td>
                    <strong>{c.name}</strong>
                    <div className="cellsub">Desde {date(c.createdAt)}</div>
                  </td>
                  <td>
                    {c.email}
                    <div className="cellsub">{c.phone}</div>
                  </td>
                  <td className="ta-right">
                    <span className="tag tag--gray">{c.addresses?.length ?? 0}</span>
                  </td>
                  <td className="ta-right">
                    <span className="tag tag--gray">{c.orderCount}</span>
                  </td>
                  <td className="nowrap">
                    {c.lastOrder ? date(c.lastOrder.createdAt) : <span className="hint">—</span>}
                  </td>
                  <td className="ta-right nowrap">
                    <strong>{money(c.spent)}</strong>
                  </td>
                  <td className="ta-right nowrap" onClick={(e) => e.stopPropagation()}>
                    <button
                      className="icon-btn"
                      onClick={() => setOpen(c.id)}
                      aria-label={`Ver ${c.name}`}
                    >
                      <Icon name="eye" size={17} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {rows.length === 0 && (
          <div className="empty">
            <Icon name="user" size={40} strokeWidth={1.2} />
            <h3>{q ? 'Nenhum cliente encontrado' : 'Nenhuma conta cadastrada'}</h3>
            <p>
              {q
                ? 'Tente outro termo de busca.'
                : 'As contas aparecem aqui conforme os clientes se cadastram na loja.'}
            </p>
          </div>
        )}
      </section>

      {current && (
        <Modal open wide onClose={() => setOpen(null)} title={current.name}>
          <div className="stack gap-6">
            <dl className="deflist">
              <div>
                <dt>E-mail</dt>
                <dd>{current.email}</dd>
              </div>
              <div>
                <dt>Telefone</dt>
                <dd>{current.phone}</dd>
              </div>
              <div>
                <dt>Cliente desde</dt>
                <dd>{date(current.createdAt)}</dd>
              </div>
              <div>
                <dt>Total gasto</dt>
                <dd>
                  <strong>{money(current.spent)}</strong> em {current.orderCount}{' '}
                  {current.orderCount === 1 ? 'pedido' : 'pedidos'}
                </dd>
              </div>
            </dl>

            <div>
              <h3 className="odetail__title">
                Endereços ({current.addresses?.length ?? 0})
              </h3>
              {current.addresses?.length ? (
                <div className="addresses addresses--compact">
                  {current.addresses.map((a) => (
                    <article key={a.id} className={`addr${a.isDefault ? ' is-default' : ''}`}>
                      <header>
                        <strong>{a.label}</strong>
                        {a.isDefault && <span className="tag tag--blue">Padrão</span>}
                      </header>
                      <p>
                        {a.address}, {a.number}
                        {a.complement && ` — ${a.complement}`}
                        <br />
                        {a.district} · {a.city}/{a.state}
                        <br />
                        CEP {maskCep(a.cep)}
                      </p>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="acard__empty">Nenhum endereço salvo.</p>
              )}
            </div>

            <div>
              <h3 className="odetail__title">Pedidos</h3>
              {currentOrders.length ? (
                <div className="table-wrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Pedido</th>
                        <th>Data</th>
                        <th>Status</th>
                        <th className="ta-right">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentOrders.map((o) => (
                        <tr key={o.id}>
                          <td className="mono nowrap">{orderCode(o.seq, o.createdAt)}</td>
                          <td className="nowrap">{date(o.createdAt)}</td>
                          <td>
                            <span className={`tag tag--${ORDER_STATUS[o.status].tone}`}>
                              {ORDER_STATUS[o.status].label}
                            </span>
                          </td>
                          <td className="ta-right nowrap">
                            <strong>{money(o.total)}</strong>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="acard__empty">Esta conta ainda não fez pedidos.</p>
              )}
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
