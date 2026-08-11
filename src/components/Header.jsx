import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useStore } from '../store/StoreContext'
import Logo from './Logo'
import Icon from './Icon'

export default function Header() {
  const { categories, cartCount, setCartOpen, settings, theme, setTheme, currentCustomer } =
    useStore()
  const [scrolled, setScrolled] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [q, setQ] = useState('')
  const inputRef = useRef(null)
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { pathname } = useLocation()
  /* Só destaca categoria dentro do catálogo: na home nenhuma está aberta. */
  const noCatalogo = pathname === '/catalogo'
  const catAtual = noCatalogo ? params.get('cat') : null

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (searchOpen) inputRef.current?.focus()
  }, [searchOpen])

  useEffect(() => {
    document.body.style.overflow = menuOpen ? 'hidden' : ''
    return () => {
      document.body.style.overflow = ''
    }
  }, [menuOpen])

  const submit = (e) => {
    e.preventDefault()
    const term = q.trim()
    navigate(term ? `/catalogo?q=${encodeURIComponent(term)}` : '/catalogo')
    setSearchOpen(false)
    setMenuOpen(false)
  }

  const cycleTheme = () => {
    const next = theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system'
    setTheme(next)
  }

  const themeIcon = theme === 'dark' ? 'moon' : theme === 'light' ? 'sun' : 'sparkles'
  const themeTitle =
    theme === 'system' ? 'Tema: automático' : theme === 'light' ? 'Tema: claro' : 'Tema: escuro'

  const topCats = [...categories].sort((a, b) => (a.order ?? 99) - (b.order ?? 99))

  return (
    <header className={`nav${scrolled ? ' is-scrolled' : ''}`}>
      <div className="nav__inner">
        <button
          className="nav__burger icon-btn"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Menu"
          aria-expanded={menuOpen}
        >
          <Icon name={menuOpen ? 'close' : 'menu'} size={20} />
        </button>

        <Link to="/" className="nav__logo" onClick={() => setMenuOpen(false)}>
          <Logo size={30} className="nav__mark" />
          {settings.storeName}
        </Link>

        {/* Busca sempre à vista, como nos atacados de papelaria: numa loja de
            catálogo grande, procurar é o caminho principal, não um extra
            escondido atrás de um ícone. No celular ela vira o botão de lupa
            logo abaixo, porque não há largura para as duas coisas. */}
        <form className="nav__find" onSubmit={submit} role="search">
          <Icon name="search" size={17} />
          <input
            className="nav__find-input"
            type="search"
            placeholder="Buscar por nome ou código do produto…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Buscar produtos"
          />
          {q && (
            <button type="button" className="nav__find-clear" onClick={() => setQ('')} aria-label="Limpar">
              <Icon name="close" size={15} />
            </button>
          )}
        </form>

        <div className="nav__actions">
          <button
            className="icon-btn"
            onClick={cycleTheme}
            aria-label={themeTitle}
            title={themeTitle}
          >
            <Icon name={themeIcon} size={18} />
          </button>

          <button
            className="icon-btn nav__find-toggle"
            onClick={() => setSearchOpen((v) => !v)}
            aria-label="Buscar"
            aria-expanded={searchOpen}
          >
            <Icon name={searchOpen ? 'close' : 'search'} size={18} />
          </button>

          <Link
            to={currentCustomer ? '/conta' : '/entrar'}
            className="icon-btn"
            aria-label={currentCustomer ? 'Minha conta' : 'Entrar'}
            title={currentCustomer ? `Conta de ${currentCustomer.name.split(' ')[0]}` : 'Entrar'}
          >
            <Icon name="user" size={18} />
          </Link>

          <button className="icon-btn nav__bag" onClick={() => setCartOpen(true)} aria-label="Sacola">
            <Icon name="bag" size={18} />
            {cartCount > 0 && <span className="nav__count">{cartCount}</span>}
          </button>
        </div>
      </div>

      {/* Segunda linha só de categorias, como Reval e VPA fazem: todas cabem,
          em vez das cinco que sobravam espremidas ao lado da logo. */}
      <nav className="nav__cats" aria-label="Categorias">
        <div className="nav__cats-inner">
          <Link to="/catalogo" className={noCatalogo && !catAtual ? 'is-on' : undefined}>
            Todos os produtos
          </Link>
          {topCats.map((c) => (
            <Link
              key={c.id}
              to={`/catalogo?cat=${c.slug}`}
              className={catAtual === c.slug ? 'is-on' : undefined}
            >
              {c.name}
            </Link>
          ))}
        </div>
      </nav>

      {/* Busca deslizante */}
      <div className={`nav__search${searchOpen ? ' is-open' : ''}`}>
        <form className="nav__search-inner" onSubmit={submit} role="search">
          <Icon name="search" size={19} />
          <input
            ref={inputRef}
            className="nav__search-input"
            type="search"
            placeholder="Buscar papel A4, colorset, caderno…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Buscar produtos"
          />
          {q && (
            <button type="button" className="icon-btn" onClick={() => setQ('')} aria-label="Limpar">
              <Icon name="close" size={16} />
            </button>
          )}
        </form>
      </div>

      {/* Menu móvel */}
      <div className={`nav__mobile${menuOpen ? ' is-open' : ''}`}>
        <nav aria-label="Menu principal">
          <Link to="/catalogo" onClick={() => setMenuOpen(false)}>
            Todos os produtos <Icon name="chevronRight" size={17} />
          </Link>
          {topCats.map((c) => (
            <Link
              key={c.id}
              to={`/catalogo?cat=${c.slug}`}
              onClick={() => setMenuOpen(false)}
            >
              {c.name} <Icon name="chevronRight" size={17} />
            </Link>
          ))}
          <Link to={currentCustomer ? '/conta' : '/entrar'} onClick={() => setMenuOpen(false)}>
            {currentCustomer ? 'Minha conta' : 'Entrar na minha conta'}{' '}
            <Icon name="user" size={17} />
          </Link>
          <Link to="/admin" onClick={() => setMenuOpen(false)} className="nav__mobile-admin">
            Painel administrativo <Icon name="lock" size={16} />
          </Link>
        </nav>
      </div>
    </header>
  )
}
