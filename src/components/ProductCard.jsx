import { Link } from 'react-router-dom'
import { useStore } from '../store/StoreContext'
import { discountPct, effectivePrice, money } from '../lib/format'
import ProductArt from './ProductArt'
import Icon from './Icon'

export default function ProductCard({ product }) {
  const { addToCart, settings } = useStore()

  /* Com variação o card mostra a opção mais barata que ainda tem estoque, e o
     estoque é a soma das opções — é o que o cliente enxerga como "tem ou não
     tem". A escolha em si acontece na página do produto. */
  const variacoes = (product.variants ?? []).filter((v) => v.active)
  const temVariacoes = variacoes.length > 0

  const vitrine = temVariacoes
    ? [...variacoes].sort((a, b) => effectivePrice(a) - effectivePrice(b))[0]
    : product
  const estoque = temVariacoes
    ? variacoes.reduce((soma, v) => soma + v.stock, 0)
    : product.stock

  const price = effectivePrice(vitrine)
  const off = discountPct(vitrine.price, vitrine.promo)
  const out = estoque <= 0
  const low = !out && estoque <= settings.lowStockThreshold

  return (
    <article className={`pcard${out ? ' is-out' : ''}`}>
      <Link to={`/produto/${product.id}`} className="pcard__media" tabIndex={-1} aria-hidden="true">
        <ProductArt product={product} className="pcard__art" />
        {off > 0 && !out && <span className="pcard__badge">−{off}%</span>}
        {out && <span className="pcard__badge pcard__badge--muted">Esgotado</span>}
        {low && <span className="pcard__badge pcard__badge--warn">Últimas {estoque}</span>}
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
          {temVariacoes && <span className="pcard__from">a partir de</span>}
          <strong>{money(price)}</strong>
          {off > 0 && <s>{money(vitrine.price)}</s>}
        </div>

        {/* Produto com variação não vai direto para a sacola: sem escolher a
            opção, não dá para saber qual estoque baixar. */}
        {temVariacoes ? (
          <Link
            to={`/produto/${product.id}`}
            className="btn btn--primary pcard__add"
            aria-disabled={out}
          >
            <Icon name="grid" size={16} />
            {out ? 'Sem estoque' : `Escolher ${(product.variantLabel || '').toLowerCase()}`}
          </Link>
        ) : (
          <button
            className="btn btn--primary pcard__add"
            onClick={() => addToCart(product, 1)}
            disabled={out}
          >
            <Icon name="bag" size={16} />
            {out ? 'Sem estoque' : 'Adicionar à sacola'}
          </button>
        )}
      </div>
    </article>
  )
}
