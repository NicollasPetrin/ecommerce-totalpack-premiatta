import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react'
import { api, ApiError } from '../lib/api'
import * as db from '../lib/storage'
import { effectivePrice, uid } from '../lib/format'
import { findZone } from '../lib/shipping'

const StoreContext = createContext(null)

export const ORDER_STATUS = {
  pendente: { label: 'Pendente', tone: 'orange' },
  pago: { label: 'Pago', tone: 'blue' },
  enviado: { label: 'Enviado', tone: 'teal' },
  entregue: { label: 'Entregue', tone: 'green' },
  cancelado: { label: 'Cancelado', tone: 'red' },
}

export const PAYMENT_LABEL = {
  pix: 'PIX',
  boleto: 'Boleto',
}

/* -------------------------------------------------------------------------- */
/* Carrinho — único estado que continua no navegador                           */
/* -------------------------------------------------------------------------- */

function cartReducer(state, action) {
  switch (action.type) {
    case 'add': {
      const found = state.find((l) => l.productId === action.productId)
      if (found) {
        return state.map((l) =>
          l.productId === action.productId ? { ...l, qty: l.qty + action.qty } : l,
        )
      }
      return [...state, { productId: action.productId, qty: action.qty }]
    }
    case 'setQty':
      return state
        .map((l) => (l.productId === action.productId ? { ...l, qty: action.qty } : l))
        .filter((l) => l.qty > 0)
    case 'remove':
      return state.filter((l) => l.productId !== action.productId)
    case 'clear':
      return []
    default:
      return state
  }
}

/* -------------------------------------------------------------------------- */
/* Provider                                                                    */
/* -------------------------------------------------------------------------- */

