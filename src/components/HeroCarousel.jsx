import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { discountPct, effectivePrice, money } from '../lib/format'
import ProductArt from './ProductArt'
import Icon from './Icon'

/**
 * Carrossel de produtos da página inicial.
 *
 * Rolagem nativa com `scroll-snap`: no celular o dedo arrasta sem precisar de
 * biblioteca, e no computador as setas empurram a lista. Avança sozinho a cada
 * 5 segundos e para assim que alguém interage — nada pior do que a vitrine
 * trocar de item bem na hora em que a pessoa vai clicar.
 */
export default function HeroCarousel({ products }) {
  const trackRef = useRef(null)
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)

  const count = products.length

  /** Rola até um item pelo índice. */
  const goTo = useCallback((i) => {
    const track = trackRef.current
    if (!track) return
    const item = track.children[i]
    if (!item) return

    // Quem pediu menos movimento no sistema recebe o salto direto.
    const suave = !window.matchMedia('(prefers-reduced-motion: reduce)').matches

    track.scrollTo({
      left: item.offsetLeft - track.offsetLeft,
      behavior: suave ? 'smooth' : 'auto',
    })

    // O marcador acompanha na hora. Sem isto ele só mudaria quando o evento de
    // rolagem chegasse — e numa aba em segundo plano isso pode nem acontecer.
    setIndex(i)
  }, [])

  /* O índice ativo vem da rolagem, não de um contador nosso: assim o arraste
     com o dedo e as setas nunca ficam fora de sincronia. */
  useEffect(() => {
    const track = trackRef.current
    if (!track) return

    let frame
    const onScroll = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        // Item ativo é o que está encostado na borda esquerda visível.
        const items = [...track.children]
        const closest = items.reduce(
          (best, el, i) => {
            const distance = Math.abs(el.offsetLeft - track.offsetLeft - track.scrollLeft)
            return distance < best.distance ? { i, distance } : best
          },
          { i: 0, distance: Infinity },
        )
        setIndex(closest.i)
      })
    }

    track.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      track.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(frame)
    }
  }, [])

  /* Avanço automático. Desligado quando o visitante prefere menos movimento. */
  useEffect(() => {
    if (paused || count < 2) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const timer = setInterval(() => {
      setIndex((current) => {
        const next = (current + 1) % count
        goTo(next)
        return next
      })
    }, 5000)

    return () => clearInterval(timer)
  }, [paused, count, goTo])

  if (!count) return null

  const step = (dir) => goTo((index + dir + count) % count)

  return (
    <div
      className="carousel"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      onTouchStart={() => setPaused(true)}
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
