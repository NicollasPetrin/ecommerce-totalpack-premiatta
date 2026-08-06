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
import { CATEGORIES, CUSTOMERS, PRODUCTS, SETTINGS, makeDemoOrders } from '../data/seed'
import * as db from '../lib/storage'
import { effectivePrice, uid } from '../lib/format'
import { findZone } from '../lib/shipping'

const StoreContext = createContext(null)

export const ORDER_STATUS = {
  pendente: { label: 'Pendente', tone: 'orange' },
  pago: { label: 'Pago', tone: 'blue' },
  enviado: { label: 'Enviado', tone: 'purple' },
  entregue: { label: 'Entregue', tone: 'green' },
  cancelado: { label: 'Cancelado', tone: 'red' },
}

/**
 * Formas de pagamento aceitas.
 *
 * Pagamento na entrega (maquininha e dinheiro) foi retirado até haver uma
 * processadora. As duas opções restantes são pagas antes do envio, fora do
 * site: nenhum dado de cartão passa por aqui.
 */
export const PAYMENT_LABEL = {
  pix: 'PIX',
  boleto: 'Boleto',
}

/* -------------------------------------------------------------------------- */
/* Carrinho                                                                    */
/* -------------------------------------------------------------------------- */

function cartReducer(state, action) {
  switch (action.type) {
    case 'add': {
      const { productId, qty } = action
      const found = state.find((l) => l.productId === productId)
      if (found) {
        return state.map((l) =>
          l.productId === productId ? { ...l, qty: l.qty + qty } : l,
        )
      }
      return [...state, { productId, qty }]
    }
    case 'setQty':
      return state
        .map((l) => (l.productId === action.productId ? { ...l, qty: action.qty } : l))
        .filter((l) => l.qty > 0)
    case 'remove':
      return state.filter((l) => l.productId !== action.productId)
    case 'clear':
      return []
    case 'replace':
      return action.value
    default:
      return state
  }
}

/* -------------------------------------------------------------------------- */
/* Provider                                                                    */
/* -------------------------------------------------------------------------- */

