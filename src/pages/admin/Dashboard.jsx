import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useStore, ORDER_STATUS } from '../../store/StoreContext'
import { date, money, num, orderCode } from '../../lib/format'
import Icon from '../../components/Icon'
import ProductArt from '../../components/ProductArt'

const DAY = 86400000

export default function Dashboard() {
  const { orders, products, categoryById, settings } = useStore()

  const stats = useMemo(() => {
    const valid = orders.filter((o) => o.status !== 'cancelado')
    const revenue = valid.reduce((s, o) => s + o.total, 0)
    const ticket = valid.length ? revenue / valid.length : 0

    const last30 = valid.filter((o) => Date.now() - new Date(o.createdAt) < 30 * DAY)
    const prev30 = valid.filter((o) => {
      const age = Date.now() - new Date(o.createdAt)
      return age >= 30 * DAY && age < 60 * DAY
    })
    const rev30 = last30.reduce((s, o) => s + o.total, 0)
    const revPrev = prev30.reduce((s, o) => s + o.total, 0)
    const delta = revPrev > 0 ? Math.round(((rev30 - revPrev) / revPrev) * 100) : null

    const units = valid.reduce(
      (s, o) => s + o.items.reduce((n, i) => n + i.qty, 0),
      0,
    )

    return {
      revenue,
      rev30,
      delta,
      ticket,
      count: orders.length,
      pending: orders.filter((o) => o.status === 'pendente').length,
      units,
      stockValue: products.reduce((s, p) => s + p.stock * p.price, 0),
    }
  }, [orders, products])

  /* Faturamento por dia nos últimos 14 dias */
  const chart = useMemo(() => {
    const buckets = Array.from({ length: 14 }, (_, i) => {
      const d = new Date()
      d.setHours(0, 0, 0, 0)
      d.setDate(d.getDate() - (13 - i))
      return { date: d, total: 0 }
    })

    orders
      .filter((o) => o.status !== 'cancelado')
      .forEach((o) => {
        const d = new Date(o.createdAt)
        d.setHours(0, 0, 0, 0)
        const b = buckets.find((x) => x.date.getTime() === d.getTime())
        if (b) b.total += o.total
      })

    const max = Math.max(1, ...buckets.map((b) => b.total))
    return { buckets, max }
  }, [orders])

  /* Produtos mais vendidos */
  const topProducts = useMemo(() => {
    const tally = new Map()
    orders
      .filter((o) => o.status !== 'cancelado')
      .forEach((o) =>
        o.items.forEach((i) => {
          const cur = tally.get(i.productId) ?? { qty: 0, revenue: 0, item: i }
          cur.qty += i.qty
          cur.revenue += i.price * i.qty
          tally.set(i.productId, cur)
        }),
      )
    return [...tally.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 5)
  }, [orders])

  const lowStock = useMemo(
    () =>
      products
        .filter((p) => p.active && p.stock <= settings.lowStockThreshold)
        .sort((a, b) => a.stock - b.stock)
        .slice(0, 6),
    [products, settings.lowStockThreshold],
  )

  const recent = [...orders]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 6)

  return (
    <>
      <header className="apage__head">
        <div>
          <h1>Visão geral</h1>
          <p>Como a loja está indo hoje.</p>
        </div>
        <Link to="/admin/produtos" className="btn btn--primary">
          <Icon name="plus" size={16} /> Novo produto
        </Link>
      </header>

      {/* --------------------------------------------------------- Números */}
      <div className="kpis">
        <article className="kpi">
          <span className="kpi__label">Faturamento total</span>
          <strong className="kpi__value">{money(stats.revenue)}</strong>
          {stats.delta != null && (
            <span className={`kpi__delta${stats.delta >= 0 ? ' is-up' : ' is-down'}`}>
              {stats.delta >= 0 ? '+' : ''}
              {stats.delta}% vs. 30 dias anteriores
            </span>
          )}
        </article>

        <article className="kpi">
          <span className="kpi__label">Pedidos</span>
          <strong className="kpi__value">{num(stats.count)}</strong>
          <span className="kpi__delta">
            {stats.pending > 0 ? `${stats.pending} aguardando confirmação` : 'Tudo em dia'}
          </span>
        </article>

        <article className="kpi">
          <span className="kpi__label">Ticket médio</span>
          <strong className="kpi__value">{money(stats.ticket)}</strong>
          <span className="kpi__delta">{num(stats.units)} itens vendidos</span>
        </article>

        <article className="kpi">
          <span className="kpi__label">Valor em estoque</span>
          <strong className="kpi__value">{money(stats.stockValue)}</strong>
          <span className="kpi__delta">
            {products.filter((p) => p.active).length} produtos ativos
          </span>
        </article>
      </div>

      <div className="acols">
        {/* --------------------------------------------------------- Gráfico */}
        <section className="acard">
          <header className="acard__head">
            <h2>Faturamento — últimos 14 dias</h2>
            <span className="acard__meta">{money(stats.rev30)} em 30 dias</span>
          </header>

          <div className="chart" role="img" aria-label="Faturamento diário dos últimos 14 dias">
            {chart.buckets.map((b, i) => (
              <div key={i} className="chart__col" title={`${date(b.date)}: ${money(b.total)}`}>
                <span
                  className="chart__bar"
                  style={{ height: `${Math.max(3, (b.total / chart.max) * 100)}%` }}
                />
                <span className="chart__x">
                  {b.date.getDate()}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* ------------------------------------------------------ Mais vendidos */}
        <section className="acard">
          <header className="acard__head">
            <h2>Mais vendidos</h2>
            <Link to="/admin/produtos" className="btn btn--ghost btn--sm">
              Produtos
            </Link>
          </header>

          {topProducts.length === 0 ? (
            <p className="acard__empty">Ainda sem vendas registradas.</p>
          ) : (
            <ul className="ranking">
              {topProducts.map((t, i) => (
                <li key={t.item.productId}>
                  <span className="ranking__pos">{i + 1}</span>
                  <span className="ranking__art">
                    <ProductArt product={t.item} />
                  </span>
                  <span className="ranking__body">
                    <strong>{t.item.name}</strong>
                    <span>
                      {t.qty} {t.qty === 1 ? 'unidade vendida' : 'unidades vendidas'}
                    </span>
                  </span>
                  <strong className="ranking__value">{money(t.revenue)}</strong>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="acols">
        {/* -------------------------------------------------- Pedidos recentes */}
        <section className="acard">
          <header className="acard__head">
            <h2>Pedidos recentes</h2>
            <Link to="/admin/pedidos" className="btn btn--ghost btn--sm">
              Ver todos <Icon name="chevronRight" size={14} />
            </Link>
          </header>

          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Pedido</th>
                  <th>Cliente</th>
                  <th>Data</th>
                  <th>Status</th>
                  <th className="ta-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((o) => (
                  <tr key={o.id}>
                    <td className="mono">{orderCode(o.seq, o.createdAt)}</td>
                    <td className="ellip">{o.customer.name}</td>
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
        </section>

        {/* --------------------------------------------------- Estoque baixo */}
        <section className="acard">
          <header className="acard__head">
            <h2>Estoque baixo</h2>
            <span className="acard__meta">≤ {settings.lowStockThreshold} un.</span>
          </header>

          {lowStock.length === 0 ? (
            <p className="acard__empty">Nenhum produto em nível crítico.</p>
          ) : (
            <ul className="lowlist">
              {lowStock.map((p) => (
                <li key={p.id}>
                  <span className="lowlist__art">
                    <ProductArt product={p} />
                  </span>
                  <span className="lowlist__body">
                    <strong>{p.name}</strong>
                    <span>{categoryById[p.categoryId]?.name}</span>
                  </span>
                  <span className={`tag ${p.stock === 0 ? 'tag--red' : 'tag--orange'}`}>
                    {p.stock} un.
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  )
}
