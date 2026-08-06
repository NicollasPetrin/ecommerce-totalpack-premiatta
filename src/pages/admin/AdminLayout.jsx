import { useState } from 'react'
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useStore } from '../../store/StoreContext'
import Icon from '../../components/Icon'

const NAV = [
  { to: '/admin', end: true, icon: 'chart', label: 'Visão geral' },
  { to: '/admin/pedidos', icon: 'receipt', label: 'Pedidos' },
  { to: '/admin/produtos', icon: 'box', label: 'Produtos' },
  { to: '/admin/categorias', icon: 'tags', label: 'Categorias' },
  { to: '/admin/clientes', icon: 'user', label: 'Clientes' },
  { to: '/admin/entrega', icon: 'truck', label: 'Entrega' },
  { to: '/admin/configuracoes', icon: 'gear', label: 'Configurações' },
]

export default function AdminLayout() {
  const { settings, logout, orders, products, theme, setTheme } = useStore()
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()

  const pending = orders.filter((o) => o.status === 'pendente').length
  const lowStock = products.filter(
    (p) => p.active && p.stock <= settings.lowStockThreshold,
  ).length

  const badge = (to) => {
    if (to === '/admin/pedidos' && pending) return pending
    if (to === '/admin/produtos' && lowStock) return lowStock
    return null
  }

  return (
    <div className={`admin${open ? ' is-open' : ''}`}>
      <aside className="asidebar">
        <div className="asidebar__brand">
          <span className="asidebar__mark" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none">
              <path d="M6 4h8l4 4v12H6z" fill="currentColor" opacity=".9" />
              <path d="M14 4v4h4" fill="currentColor" opacity=".45" />
            </svg>
          </span>
          <div>
            <strong>{settings.storeName}</strong>
            <span>Painel</span>
          </div>
          <button
            className="icon-btn asidebar__close"
            onClick={() => setOpen(false)}
            aria-label="Fechar menu"
          >
            <Icon name="close" size={18} />
          </button>
        </div>

        <nav className="asidebar__nav">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={() => setOpen(false)}
              className={({ isActive }) => `anav${isActive ? ' is-on' : ''}`}
            >
              <Icon name={item.icon} size={18} />
              <span>{item.label}</span>
              {badge(item.to) && <em className="anav__badge">{badge(item.to)}</em>}
            </NavLink>
          ))}
        </nav>

        <div className="asidebar__foot">
          <Link to="/" className="anav">
            <Icon name="store" size={18} />
            <span>Ver a loja</span>
          </Link>
          <button
            className="anav"
            onClick={() =>
              setTheme(theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark')
            }
          >
            <Icon name={theme === 'dark' ? 'moon' : theme === 'light' ? 'sun' : 'sparkles'} size={18} />
            <span>
              Tema: {theme === 'system' ? 'automático' : theme === 'light' ? 'claro' : 'escuro'}
            </span>
          </button>
          <button
            className="anav anav--danger"
            onClick={() => {
              logout()
              navigate('/admin/login', { replace: true })
            }}
          >
            <Icon name="logout" size={18} />
            <span>Sair</span>
          </button>
        </div>
      </aside>

      <div className="asidebar-scrim" onClick={() => setOpen(false)} aria-hidden="true" />

      <div className="admin__main">
        <button
          className="admin__burger icon-btn"
          onClick={() => setOpen(true)}
          aria-label="Abrir menu"
        >
          <Icon name="menu" size={20} />
        </button>
        <Outlet />
      </div>
    </div>
  )
}