export function StoreProvider({ children }) {
  const [products, setProducts] = useState(() => db.read(db.KEYS.products, null) ?? PRODUCTS)
  const [categories, setCategories] = useState(
    () => db.read(db.KEYS.categories, null) ?? CATEGORIES,
  )
  const [orders, setOrders] = useState(() => db.read(db.KEYS.orders, null) ?? makeDemoOrders())
  const [settings, setSettings] = useState(() => ({
    ...SETTINGS,
    ...db.read(db.KEYS.settings, {}),
  }))
  const [cart, dispatchCart] = useReducer(
    cartReducer,
    null,
    () => db.read(db.KEYS.cart, []) ?? [],
  )

  // CEP informado pelo cliente: guia todo o cálculo de frete.
  const [cep, setCep] = useState(() => db.read(db.KEYS.cep, ''))

  // Contas de clientes e quem está com sessão aberta neste navegador.
  const [customers, setCustomers] = useState(
    () => db.read(db.KEYS.customers, null) ?? CUSTOMERS,
  )
  const [customerId, setCustomerId] = useState(() =>
    db.read(db.KEYS.customerSession, null),
  )

  const [isAdmin, setIsAdmin] = useState(() => db.read(db.KEYS.session, false) === true)
  const [cartOpen, setCartOpen] = useState(false)
  const [toasts, setToasts] = useState([])
  const [theme, setTheme] = useState(() => db.read(db.KEYS.theme, 'system'))

  /* ---- Persistência ---- */
  useEffect(() => void db.write(db.KEYS.products, products), [products])
  useEffect(() => void db.write(db.KEYS.categories, categories), [categories])
  useEffect(() => void db.write(db.KEYS.orders, orders), [orders])
  useEffect(() => void db.write(db.KEYS.settings, settings), [settings])
  useEffect(() => void db.write(db.KEYS.cart, cart), [cart])
  useEffect(() => void db.write(db.KEYS.session, isAdmin), [isAdmin])
  useEffect(() => void db.write(db.KEYS.cep, cep), [cep])
  useEffect(() => void db.write(db.KEYS.customers, customers), [customers])
  useEffect(() => void db.write(db.KEYS.customerSession, customerId), [customerId])

  /* ---- Tema ---- */
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
    }, 3200)
    timers.current.set(id, timeout)
  }, [])

  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  /* ---- Índices auxiliares ---- */
  const productById = useMemo(
    () => Object.fromEntries(products.map((p) => [p.id, p])),
    [products],
  )
  const categoryById = useMemo(
    () => Object.fromEntries(categories.map((c) => [c.id, c])),
    [categories],
  )

  /* ---- Linhas do carrinho já resolvidas ---- */
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
  const subtotal = useMemo(
    () => cartLines.reduce((s, l) => s + l.lineTotal, 0),
    [cartLines],
  )
  /* ---- Frete ---- */

  const zones = settings.shippingZones ?? []
  const zone = useMemo(() => findZone(cep, zones), [cep, zones])

  const freeShipping = subtotal >= settings.freeShippingFrom && subtotal > 0

  /** CEP completo, mas fora de todas as zonas cadastradas. */
  const outOfRange = cep.replace(/\D/g, '').length === 8 && !zone

  /**
   * `null` significa "ainda não dá para saber" — sem CEP ou fora de área.
   * As telas mostram "A calcular" em vez de fingir um valor.
   */
  const shipping =
    subtotal === 0 || freeShipping ? 0 : zone ? zone.fee : null

  const total = subtotal + (shipping ?? 0)

  /* ------------------------------------------------------------------------ */
  /* Contas de clientes                                                        */
  /*                                                                           */
  /* Autenticação conferida no próprio navegador, como no acesso do painel.    */
  /* Serve para a loja funcionar sem servidor; não protege nada de verdade.    */
  /* ------------------------------------------------------------------------ */

  const currentCustomer = useMemo(
    () => customers.find((c) => c.id === customerId) ?? null,
    [customers, customerId],
  )

  /** Pedidos da conta aberta, do mais recente para o mais antigo. */
  const customerOrders = useMemo(() => {
    if (!currentCustomer) return []
    return orders
      .filter((o) => o.customerId === currentCustomer.id)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
  }, [orders, currentCustomer])

  const defaultAddress = useMemo(() => {
    const list = currentCustomer?.addresses ?? []
    return list.find((a) => a.isDefault) ?? list[0] ?? null
  }, [currentCustomer])

  const findByEmail = useCallback(
    (email) =>
      customers.find(
        (c) => c.email.trim().toLowerCase() === String(email).trim().toLowerCase(),
      ) ?? null,
    [customers],
  )

  const signup = useCallback(
    ({ name, email, phone, password }) => {
      if (findByEmail(email)) {
        return { ok: false, error: 'Já existe uma conta com este e-mail.' }
      }
      const account = {
        id: uid('cus'),
        name: name.trim(),
        email: email.trim().toLowerCase(),
        phone: phone.trim(),
        passHash: db.hash(password),
        createdAt: new Date().toISOString(),
        addresses: [],
      }
      setCustomers((list) => [...list, account])
      setCustomerId(account.id)
      return { ok: true, account }
    },
    [findByEmail],
  )

  const loginCustomer = useCallback(
    (email, password) => {
      const account = findByEmail(email)
      if (!account) return { ok: false, error: 'Não encontramos uma conta com este e-mail.' }

      const expected = account.passHash ?? db.hash('cliente123')
      if (db.hash(password) !== expected) {
        return { ok: false, error: 'Senha incorreta.' }
      }
      setCustomerId(account.id)
      return { ok: true, account }
    },
    [findByEmail],
  )

  const logoutCustomer = useCallback(() => setCustomerId(null), [])

  const updateCustomer = useCallback(
    (data) => {
      if (!customerId) return
      setCustomers((list) =>
        list.map((c) => (c.id === customerId ? { ...c, ...data } : c)),
      )
    },
    [customerId],
  )

  const changeCustomerPassword = useCallback(
    (current, next) => {
      if (!currentCustomer) return false
      const expected = currentCustomer.passHash ?? db.hash('cliente123')
      if (db.hash(current) !== expected) return false
      updateCustomer({ passHash: db.hash(next) })
      return true
    },
    [currentCustomer, updateCustomer],
  )

  /** Cria ou atualiza um endereço da conta aberta. */
  const saveAddress = useCallback(
    (addr) => {
      if (!customerId) return null
      const id = addr.id || uid('addr')

      setCustomers((list) =>
        list.map((c) => {
          if (c.id !== customerId) return c
          const existing = c.addresses ?? []
          const isFirst = existing.length === 0
          const next = { ...addr, id, isDefault: addr.isDefault || isFirst }

          const merged = existing.some((a) => a.id === id)
            ? existing.map((a) => (a.id === id ? next : a))
            : [...existing, next]

          // Só um endereço pode ser o padrão.
          return {
            ...c,
            addresses: next.isDefault
              ? merged.map((a) => ({ ...a, isDefault: a.id === id }))
              : merged,
          }
        }),
      )
      return id
    },
    [customerId],
  )

  const deleteAddress = useCallback(
    (addressId) => {
      if (!customerId) return
      setCustomers((list) =>
        list.map((c) => {
          if (c.id !== customerId) return c
          const rest = (c.addresses ?? []).filter((a) => a.id !== addressId)
          // Se o padrão saiu, o primeiro que sobrar assume.
          if (rest.length && !rest.some((a) => a.isDefault)) rest[0].isDefault = true
          return { ...c, addresses: rest }
        }),
      )
    },
    [customerId],
  )

  const setDefaultAddress = useCallback(
    (addressId) => {
      if (!customerId) return
      setCustomers((list) =>
        list.map((c) =>
          c.id === customerId
            ? {
                ...c,
                addresses: (c.addresses ?? []).map((a) => ({
                  ...a,
                  isDefault: a.id === addressId,
                })),
              }
            : c,
        ),
      )
    },
    [customerId],
  )

  /* ---- Ações do carrinho ---- */
  const addToCart = useCallback(
    (product, qty = 1) => {
      if (!product) return
      const inCart = cart.find((l) => l.productId === product.id)?.qty ?? 0
      if (inCart + qty > product.stock) {
        toast(
          product.stock === 0
            ? 'Produto sem estoque.'
            : `Só temos ${product.stock} em estoque.`,
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

  const removeFromCart = useCallback(
    (productId) => dispatchCart({ type: 'remove', productId }),
    [],
  )
  const clearCart = useCallback(() => dispatchCart({ type: 'clear' }), [])

  /* ---- Pedidos ---- */
  const placeOrder = useCallback(
    (form) => {
      if (cartLines.length === 0) throw new Error('Sacola vazia.')

      const seq = settings.orderSeq ?? 1
      const now = new Date().toISOString()
      const isPickup = form.delivery === 'retirada'

      // O frete vem do CEP do formulário, não do que estiver na tela: é ele
      // que define para onde o pedido realmente vai.
      const orderZone = isPickup ? null : findZone(form.cep, zones)
      if (!isPickup && !orderZone) {
        throw new Error('Ainda não entregamos neste CEP. Escolha retirada na loja ou fale conosco.')
      }

      const ship = isPickup || freeShipping ? 0 : orderZone.fee

      const order = {
        id: uid('ord'),
        seq,
        createdAt: now,
        updatedAt: now,
        status: 'pendente',
        // Vazio quando a compra é feita sem cadastro — o que segue permitido.
        customerId: currentCustomer?.id ?? null,
        customer: {
          name: form.name,
          phone: form.phone,
          email: form.email,
          cep: form.cep,
          address: form.address,
          number: form.number,
          complement: form.complement,
          district: form.district,
          city: form.city,
          state: form.state,
        },
        delivery: form.delivery,
        deliveryZone: orderZone?.name ?? '',
        deliveryDays: orderZone?.days ?? 0,
        payment: form.payment,
        note: form.note ?? '',
        items: cartLines.map((l) => ({
          productId: l.product.id,
          name: l.product.name,
          sku: l.product.sku,
          price: l.price,
          qty: l.qty,
          art: l.product.art,
          tint: l.product.tint,
        })),
        subtotal,
        shipping: ship,
        total: subtotal + ship,
      }

      setOrders((o) => [order, ...o])
      setSettings((s) => ({ ...s, orderSeq: seq + 1 }))

      // Baixa de estoque
      setProducts((list) =>
        list.map((p) => {
          const line = cartLines.find((l) => l.product.id === p.id)
          return line ? { ...p, stock: Math.max(0, p.stock - line.qty) } : p
        }),
      )

      // Guarda o endereço na conta quando o cliente pede.
      if (currentCustomer && form.saveAddress && !isPickup) {
        saveAddress({
          id: form.addressId || '',
          label: form.addressLabel?.trim() || 'Endereço',
          cep: form.cep,
          address: form.address,
          number: form.number,
          complement: form.complement,
          district: form.district,
          city: form.city,
          state: form.state,
          isDefault: false,
        })
      }

      clearCart()
      return order
    },
    [
      cartLines, subtotal, freeShipping, zones, settings.orderSeq, clearCart,
      currentCustomer, saveAddress,
    ],
  )

  const updateOrderStatus = useCallback((orderId, status) => {
    setOrders((list) =>
      list.map((o) =>
        o.id === orderId ? { ...o, status, updatedAt: new Date().toISOString() } : o,
      ),
    )
  }, [])

  const deleteOrder = useCallback(
    (orderId) => setOrders((list) => list.filter((o) => o.id !== orderId)),
    [],
  )

  /* ---- Produtos (admin) ---- */
  const saveProduct = useCallback((data) => {
    setProducts((list) => {
      if (data.id && list.some((p) => p.id === data.id)) {
        return list.map((p) => (p.id === data.id ? { ...p, ...data } : p))
      }
      return [{ ...data, id: data.id || uid('p') }, ...list]
    })
  }, [])

  const deleteProduct = useCallback(
    (id) => setProducts((list) => list.filter((p) => p.id !== id)),
    [],
  )

  const toggleProduct = useCallback(
    (id) =>
      setProducts((list) =>
        list.map((p) => (p.id === id ? { ...p, active: !p.active } : p)),
      ),
    [],
  )

  /* ---- Categorias (admin) ---- */
  const saveCategory = useCallback((data) => {
    setCategories((list) => {
      if (data.id && list.some((c) => c.id === data.id)) {
        return list.map((c) => (c.id === data.id ? { ...c, ...data } : c))
      }
      return [...list, { ...data, id: data.id || uid('cat') }]
    })
  }, [])

  const deleteCategory = useCallback((id) => {
    setCategories((list) => list.filter((c) => c.id !== id))
  }, [])

  /* ---- Zonas de entrega (admin) ---- */
  const saveZone = useCallback((data) => {
    setSettings((s) => {
      const list = s.shippingZones ?? []
      const next = list.some((z) => z.id === data.id)
        ? list.map((z) => (z.id === data.id ? { ...z, ...data } : z))
        : [...list, { ...data, id: data.id || uid('z') }]
      // Ordenar pelo início da faixa mantém a tabela legível no painel.
      next.sort((a, b) => Number(a.cepStart) - Number(b.cepStart))
      return { ...s, shippingZones: next }
    })
  }, [])

  const deleteZone = useCallback((id) => {
    setSettings((s) => ({
      ...s,
      shippingZones: (s.shippingZones ?? []).filter((z) => z.id !== id),
    }))
  }, [])

  const toggleZone = useCallback((id) => {
    setSettings((s) => ({
      ...s,
      shippingZones: (s.shippingZones ?? []).map((z) =>
        z.id === id ? { ...z, active: !z.active } : z,
      ),
    }))
  }, [])

  /* ---- Autenticação do painel ---- */
  const login = useCallback(
    (password) => {
      const expected = settings.adminPassHash ?? db.hash('admin123')
      if (db.hash(password) === expected) {
        setIsAdmin(true)
        return true
      }
      return false
    },
    [settings.adminPassHash],
  )

  const logout = useCallback(() => setIsAdmin(false), [])

  const changePassword = useCallback(
    (current, next) => {
      const expected = settings.adminPassHash ?? db.hash('admin123')
      if (db.hash(current) !== expected) return false
      setSettings((s) => ({ ...s, adminPassHash: db.hash(next) }))
      return true
    },
    [settings.adminPassHash],
  )

  /* ---- Manutenção ---- */
  const resetCatalog = useCallback(() => {
    setProducts(PRODUCTS)
    setCategories(CATEGORIES)
    setOrders(makeDemoOrders())
    setCustomers(CUSTOMERS)
    setCustomerId(null)
    setSettings({ ...SETTINGS, adminPassHash: settings.adminPassHash })
    clearCart()
  }, [settings.adminPassHash, clearCart])

  const importBackup = useCallback((data) => {
    db.importAll(data)
    if (Array.isArray(data.products)) setProducts(data.products)
    if (Array.isArray(data.categories)) setCategories(data.categories)
    if (Array.isArray(data.orders)) setOrders(data.orders)
    if (Array.isArray(data.customers)) setCustomers(data.customers)
    if (data.settings) setSettings((s) => ({ ...s, ...data.settings }))
  }, [])

  const value = useMemo(
    () => ({
      // dados
      products,
      categories,
      orders,
      settings,
      productById,
      categoryById,
      // contas
      customers,
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
      // frete
      cep,
      setCep,
      zone,
      outOfRange,
      saveZone,
      deleteZone,
      toggleZone,
      addToCart,
      setQty,
      removeFromCart,
      clearCart,
      cartOpen,
      setCartOpen,
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
      setSettings,
      resetCatalog,
      importBackup,
      // ui
      toast,
      toasts,
      theme,
      setTheme,
    }),
    [
      products, categories, orders, settings, productById, categoryById,
      customers, currentCustomer, customerOrders, defaultAddress,
      signup, loginCustomer, logoutCustomer, updateCustomer,
      changeCustomerPassword, saveAddress, deleteAddress, setDefaultAddress,
      cart, cartLines, cartCount, subtotal, shipping, total, freeShipping,
      cep, zone, outOfRange, saveZone, deleteZone, toggleZone,
      addToCart, setQty, removeFromCart, clearCart, cartOpen,
      placeOrder, updateOrderStatus, deleteOrder,
      isAdmin, login, logout, changePassword,
      saveProduct, deleteProduct, toggleProduct, saveCategory, deleteCategory,
      resetCatalog, importBackup, toast, toasts, theme,
    ],
  )

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>
}

export function useStore() {
  const ctx = useContext(StoreContext)
  if (!ctx) throw new Error('useStore precisa estar dentro de <StoreProvider>.')
  return ctx
}
