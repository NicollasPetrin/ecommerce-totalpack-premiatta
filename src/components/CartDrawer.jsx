import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { Link, useNavigate } from 'react-router-dom'
import { useStore } from '../store/StoreContext'
import { money } from '../lib/format'
import ProductArt from './ProductArt'
import QtyStepper from './QtyStepper'
import Icon from './Icon'

export default function CartDrawer() {
  const {
    cartOpen,
    setCartOpen,
    cartLines,
    subtotal,
    shipping,
    total,
    freeShipping,
    settings,
    setQty,
    removeFromCart,
  } = useStore()
  const navigate = useNavigate()

  useEffect(() => {
    if (!cartOpen) return
    const onKey = (e) => e.key === 'Escape' && setCartOpen(false)
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [cartOpen, setCartOpen])

  const missing = Math.max(0, settings.freeShippingFrom - subtotal)
  const progress = Math.min(100, (subtotal / settings.freeShippingFrom) * 100)

  return createPortal(
    <>
      <div
        className={`drawer-scrim${cartOpen ? ' is-open' : ''}`}
        onClick={() => setCartOpen(false)}
        aria-hidden="true"
      />
      <aside
        className={`drawer${cartOpen ? ' is-open' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Sacola de compras"
      >
        <header className="drawer__head">
          <h2>Sacola</h2>
          <span className="drawer__count">
            {cartLines.length} {cartLines.length === 1 ? 'item' : 'itens'}
          </span>
          <button className="icon-btn" onClick={() => setCartOpen(false)} aria-label="Fechar sacola">
            <Icon name="close" size={18} />
          </button>
        </header>

        {cartLines.length === 0 ? (
          <div className="empty">
            <Icon name="bag" size={44} strokeWidth={1.2} />
            <h3>Sua sacola está vazia</h3>
            <p>Adicione papéis, cadernos e o que mais a escola pedir.</p>
            <Link to="/catalogo" className="btn btn--primary" onClick={() => setCartOpen(false)}>
              Ver produtos
            </Link>
          </div>
        ) : (
          <>
            <div className="drawer__ship">
              {freeShipping ? (
                <p className="drawer__ship-ok">
                  <Icon name="truck" size={17} /> Frete grátis liberado
                </p>
              ) : (
                <p>
                  Faltam <strong>{money(missing)}</strong> para frete grátis
                </p>
              )}
              <div className="drawer__bar" aria-hidden="true">
                <span style={{ width: `${progress}%` }} />
              </div>
            </div>

            <ul className="drawer__list">
              {cartLines.map((l) => (
                <li key={l.productId} className="cline">
                  <Link
                    to={`/produto/${l.productId}`}
                    className="cline__media"
                    onClick={() => setCartOpen(false)}
                  >
                    <ProductArt product={l.product} className="cline__art" />
                  </Link>

                  <div className="cline__body">
                    <Link
                      to={`/produto/${l.productId}`}
                      className="cline__name"
                      onClick={() => setCartOpen(false)}
                    >
                      {l.product.name}
                    </Link>
                    <span className="cline__unit">{money(l.price)} / {l.product.unit}</span>

                    <div className="cline__foot">
                      <QtyStepper
                        value={l.qty}
                        onChange={(v) => setQty(l.productId, v)}
                        max={l.product.stock}
                        size="sm"
                      />
                      <strong className="cline__total">{money(l.lineTotal)}</strong>
                    </div>
                  </div>

                  <button
                    className="icon-btn cline__del"
                    onClick={() => removeFromCart(l.productId)}
                    aria-label={`Remover ${l.product.name}`}
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </li>
              ))}
            </ul>

            <footer className="drawer__foot">
              <dl className="totals">
                <div>
                  <dt>Subtotal</dt>
                  <dd>{money(subtotal)}</dd>
                </div>
                <div>
                  <dt>Entrega</dt>
                  <dd>{shipping === 0 ? <span className="free">Grátis</span> : money(shipping)}</dd>
                </div>
                <div className="totals__grand">
                  <dt>Total</dt>
                  <dd>{money(total)}</dd>
                </div>
              </dl>

              <button
                className="btn btn--primary btn--lg btn--block"
                onClick={() => {
                  setCartOpen(false)
                  navigate('/checkout')
                }}
              >
                Finalizar pedido
              </button>
              <button className="btn btn--ghost btn--block" onClick={() => setCartOpen(false)}>
                Continuar comprando
              </button>
            </footer>
          </>
        )}
      </aside>
    </>,
    document.body,
  )
}
