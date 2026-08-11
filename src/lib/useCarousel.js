import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Mecânica compartilhada dos carrosséis da loja.
 *
 * Rolagem nativa com `scroll-snap`: no celular o dedo arrasta sem precisar de
 * biblioteca, e no computador as setas empurram a lista. Avança sozinho e para
 * assim que alguém interage — nada pior do que a vitrine trocar de item bem na
 * hora em que a pessoa vai clicar.
 */
export function useCarousel(count, { intervalo = 5000 } = {}) {
  const trackRef = useRef(null)
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)

  /** Rola até um item pelo índice. */
  const goTo = useCallback((i) => {
    const track = trackRef.current
    if (!track) return
    const item = track.children[i]
    if (!item) return

    // Quem pediu menos movimento no sistema recebe o salto direto.
    const suave = !window.matchMedia('(prefers-reduced-motion: reduce)').matches

    /* O recuo lateral da pista precisa sair da conta: sem isso o primeiro
       item encosta na borda da tela e perde a margem, em vez de parar onde
       o `scroll-snap` o colocaria. */
    const estilo = getComputedStyle(track)
    const recuo = parseFloat(estilo.scrollPaddingLeft) || parseFloat(estilo.paddingLeft) || 0

    track.scrollTo({
      left: item.offsetLeft - track.offsetLeft - recuo,
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
    }, intervalo)

    return () => clearInterval(timer)
  }, [paused, count, goTo, intervalo])

  const step = (dir) => goTo((index + dir + count) % count)

  /* Espalhado direto no elemento que embrulha o carrossel. */
  const pausaProps = {
    onMouseEnter: () => setPaused(true),
    onMouseLeave: () => setPaused(false),
    onFocusCapture: () => setPaused(true),
    onBlurCapture: () => setPaused(false),
    onTouchStart: () => setPaused(true),
  }

  return { trackRef, index, goTo, step, pausaProps }
}
