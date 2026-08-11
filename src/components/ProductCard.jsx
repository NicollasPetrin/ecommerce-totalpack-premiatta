import { Link } from 'react-router-dom'
import { useStore } from '../store/StoreContext'
import { discountPct, effectivePrice, money } from '../lib/format'
import ProductArt from './ProductArt'
import Icon from './Icon'

export default function ProductCard({ product }) {
  const { addToCart, settings } = useStore()
  const price = effectivePrice(product)
  const off = discountPct(product.price, product.promo)
  const out = product.stock <= 0
  const low = !out && product.stock <= settings.lowStockThreshold

  return (
    <article className={`pcard${out ? ' is-out' : ''}`}>
      <Link to={`/produto/${product.id}`} className="pcard__media" tabIndex={-1} aria-hidden="true">
        <ProductArt product={product} className="pcard__art" />
        {off > 0 && !out && <span className="pcard__badge">−{off}%</span>}
        {out && <span className="pcard__badge pcard__badge--muted">Esgotado</span>}
        {low && <span className="pcard__badge pcard__badge--warn">Últimas {product.stock}</span>}
      </Link>

      <div className="pcard__body">
        <h3 className="pcard__name">
          <Link to={`/produto/${product.id}`}>{product.name}</Link>
        </h3>

        {/* Como no atacado de papelaria: a embalagem é o dado que decide a
            compra (uma resma não é uma folha), então vira etiqueta, não
            texto miúdo. O código ajuda quem confere pedido por telefone. */}
        <div className="pcard__meta">
          <span className="pcard__unit">{product.unit}</span>
          {product.sku && <span className="pcard__sku">{product.sku}</span>}
        </div>

        <div className="pcard__price">
          <strong>{money(price)}</strong>
          {off > 0 && <s>{money(product.price)}</s>}
        </div>

        <button
          className="btn btn--primary pcard__add"
          onClick={() => addToCart(product, 1)}
          disabled={out}
        >
          <Icon name="bag" size={16} />
          {out ? 'Sem estoque' : 'Adicionar à sacola'}
        </button>
      </div>
    </article>
  )
}