export function StoreProvider({ children }) {
  /* ---- Dados vindos do servidor ---- */
  const [products, setProducts] = useState([])
  const [categories, setCategories] = useState([])
  const [zones, setZones] = useState([])
  const [settings, setSettings] = useState(null)

  const [currentCustomer, setCurrentCustomer] = useState(null)
  const [customerOrders, setCustomerOrders] = useState([])

  const [isAdmin, setIsAdmin] = useState(false)
  const [orders, setOrders] = useState([])
  const [customers, setCustomers] = useState([])

  const [ready, setReady] = useState(false)
  const [bootError, setBootError] = useState(null)

  /* ---- Estado local ---- */
  const [cart, dispatchCart] = useReducer(cartReducer, [], () =>
    db.read(db.KEYS.cart, []) ?? [],
  )
  const [cep, setCep] = useState(() => db.read(db.KEYS.cep, ''))
  const [cartOpen, setCartOpen] = useState(false)
  const [toasts, setToasts] = useState([])
  const [theme, setTheme] = useState(() => db.read(db.KEYS.theme, 'system'))

  useEffect(() => void db.write(db.KEYS.cart, cart), [cart])
  useEffect(() => void db.write(db.KEYS.cep, cep), [cep])

  useEffect(() => {
    db.write(db.KEYS.theme, theme)
    const root = document.documentElement
    if (theme === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', theme)
  }, [theme])

  /* ---- Notificações ---- */
  const timers = useRef(new Map())

  const toast = useCallback((message, kind = 'ok') => {
    const id = uid('t')
    setToasts((t) => [...t, { id, message, kind }])
    const timeout = setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id))
      timers.current.delete(id)
    }, 3600)
    timers.current.set(id, timeout)
  }, [])

  useEffect(() => {
    const map = timers.current
    return () => map.forEach(clearTimeout)
  }, [])

  /* ------------------------------------------------------------------------ */
  /* Carga inicial                                                             */
  /* ------------------------------------------------------------------------ */

  const loadPublic = useCallback(async () => {
    const [cat, prod, zon, cfg] = await Promise.all([
      api.get('/categories'),
      api.get('/products'),
      api.get('/shipping/zones'),
      api.get('/settings'),
    ])
    setCategories(cat.categories)
    setProducts(prod.products)
    setZones(zon.zones)
    setSettings(cfg.settings)
  }, [])

  const loadAdmin = useCallback(async () => {
    const [ord, cus, prod, zon] = await Promise.all([
      api.get('/orders'),
      api.get('/admin/customers'),
      // Como admin, a listagem inclui produtos e zonas desativados.
      api.get('/products'),
      api.get('/shipping/zones'),
    ])
    setOrders(ord.orders)
    setCustomers(cus.customers)
    setProducts(prod.products)
    setZones(zon.zones)
  }, [])

  const loadCustomerOrders = useCallback(async () => {
    const { orders: mine } = await api.get('/orders/mine')
    setCustomerOrders(mine)
  }, [])

  useEffect(() => {
    let cancelled = false

    ;(async () => {
      try {
        await loadPublic()

        const [{ customer }, { admin }] = await Promise.all([
          api.get('/auth/me'),
          api.get('/admin/me'),
        ])
        if (cancelled) return

        setCurrentCustomer(customer)
        setIsAdmin(Boolean(admin))

        if (customer) await loadCustomerOrders()
        if (admin) await loadAdmin()
      } catch (err) {
        if (!cancelled) setBootError(err.message)
      } finally {
        if (!cancelled) setReady(true)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [loadPublic, loadAdmin, loadCustomerOrders])

  /* ------------------------------------------------------------------------ */
  /* Frete                                                                     */
  /*                                                                           */
  /* A busca da zona acontece aqui só para mostrar preço e prazo enquanto o    */
  /* cliente digita. O valor cobrado é sempre o que o servidor calcula ao      */
  /* criar o pedido — o que o navegador enviar é descartado.                   */
  /* ------------------------------------------------------------------------ */

  const zone = useMemo(() => findZone(cep, zones), [cep, zones])
  const outOfRange = cep.replace(/\D/g, '').length === 8 && !zone

  /* ---- Índices ---- */
  const productById = useMemo(
    () => Object.fromEntries(products.map((p) => [p.id, p])),
    [products],
  )
  const categoryById = useMemo(
    () => Object.fromEntries(categories.map((c) => [c.id, c])),
    [categories],
  )

  /* ---- Carrinho ---- */
  const cartLines = useMemo(
    () =>
      cart
        .map((l) => {
          const product = productById[l.productId]
          if (!product || !product.active) return null
          const price = effectivePrice(product)
          return { ...l, product, price, lineTotal: price * l.qty }
        })
        .filter(Boolean),
    [cart, productById],
  )

  const cartCount = useMemo(() => cartLines.reduce((s, l) => s + l.qty, 0), [cartLines])
  const subtotal = useMemo(() => cartLines.reduce((s, l) => s + l.lineTotal, 0), [cartLines])

  const freeShippingFrom = settings?.freeShippingFrom ?? 0
  const freeShipping = subtotal >= freeShippingFrom && subtotal > 0
  const shipping = subtotal === 0 || freeShipping ? 0 : zone ? zone.fee : null
  const total = subtotal + (shipping ?? 0)

  const addToCart = useCallback(
    (product, qty = 1) => {
      if (!product) return
      const inCart = cart.find((l) => l.productId === product.id)?.qty ?? 0
      if (inCart + qty > product.stock) {
        toast(
          product.stock === 0 ? 'Produto sem estoque.' : `Só temos ${product.stock} em estoque.`,
          'err',
        )
        return
      }
      dispatchCart({ type: 'add', productId: product.id, qty })
      toast(`${product.name} adicionado à sacola.`)
    },
    [cart, toast],
  )

  const setQty = useCallback(
    (productId, qty) => {
      const product = productById[productId]
      if (product && qty > product.stock) {
        toast(`Estoque máximo: ${product.stock}.`, 'err')
        dispatchCart({ type: 'setQty', productId, qty: product.stock })
        return
      }
      dispatchCart({ type: 'setQty', productId, qty })
    },
    [productById, toast],
  )

  const removeFromCart = useCallback((productId) => dispatchCart({ type: 'remove', productId }), [])
  const clearCart = useCallback(() => dispatchCart({ type: 'clear' }), [])

  /* ------------------------------------------------------------------------ */
  /* Pedidos                                                                   */
  /* ------------------------------------------------------------------------ */

  const placeOrder = useCallback(
    async (form) => {
      const { order } = await api.post('/orders', {
        items: cartLines.map((l) => ({ productId: l.product.id, qty: l.qty })),
        name: form.name,
        email: form.email ?? '',
        phone: form.phone,
        delivery: form.delivery,
        payment: form.payment,
        note: form.note ?? '',
        cep: form.cep ?? '',
        street: form.address ?? '',
        number: form.number ?? '',
        complement: form.complement ?? '',
        district: form.district ?? '',
        city: form.city ?? '',
        state: form.state ?? '',
        saveAddress: Boolean(form.saveAddress),
        addressLabel: form.addressLabel ?? '',
      })

      clearCart()
      // O estoque mudou no servidor; recarrega para a loja não vender de novo
      // o que acabou de sair.
      await loadPublic()
      if (currentCustomer) await loadCustomerOrders()
      if (isAdmin) await loadAdmin()

      return order
    },
    [cartLines, clearCart, loadPublic, loadCustomerOrders, loadAdmin, currentCustomer, isAdmin],
  )

  const updateOrderStatus = useCallback(async (orderId, status) => {
    const { order } = await api.put(`/orders/${orderId}/status`, { status })
    setOrders((list) => list.map((o) => (o.id === orderId ? order : o)))
  }, [])

  const deleteOrder = useCallback(async (orderId) => {
    await api.del(`/orders/${orderId}`)
    setOrders((list) => list.filter((o) => o.id !== orderId))
  }, [])

  /* ------------------------------------------------------------------------ */
  /* Catálogo (admin)                                                          */
  /* ------------------------------------------------------------------------ */

  const saveProduct = useCallback(async (data) => {
    const body = {
      name: data.name,
      categoryId: data.categoryId || null,
      sku: data.sku ?? '',
      description: data.description ?? '',
      price: data.price,
      promo: data.promo ?? 0,
      stock: data.stock,
      unit: data.unit ?? 'unidade',
      art: data.art ?? 'sheet',
      tint: data.tint ?? '#0e8fa2',
      image: data.image || null,
      specs: data.specs ?? [],
      featured: Boolean(data.featured),
      active: Boolean(data.active),
    }

    const { product } = data.id
      ? await api.put(`/products/${data.id}`, body)
      : await api.post('/products', body)

    setProducts((list) =>
      list.some((p) => p.id === product.id)
        ? list.map((p) => (p.id === product.id ? product : p))
        : [product, ...list],
    )
  }, [])

  const deleteProduct = useCallback(async (id) => {
    await api.del(`/products/${id}`)
    setProducts((list) => list.filter((p) => p.id !== id))
  }, [])

  const toggleProduct = useCallback(async (id) => {
    const { product } = await api.put(`/products/${id}/active`)
    setProducts((list) => list.map((p) => (p.id === id ? product : p)))
  }, [])

  const saveCategory = useCallback(async (data) => {
    const body = {
      name: data.name,
      slug: data.slug,
      description: data.description ?? '',
      position: data.order ?? 99,
    }
    const { category } = data.id
      ? await api.put(`/categories/${data.id}`, body)
      : await api.post('/categories', body)

    setCategories((list) =>
      list.some((c) => c.id === category.id)
        ? list.map((c) => (c.id === category.id ? category : c))
        : [...list, category],
    )
  }, [])

  const deleteCategory = useCallback(async (id) => {
    await api.del(`/categories/${id}`)
    setCategories((list) => list.filter((c) => c.id !== id))
    // Os produtos daquela categoria ficaram sem categoria.
    await loadPublic()
  }, [loadPublic])

  /* ---- Zonas de entrega ---- */

  const saveZone = useCallback(async (data) => {
    const body = {
      name: data.name,
      cepStart: data.cepStart,
      cepEnd: data.cepEnd,
      fee: data.fee,
      days: data.days,
      active: data.active !== false,
    }
    const { zone: saved } = data.id
      ? await api.put(`/shipping/zones/${data.id}`, body)
      : await api.post('/shipping/zones', body)

    setZones((list) => {
      const next = list.some((z) => z.id === saved.id)
        ? list.map((z) => (z.id === saved.id ? saved : z))
        : [...list, saved]
      return next.sort((a, b) => Number(a.cepStart) - Number(b.cepStart))
    })
  }, [])

  const deleteZone = useCallback(async (id) => {
    await api.del(`/shipping/zones/${id}`)
    setZones((list) => list.filter((z) => z.id !== id))
  }, [])

  const toggleZone = useCallback(async (id) => {
    const { zone: saved } = await api.put(`/shipping/zones/${id}/active`)
    setZones((list) => list.map((z) => (z.id === id ? saved : z)))
  }, [])

  const saveSettings = useCallback(async (data) => {
    const { settings: saved } = await api.put('/settings', data)
    setSettings(saved)
  }, [])

  /* ------------------------------------------------------------------------ */
  /* Contas de clientes                                                        */
  /* ------------------------------------------------------------------------ */

  const signup = useCallback(
    async (data) => {
      try {
        const { customer } = await api.post('/auth/signup', data)
        setCurrentCustomer(customer)
        await loadCustomerOrders()
        return { ok: true, account: customer }
      } catch (err) {
        return { ok: false, error: err.message, details: err.details }
      }
    },
    [loadCustomerOrders],
  )

  const loginCustomer = useCallback(
    async (email, password) => {
      try {
        const { customer } = await api.post('/auth/login', { email, password })
        setCurrentCustomer(customer)
        await loadCustomerOrders()
        return { ok: true, account: customer }
      } catch (err) {
        return { ok: false, error: err.message, details: err.details }
      }
    },
    [loadCustomerOrders],
  )

  const logoutCustomer = useCallback(async () => {
    await api.post('/auth/logout')
    setCurrentCustomer(null)
    setCustomerOrders([])
  }, [])

  const updateCustomer = useCallback(async (data) => {
    const { customer } = await api.put('/auth/me', data)
    setCurrentCustomer(customer)
  }, [])

  const changeCustomerPassword = useCallback(async (current, next) => {
    try {
      await api.put('/auth/me/password', { current, next })
      return true
    } catch {
      return false
    }
  }, [])

  const refreshCustomer = useCallback(async () => {
    const { customer } = await api.get('/auth/me')
    setCurrentCustomer(customer)
  }, [])

  const saveAddress = useCallback(
    async (addr) => {
      const body = {
        label: addr.label || 'Endereço',
        cep: addr.cep,
        street: addr.address,
        number: addr.number,
        complement: addr.complement ?? '',
        district: addr.district,
        city: addr.city,
        state: addr.state,
        isDefault: Boolean(addr.isDefault),
      }
      if (addr.id) await api.put(`/auth/me/addresses/${addr.id}`, body)
      else await api.post('/auth/me/addresses', body)
      await refreshCustomer()
    },
    [refreshCustomer],
  )

  const deleteAddress = useCallback(
    async (addressId) => {
      await api.del(`/auth/me/addresses/${addressId}`)
      await refreshCustomer()
    },
    [refreshCustomer],
  )

  const setDefaultAddress = useCallback(
    async (addressId) => {
      await api.put(`/auth/me/addresses/${addressId}/default`)
      await refreshCustomer()
    },
    [refreshCustomer],
  )

  const defaultAddress = useMemo(() => {
    const list = currentCustomer?.addresses ?? []
    return list.find((a) => a.isDefault) ?? list[0] ?? null
  }, [currentCustomer])

  /* ------------------------------------------------------------------------ */
  /* Acesso administrativo                                                     */
  /* ------------------------------------------------------------------------ */

  const login = useCallback(
    async (email, password) => {
      try {
        await api.post('/admin/login', { email, password })
        setIsAdmin(true)
        await loadAdmin()
        return { ok: true }
      } catch (err) {
        return { ok: false, error: err.message }
      }
    },
    [loadAdmin],
  )

  const logout = useCallback(async () => {
    await api.post('/admin/logout')
    setIsAdmin(false)
    setOrders([])
    setCustomers([])
    await loadPublic()
  }, [loadPublic])

  const changePassword = useCallback(async (current, next) => {
    try {
      await api.put('/admin/password', { current, next })
      return true
    } catch {
      return false
    }
  }, [])

  const value = useMemo(
    () => ({
      ready,
      bootError,
      // dados
      products,
      categories,
      orders,
      customers,
      settings,
      zones,
      productById,
      categoryById,
      // contas
      currentCustomer,
      customerOrders,
      defaultAddress,
      signup,
      loginCustomer,
      logoutCustomer,
      updateCustomer,
      changeCustomerPassword,
      saveAddress,
      deleteAddress,
      setDefaultAddress,
      // carrinho
      cart,
      cartLines,
      cartCount,
      subtotal,
      shipping,
      total,
      freeShipping,
      addToCart,
      setQty,
      removeFromCart,
      clearCart,
      cartOpen,
      setCartOpen,
      // frete
      cep,
      setCep,
      zone,
      outOfRange,
      saveZone,
      deleteZone,
      toggleZone,
      // pedidos
      placeOrder,
      updateOrderStatus,
      deleteOrder,
      // admin
      isAdmin,
      login,
      logout,
      changePassword,
      saveProduct,
      deleteProduct,
      toggleProduct,
      saveCategory,
      deleteCategory,
      saveSettings,
      reload: loadPublic,
      // ui
      toast,
      toasts,
      theme,
      setTheme,
    }),
    [
      ready, bootError, products, categories, orders, customers, settings, zones,
      productById, categoryById, currentCustomer, customerOrders, defaultAddress,
      signup, loginCustomer, logoutCustomer, updateCustomer, changeCustomerPassword,
      saveAddress, deleteAddress, setDefaultAddress,
      cart, cartLines, cartCount, subtotal, shipping, total, freeShipping,
      addToCart, setQty, removeFromCart, clearCart, cartOpen,
      cep, zone, outOfRange, saveZone, deleteZone, toggleZone,
      placeOrder, updateOrderStatus, deleteOrder,
      isAdmin, login, logout, changePassword, saveProduct, deleteProduct,
      toggleProduct, saveCategory, deleteCategory, saveSettings, loadPublic,
      toast, toasts, theme,
    ],
  )

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore() {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore precisa estar dentro de <StoreProvider>.')
  return ctx
}

export { ApiError }
