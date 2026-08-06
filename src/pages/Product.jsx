import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../store/StoreContext'
import { discountPct, effectivePrice, money } from '../lib/format'
import ProductArt from '../components/ProductArt'
import ProductCard from '../components/ProductCard'
import QtyStepper from '../components/QtyStepper'
import ShippingCalculator from '../components/ShippingCalculator'
import Icon from '../components/Icon'

export default function Product() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { productById, categoryById, products, addToCart, setCartOpen, settings } = useStore()
  const [qty, setQty] = useState(1)

  const product = productById[id]

  if (!product || !product.active) {
    return (
      <div className="wrap empty" style={{ minHeight: '58vh' }}>
        <Icon name="box" size={48} strokeWidth={1.2} />
        <h3>Produto não encontrado</h3>
        <p>Este item pode ter saído do catálogo.</p>
        <Link to="/catalogo" className="btn btn--primary">
          Voltar ao catálogo
        </Link>
      </div>
    )
  }

  const category = categoryById[product.categoryId]
  const price = effectivePrice(product)
  const off = discountPct(product.price, product.promo)
  const out = product.stock <= 0
  const low = !out && product.stock <= settings.lowStockThreshold

  const related = products
    .filter((p) => p.active && p.categoryId === product.categoryId && p.id !== product.id)
    .slice(0, 4)

  const buyNow = () => {
    addToCart(product, qty)
    if (!out) navigate('/checkout')
  }

  return (
    <div className="wrap pdp">
      <nav className="crumbs" aria-label="Trilha">
        <Link to="/">Início</Link>
        <Icon name="chevronRight" size={13} />
        {category && (
          <>
            <Link to={`/catalogo?cat=${category.slug}`}>{category.name}</Link>
            <Icon name="chevronRight" size={13} />
          </>
        )}
        <span>{product.name}</span>
      </nav>

      <div className="pdp__grid">
        <div className="pdp__media">
          <ProductArt product={product} className="pdp__art" />
          {off > 0 && <span className="pdp__badge">−{off}%</span>}
        </div>

        <div className="pdp__info">
          {category && (
            <Link to={`/catalogo?cat=${category.slug}`} className="pdp__cat">
              {category.name}
            </Link>
          )}

          <h1>{product.name}</h1>

          <div className="pdp__price">
            <strong>{money(price)}</strong>
            {off > 0 && (
              <>
                <s>{money(product.price)}</s>
                <span className="tag tag--green">Economize {money(product.price - price)}</span>
              </>
            )}
          </div>
          <p className="pdp__unit">
            Preço por {product.unit} · SKU {product.sku}
          </p>

          <p className="pdp__desc">{product.description}</p>

          <div className="pdp__stock">
            {out ? (
              <span className="tag tag--red">
                <Icon name="alert" size={14} /> Esgotado
              </span>
            ) : low ? (
              <span className="tag tag--orange">
                <Icon name="alert" size={14} /> Últimas {product.stock} unidades
              </span>
            ) : (
              <span className="tag tag--green">
                <Icon name="check" size={14} /> Em estoque · {product.stock} disponíveis
              </span>
            )}
          </div>

          <div className="pdp__buy">
            <QtyStepper value={qty} onChange={setQty} max={Math.max(1, product.stock)} />
            <button
              className="btn btn--primary btn--lg"
              disabled={out}
              onClick={() => {
                addToCart(product, qty)
                setCartOpen(true)
              }}
            >
              <Icon name="bag" size={18} /> Adicionar à sacola
            </button>
            <button className="btn btn--outline btn--lg" disabled={out} onClick={buyNow}>
              Comprar agora
            </button>
          </div>

          {qty > 1 && !out && (
            <p className="pdp__subtotal">
              Subtotal: <strong>{money(price * qty)}</strong>
            </p>
          )}

          <div className="pdp__ship">
            <ShippingCalculator />
          </div>

          <ul className="pdp__perks">
            <li>
              <Icon name="truck" size={18} />
              Frete grátis acima de {money(settings.freeShippingFrom)}
            </li>
            <li>
              <Icon name="box" size={18} />
              Entrega para todo o Brasil
            </li>
            <li>
              <Icon name="shield" size={18} />
              PIX, cartão ou boleto
            </li>
          </ul>

          {product.specs?.length > 0 && (
            <div className="pdp__specs">
              <h2>Especificações</h2>
              <ul>
                {product.specs.map((s) => (
                  <li key={s}>
                    <Icon name="check" size={15} />
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {related.length > 0 && (
        <section className="section">
          <header className="section__head">
            <div>
              <h2>Quem compra este, leva também</h2>
            </div>
          </header>
          <div className="grid grid--4">
            {related.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
