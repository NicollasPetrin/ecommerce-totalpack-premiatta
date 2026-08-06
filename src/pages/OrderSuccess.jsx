import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useStore, PAYMENT_LABEL } from '../store/StoreContext'
import { api } from '../lib/api'
import { dateTime, maskCep, money, orderCode } from '../lib/format'
import ProductArt from '../components/ProductArt'
import Icon from '../components/Icon'

export default function OrderSuccess() {
  const { id } = useParams()
  const { settings, toast } = useStore()

  // O pedido é buscado por id: o cliente não carrega a lista de pedidos da
  // loja, e o servidor só devolve este se ele tiver direito de vê-lo.
  const [order, setOrder] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    api
      .get(`/orders/${id}`)
      .then(({ order: found }) => !cancelled && setOrder(found))
      .catch(() => !cancelled && setOrder(null))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [id])

  if (loading) {
    return (
      <div className="wrap empty" style={{ minHeight: '60vh' }}>
        <span className="boot__spinner" aria-hidden="true" />
        <p>Carregando o pedido…</p>
      </div>
    )
  }

  if (!order) {
    return (
      <div className="wrap empty" style={{ minHeight: '60vh' }}>
        <Icon name="receipt" size={48} strokeWidth={1.2} />
        <h3>Pedido não encontrado</h3>
        <p>O endereço pode estar errado, ou este pedido pertence a outra conta.</p>
        <Link to="/catalogo" className="btn btn--primary">
          Voltar à loja
        </Link>
      </div>
    )
  }

  const code = orderCode(order.seq, order.createdAt)

  const copyPix = async () => {
    try {
      await navigator.clipboard.writeText(settings.pixKey)
      toast('Chave PIX copiada.')
    } catch {
      toast('Não foi possível copiar. Copie manualmente.', 'err')
    }
  }

  return (
    <div className="wrap success">
      <div className="success__hero">
        <span className="success__check">
          <Icon name="check" size={38} strokeWidth={2.4} />
        </span>
        <h1>Pedido confirmado</h1>
        <p>
          Recebemos o pedido <strong>{code}</strong>. Vamos entrar em contato pelo
          telefone ou e-mail informados para confirmar o pagamento e a entrega.
        </p>

        <div className="success__cta">
          <Link className="btn btn--primary btn--lg" to="/catalogo">
            Continuar comprando
          </Link>
        </div>
      </div>

      <div className="success__grid">
        <section className="panel">
          <h2 className="panel__title">Itens</h2>
          <ul className="summary__items">
            {order.items.map((i) => (
              <li key={i.productId}>
                <span className="summary__art">
                  <ProductArt product={i} />
                  <em>{i.qty}</em>
                </span>
                <span className="summary__name">{i.name}</span>
                <strong>{money(i.price * i.qty)}</strong>
              </li>
            ))}
          </ul>

          <dl className="totals">
            <div>
              <dt>Subtotal</dt>
              <dd>{money(order.subtotal)}</dd>
            </div>
            <div>
              <dt>{order.delivery === 'retirada' ? 'Retirada' : 'Entrega'}</dt>
              <dd>
                {order.shipping === 0 ? <span className="free">Grátis</span> : money(order.shipping)}
              </dd>
            </div>
            <div className="totals__grand">
              <dt>Total</dt>
              <dd>{money(order.total)}</dd>
            </div>
          </dl>
        </section>

        <section className="panel">
          <h2 className="panel__title">Detalhes</h2>

          <dl className="deflist">
            <div>
              <dt>Pedido</dt>
              <dd>{code}</dd>
            </div>
            <div>
              <dt>Data</dt>
              <dd>{dateTime(order.createdAt)}</dd>
            </div>
            <div>
              <dt>Cliente</dt>
              <dd>{order.customer.name}</dd>
            </div>
            <div>
              <dt>Telefone</dt>
              <dd>{order.customer.phone}</dd>
            </div>
            <div>
              <dt>Pagamento</dt>
              <dd>{PAYMENT_LABEL[order.payment]}</dd>
            </div>
            <div>
              <dt>{order.delivery === 'retirada' ? 'Retirada' : 'Endereço'}</dt>
              <dd>
                {order.delivery === 'retirada'
                  ? settings.address
                  : `${order.customer.address}, ${order.customer.number}${
                      order.customer.complement ? ` — ${order.customer.complement}` : ''
                    } · ${order.customer.district} · ${order.customer.city}/${
                      order.customer.state
                    } · CEP ${maskCep(order.customer.cep)}`}
              </dd>
            </div>
            {order.note && (
              <div>
                <dt>Observação</dt>
                <dd>{order.note}</dd>
              </div>
            )}
          </dl>

          {order.payment === 'pix' && (
            <div className="pixbox">
              <div>
                <span className="label">Chave PIX</span>
                <strong>{settings.pixKey}</strong>
              </div>
              <button className="btn btn--secondary btn--sm" onClick={copyPix}>
                <Icon name="copy" size={15} /> Copiar
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
