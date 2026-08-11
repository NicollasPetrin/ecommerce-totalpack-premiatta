import { Link } from 'react-router-dom'
import { useCarousel } from '../lib/useCarousel'
import { discountPct, effectivePrice, money } from '../lib/format'
import ProductArt from './ProductArt'
import Icon from './Icon'

/** Carrossel de produtos da página inicial. */
export default function HeroCarousel({ products }) {
  const count = products.length
  const { trackRef, index, goTo, step, pausaProps } = useCarousel(count)

  if (!count) return null

  return (
    <div
      className="carousel"
      {...pausaProps}
      aria-roledescription="carrossel"
      aria-label="Produtos em destaque"
    >
      <button
        type="button"
        className="carousel__nav carousel__nav--prev"
        onClick={() => step(-1)}
        aria-label="Produto anterior"
      >
        <Icon name="chevronLeft" size={22} />
      </button>

      <ul className="carousel__track" ref={trackRef}>
        {products.map((p, i) => {
          const off = discountPct(p.price, p.promo)
          return (
            <li
              key={p.id}
              className="carousel__item"
              aria-hidden={i !== index}
              aria-label={`${i + 1} de ${count}`}
            >
              <Link to={`/produto/${p.id}`} tabIndex={i === index ? 0 : -1}>
                <span className="carousel__art">
                  <ProductArt product={p} />
                  {off > 0 && <em className="carousel__off">−{off}%</em>}
                </span>
                <strong className="carousel__name">{p.name}</strong>
                <span className="carousel__price">{money(effectivePrice(p))}</span>
              </Link>
            </li>
          )
        })}
      </ul>

      <button
        type="button"
        className="carousel__nav carousel__nav--next"
        onClick={() => step(1)}
        aria-label="Próximo produto"
      >
        <Icon name="chevronRight" size={22} />
      </button>

      <div className="carousel__dots" role="tablist" aria-label="Escolher produto">
        {products.map((p, i) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={i === index}
            aria-label={`Ir para ${p.name}`}
            className={`carousel__dot${i === index ? ' is-on' : ''}`}
            onClick={() => goTo(i)}
          />
        ))}
      </div>
    </div>
  )
}
