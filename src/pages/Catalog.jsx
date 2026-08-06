import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useStore } from '../store/StoreContext'
import { discountPct, effectivePrice, money, norm } from '../lib/format'
import ProductCard from '../components/ProductCard'
import Icon from '../components/Icon'

const SORTS = {
  relevancia: 'Relevância',
  menor: 'Menor preço',
  maior: 'Maior preço',
  desconto: 'Maior desconto',
  nome: 'Nome (A–Z)',
}

export default function Catalog() {
  const { products, categories, settings } = useStore()
  const [params, setParams] = useSearchParams()
  const [filtersOpen, setFiltersOpen] = useState(false)

  const q = params.get('q') ?? ''
  const cat = params.get('cat') ?? ''
  const sort = params.get('sort') ?? 'relevancia'
  const onlyPromo = params.get('promo') === '1'
  const inStock = params.get('estoque') === '1'
  const maxPrice = Number(params.get('max') ?? 0)

  const setParam = (key, value) => {
    const next = new URLSearchParams(params)
    if (!value || value === 'relevancia') next.delete(key)
    else next.set(key, value)
    setParams(next, { replace: true })
  }

  const live = useMemo(() => products.filter((p) => p.active), [products])

  const priceCeiling = useMemo(
    () => Math.ceil(Math.max(10, ...live.map(effectivePrice)) / 10) * 10,
    [live],
  )

  const activeCat = categories.find((c) => c.slug === cat)

  const result = useMemo(() => {
    const term = norm(q)
    let list = live

    if (activeCat) list = list.filter((p) => p.categoryId === activeCat.id)

    if (term) {
      list = list.filter((p) => {
        const cName = categories.find((c) => c.id === p.categoryId)?.name ?? ''
        return norm(`${p.name} ${p.description} ${p.sku} ${cName}`).includes(term)
      })
    }

    if (onlyPromo) list = list.filter((p) => p.promo > 0 && p.promo < p.price)
    if (inStock) list = list.filter((p) => p.stock > 0)
    if (maxPrice > 0) list = list.filter((p) => effectivePrice(p) <= maxPrice)

    const sorted = [...list]
    switch (sort) {
      case 'menor':
        sorted.sort((a, b) => effectivePrice(a) - effectivePrice(b))
        break
      case 'maior':
        sorted.sort((a, b) => effectivePrice(b) - effectivePrice(a))
        break
      case 'desconto':
        sorted.sort(
          (a, b) => discountPct(b.price, b.promo) - discountPct(a.price, a.promo),
        )
        break
      case 'nome':
        sorted.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
        break
      default:
        sorted.sort(
          (a, b) =>
            Number(b.featured) - Number(a.featured) ||
            Number(b.stock > 0) - Number(a.stock > 0),
        )
    }
    return sorted
  }, [live, activeCat, q, onlyPromo, inStock, maxPrice, sort, categories])

  const hasFilters = Boolean(q || cat || onlyPromo || inStock || maxPrice)
  const ordered = [...categories].sort((a, b) => (a.order ?? 99) - (b.order ?? 99))

  return (
    <div className="wrap catalog">
      <header className="catalog__head">
        <nav className="crumbs" aria-label="Trilha">
          <Link to="/">Início</Link>
          <Icon name="chevronRight" size={13} />
          <span>{activeCat ? activeCat.name : 'Todos os produtos'}</span>
        </nav>

        <h1>{activeCat ? activeCat.name : q ? `Resultados para “${q}”` : 'Todos os produtos'}</h1>
        <p className="catalog__sub">
          {activeCat?.description ??
            `${result.length} ${result.length === 1 ? 'produto disponível' : 'produtos disponíveis'}`}
        </p>
      </header>

      {/* Filtro rápido por categoria */}
      <div className="chips" role="tablist" aria-label="Filtrar por categoria">
        <button
          role="tab"
          aria-selected={!cat}
          className={`chip${!cat ? ' is-on' : ''}`}
          onClick={() => setParam('cat', '')}
        >
          Tudo
        </button>
        {ordered.map((c) => (
          <button
            key={c.id}
            role="tab"
            aria-selected={cat === c.slug}
            className={`chip${cat === c.slug ? ' is-on' : ''}`}
            onClick={() => setParam('cat', c.slug)}
          >
            {c.name}
          </button>
        ))}
      </div>

      <div className="catalog__body">
        {/* ------------------------------------------------------- Filtros */}
        <aside className={`filters${filtersOpen ? ' is-open' : ''}`}>
          <div className="filters__head">
            <h2>Filtros</h2>
            {hasFilters && (
              <button className="btn btn--ghost btn--sm" onClick={() => setParams({})}>
                Limpar
              </button>
            )}
          </div>

          <div className="filters__group">
            <span className="label">Preço máximo</span>
            <input
              type="range"
              min="5"
              max={priceCeiling}
              step="5"
              value={maxPrice || priceCeiling}
              onChange={(e) =>
                setParam('max', Number(e.target.value) >= priceCeiling ? '' : e.target.value)
              }
              className="range"
              aria-label="Preço máximo"
            />
            <div className="filters__range-labels">
              <span>{money(5)}</span>
              <strong>{money(maxPrice || priceCeiling)}</strong>
            </div>
          </div>

          <div className="filters__group">
            <label className="switch">
              <input
                type="checkbox"
                checked={onlyPromo}
                onChange={(e) => setParam('promo', e.target.checked ? '1' : '')}
              />
              <span className="switch__track" />
              Somente em promoção
            </label>
          </div>

          <div className="filters__group">
            <label className="switch">
              <input
                type="checkbox"
                checked={inStock}
                onChange={(e) => setParam('estoque', e.target.checked ? '1' : '')}
              />
              <span className="switch__track" />
              Somente em estoque
            </label>
          </div>

          <div className="filters__note">
            <Icon name="truck" size={17} />
            <p>Frete grátis acima de {money(settings.freeShippingFrom)}.</p>
          </div>
        </aside>

        {/* ------------------------------------------------------ Resultado */}
        <section className="catalog__results">
          <div className="catalog__toolbar">
            <button
              className="btn btn--outline btn--sm catalog__filter-btn"
              onClick={() => setFiltersOpen((v) => !v)}
            >
              <Icon name="filter" size={16} /> Filtros
              {hasFilters && <span className="dot" />}
            </button>

            <span className="catalog__count">
              {result.length} {result.length === 1 ? 'item' : 'itens'}
            </span>

            <label className="catalog__sort">
              <span className="sr-only">Ordenar por</span>
              <select
                className="select"
                value={sort}
                onChange={(e) => setParam('sort', e.target.value)}
              >
                {Object.entries(SORTS).map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {result.length === 0 ? (
            <div className="empty">
              <Icon name="search" size={44} strokeWidth={1.2} />
              <h3>Nenhum produto encontrado</h3>
              <p>Tente outro termo ou remova alguns filtros.</p>
              <button className="btn btn--secondary" onClick={() => setParams({})}>
                Limpar filtros
              </button>
            </div>
          ) : (
            <div className="grid grid--3">
              {result.map((p) => (
                <ProductCard key={p.id} product={p} />
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
