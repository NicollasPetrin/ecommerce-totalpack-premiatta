import { useEffect } from 'react'
import { Navigate, Outlet, Route, Routes, useLocation } from 'react-router-dom'

import Header from './components/Header'
import CategoryStrip from './components/CategoryStrip'
import Footer from './components/Footer'
import CartDrawer from './components/CartDrawer'
import Toaster from './components/Toaster'
import { useStore } from './store/StoreContext'

import Home from './pages/Home'
import Catalog from './pages/Catalog'
import Product from './pages/Product'
import Checkout from './pages/Checkout'
import OrderSuccess from './pages/OrderSuccess'
import Auth from './pages/Auth'
import Account from './pages/Account'
import NotFound from './pages/NotFound'

import AdminLayout from './pages/admin/AdminLayout'
import AdminLogin from './pages/admin/Login'
import Dashboard from './pages/admin/Dashboard'
import AdminProducts from './pages/admin/Products'
import AdminCategories from './pages/admin/Categories'
import AdminOrders from './pages/admin/Orders'
import AdminCustomers from './pages/admin/Customers'
import AdminShipping from './pages/admin/Shipping'
import AdminSettings from './pages/admin/Settings'

/** Rola para o topo a cada navegação. */
function ScrollToTop() {
  const { pathname, search } = useLocation()
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' })
  }, [pathname, search])
  return null
}

const TITLES = [
  [/^\/admin\/login$/, 'Entrar no painel'],
  [/^\/admin\/produtos$/, 'Produtos — Painel'],
  [/^\/admin\/categorias$/, 'Categorias — Painel'],
  [/^\/admin\/pedidos$/, 'Pedidos — Painel'],
  [/^\/admin\/clientes$/, 'Clientes — Painel'],
  [/^\/admin\/entrega$/, 'Entrega — Painel'],
  [/^\/admin\/configuracoes$/, 'Configurações — Painel'],
  [/^\/admin$/, 'Visão geral — Painel'],
  [/^\/catalogo/, 'Catálogo'],
  [/^\/produto\//, 'Produto'],
  [/^\/checkout$/, 'Finalizar pedido'],
  [/^\/entrar$/, 'Entrar'],
  [/^\/conta$/, 'Minha conta'],
  [/^\/pedido\//, 'Pedido confirmado'],
]

/** Mantém o título da aba coerente com a rota atual. */
function PageTitle() {
  const { pathname } = useLocation()
  const { settings } = useStore()

  useEffect(() => {
    const match = TITLES.find(([re]) => re.test(pathname))
    document.title = match
      ? `${match[1]} — ${settings.storeName}`
      : `${settings.storeName} — Material escolar`
  }, [pathname, settings.storeName])

  return null
}

/** Casca da loja: cabeçalho, conteúdo, rodapé e sacola. */
function StoreLayout() {
  return (
    <div className="shell">
      <Header />
      <CategoryStrip />
      <main className="shell__main">
        <Outlet />
      </main>
      <Footer />
      <CartDrawer />
    </div>
  )
}

/** Bloqueia rotas do painel para quem não fez login. */
function RequireAdmin() {
  const { isAdmin } = useStore()
  const location = useLocation()
  if (!isAdmin) return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />
  return <Outlet />
}

/**
 * Enquanto o catálogo e a sessão não chegam do servidor, nada pode renderizar:
 * as telas leem `settings`, que só existe depois da primeira resposta.
 */
function Boot({ children }) {
  const { ready, bootError } = useStore()

  if (bootError) {
    return (
      <div className="boot boot--error">
        <h1>Não foi possível carregar a loja</h1>
        <p>{bootError}</p>
        <p className="boot__hint">
          Verifique se a API está no ar em <code>http://localhost:3333</code> e se o
          PostgreSQL está rodando. Depois, recarregue a página.
        </p>
        <button className="btn btn--primary" onClick={() => window.location.reload()}>
          Tentar de novo
        </button>
      </div>
    )
  }

  if (!ready) {
    return (
      <div className="boot">
        <span className="boot__spinner" aria-hidden="true" />
        <p>Carregando a loja…</p>
      </div>
    )
  }

  return children
}

export default function App() {
  return (
    <Boot>
      <ScrollToTop />
      <PageTitle />
      <Routes>
        {/* Loja */}
        <Route element={<StoreLayout />}>
          <Route index element={<Home />} />
          <Route path="catalogo" element={<Catalog />} />
          <Route path="produto/:id" element={<Product />} />
          <Route path="checkout" element={<Checkout />} />
          <Route path="pedido/:id" element={<OrderSuccess />} />
          <Route path="entrar" element={<Auth />} />
          <Route path="conta" element={<Account />} />
        </Route>

        {/* Painel */}
        <Route path="/admin/login" element={<AdminLogin />} />
        <Route element={<RequireAdmin />}>
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<Dashboard />} />
            <Route path="produtos" element={<AdminProducts />} />
            <Route path="categorias" element={<AdminCategories />} />
            <Route path="pedidos" element={<AdminOrders />} />
            <Route path="clientes" element={<AdminCustomers />} />
            <Route path="entrega" element={<AdminShipping />} />
            <Route path="configuracoes" element={<AdminSettings />} />
          </Route>
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
      <Toaster />
    </Boot>
  )
}
