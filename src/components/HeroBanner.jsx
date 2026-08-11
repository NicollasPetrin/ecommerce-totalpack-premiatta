import { Link } from 'react-router-dom'
import { useStore } from '../store/StoreContext'
import { useCarousel } from '../lib/useCarousel'
import { effectivePrice, money } from '../lib/format'
import ProductArt from './ProductArt'
import Icon from './Icon'

/**
 * Faixa de painéis no topo da home, com a foto de cada produto cadastrado.
 *
 * O formato segue os banners de papelaria: painel de cantos redondos, fundo
 * colorido e a foto do produto grande, com o nome da categoria em letra
 * vazada por cima. A cor sai do próprio produto (`tint`), então a faixa muda
 * de tom conforme o catálogo — não há arte fixa para ninguém manter.
 *
 * No desktop cabem dois painéis lado a lado, como na referência; abaixo de
 * 900px passa a um por vez.
 */
export default function HeroBanner({ products }) {
  const { categories } = useStore()
  const count = products.length
  const { trackRef, index, step, goTo, pausaProps } = useCarousel(count, { intervalo: 6000 })

  if (!count) return null

  const nomeCategoria = (id) => categories.find((c) => c.id === id)?.name ?? 'Material escolar'

  return (
    <section
      className="hbanner"
      {...pausaProps}
      aria-roledescription="carrossel"
      aria-label="Destaques da loja"
    >
      <ul className="hbanner__track" ref={trackRef}>
        {products.map((p, i) => (
          <li
            key={p.id}
            className="hbanner__slide"
            style={{ '--tint': p.tint }}
            aria-label={`${i + 1} de ${count}`}
          >
            <Link to={`/produto/${p.id}`} className="hbanner__panel">
              <span className="hbanner__text">
                <em className="hbanner__kicker">{nomeCategoria(p.categoryId)}</em>
                <strong className="hbanner__name">{p.name}</strong>
                <span className="hbanner__price">{money(effectivePrice(p))}</span>
                <span className="hbanner__cta">
                  Ver produto <Icon name="arrowRight" size={16} />
                </span>
              </span>

              <span className="hbanner__shot">
                <ProductArt product={p} />
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {count > 1 && (
        <>
          <button
            type="button"
            className="hbanner__nav hbanner__nav--prev"
            onClick={() => step(-1)}
            aria-label="Anterior"
          >
            <Icon name="chevronLeft" size={22} />
          </button>

          <button
            type="button"
            className="hbanner__nav hbanner__nav--next"
            onClick={() => step(1)}
            aria-label="Próximo"
          >
            <Icon name="chevronRight" size={22} />
          </button>

          <div className="hbanner__dots" role="tablist" aria-label="Escolher destaque">
            {products.map((p, i) => (
              <button
                key={p.id}
                type="button"
                role="tab"
                aria-selected={i === index}
                aria-label={`Ir para ${p.name}`}
                className={`hbanner__dot${i === index ? ' is-on' : ''}`}
                onClick={() => goTo(i)}
              />
            ))}
          </div>
        </>
      )}
    </section>
  )
}
