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

/**
 * Formas de pagamento.
 *
 * Nenhuma delas coleta dado de cartão no site. No cartão, o cliente recebe um
 * link de pagamento da processadora e paga por lá — o número do cartão nunca
 * passa por este servidor, que é o único jeito seguro de fazer isso sem
 * certificação PCI.
 */
export const PAYMENT_LABEL = {
  pix: 'PIX',
  cartao: 'Cartão de crédito',
  boleto: 'Boleto',
}

/* -------------------------------------------------------------------------- */
/* Carrinho — único estado que continua no navegador                           */
/* -------------------------------------------------------------------------- */

/**
 * Identidade da linha da sacola.
 *
 * O produto sozinho não serve mais: colorset azul e vermelho são o mesmo
 * produto e precisam ocupar linhas separadas, com quantidade e estoque
 * próprios. Produto sem variação continua com a parte de trás vazia, então
 * as sacolas salvas antes desta mudança seguem funcionando.
 */
export const chaveLinha = (productId, variantId) => `${productId}:${variantId ?? ''}`

function cartReducer(state, action) {
  switch (action.type) {
    case 'add': {
      const chave = chaveLinha(action.productId, action.variantId)
      const achou = state.some((l) => chaveLinha(l.productId, l.variantId) === chave)
      if (achou) {
        return state.map((l) =>
          chaveLinha(l.productId, l.variantId) === chave ? { ...l, qty: l.qty + action.qty } : l,
        )
      }
      return [
        ...state,
        { productId: action.productId, variantId: action.variantId ?? null, qty: action.qty },
      ]
    }
    case 'setQty':
      return state
        .map((l) =>
          chaveLinha(l.productId, l.variantId) === action.key ? { ...l, qty: action.qty } : l,
        )
        .filter((l) => l.qty > 0)
    case 'remove':
      return state.filter((l) => chaveLinha(l.productId, l.variantId) !== action.key)
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

          const variant = l.variantId
            ? (product.variants ?? []).find((v) => v.id === l.variantId)
            : null
          // A variação escolhida pode ter sido desativada ou excluída depois
          // que o item entrou na sacola. Nesse caso a linha some, como já
          // acontecia com produto fora do catálogo.
          if (l.variantId && (!variant || !variant.active)) return null

          // Quem manda no preço e no estoque é a variação, quando existe.
          const origem = variant ?? product
          const price = effectivePrice(origem)

          return {
            ...l,
            key: chaveLinha(l.productId, l.variantId),
            product,
            variant: variant ?? null,
            stock: origem.stock,
            price,
            lineTotal: price * l.qty,
          }
        })
        .filter(Boolean),
    [cart, productById],
  )

  const cartCount = useMemo(() => cartLines.reduce((s, l) => s + l.qty, 0), [cartLines])
  const subtotal = useMemo(() => cartLines.reduce((s, l) => s + l.lineTotal, 0), [cartLines])

  /* ---- Frete ----
     Dois modos, decididos pelo servidor. Sem transportadora integrada, o
     valor sai da tabela de faixas de CEP e vale o frete grátis. Com
     transportadora, o cliente escolhe entre as opções reais e paga o que ela
     cobrar — não há frete grátis nesse caso. */
  const [freteOpcoes, setFreteOpcoes] = useState(null)
  const [freteEscolhido, setFreteEscolhido] = useState(null)
  const [freteErro, setFreteErro] = useState('')
  const [freteCarregando, setFreteCarregando] = useState(false)
  const [freteIntegrado, setFreteIntegrado] = useState(false)

  /* Recotar a cada mudança de sacola ou CEP. A escolha anterior é descartada:
     manter um preço antigo depois de mexer nos itens cobraria errado. */
  useEffect(() => {
    const digitos = cep.replace(/\D/g, '')
    setFreteEscolhido(null)

    if (digitos.length !== 8 || cartLines.length === 0) {
      setFreteOpcoes(null)
      setFreteErro('')
      return
    }

    let cancelado = false
    setFreteCarregando(true)

    api
      .post('/shipping/options', {
        cep: digitos,
        items: cartLines.map((l) => ({ productId: l.product.id, qty: l.qty })),
      })
      .then((r) => {
        if (cancelado) return
        setFreteIntegrado(r.provider !== 'manual')
        if (r.provider === 'manual') {
          setFreteOpcoes(null)
          setFreteErro('')
          return
        }
        setFreteOpcoes(r.options ?? [])
        setFreteErro(r.erro ?? '')
        // Uma opção só não é escolha: já deixa marcada.
        if ((r.options ?? []).length === 1) setFreteEscolhido(r.options[0])
      })
      .catch((e) => {
        if (!cancelado) {
          setFreteOpcoes([])
          setFreteErro(e.message)
        }
      })
      .finally(() => {
        if (!cancelado) setFreteCarregando(false)
      })

    return () => {
      cancelado = true
    }
  }, [cep, cartLines])

  const freeShippingFrom = settings?.freeShippingFrom ?? 0
  const freeShipping = !freteIntegrado && subtotal >= freeShippingFrom && subtotal > 0

  const shipping = freteIntegrado
    ? (freteEscolhido?.preco ?? null)
    : subtotal === 0 || freeShipping
      ? 0
      : zone
        ? zone.fee
        : null

  const total = subtotal + (shipping ?? 0)

  /* Fora da área é a tabela dizendo que não atende; com transportadora, é a
     cotação não ter trazido nenhuma opção. */
  const semEntrega = freteIntegrado
    ? Boolean(freteErro) || (Array.isArray(freteOpcoes) && freteOpcoes.length === 0)
    : outOfRange

  const addToCart = useCallback(
    (product, qty = 1, variant = null) => {
      if (!product) return

      // Produto com variação exige escolha: sem ela não dá para saber qual
      // estoque baixar nem qual preço cobrar.
      const eixos = product.variantAxes ?? []
      if (eixos.length > 0 && (product.variants ?? []).length > 0 && !variant) {
        toast(`Escolha ${eixos.map((a) => a.name.toLowerCase()).join(' e ')}.`, 'err')
        return
      }

      const origem = variant ?? product
      const chave = chaveLinha(product.id, variant?.id)
      const naSacola = cart.find((l) => chaveLinha(l.productId, l.variantId) === chave)?.qty ?? 0

      if (naSacola + qty > origem.stock) {
        toast(
          origem.stock === 0 ? 'Produto sem estoque.' : `Só temos ${origem.stock} em estoque.`,
          'err',
        )
        return
      }

      dispatchCart({ type: 'add', productId: product.id, variantId: variant?.id ?? null, qty })
      toast(`${product.name}${variant ? ` (${variant.name})` : ''} adicionado à sacola.`)
    },
    [cart, toast],
  )

  /* Recebem a chave da linha, não o id do produto: o mesmo produto pode estar
     na sacola mais de uma vez, em variações diferentes. */
  const setQty = useCallback(
    (key, qty) => {
      const linha = cartLines.find((l) => l.key === key)
      if (linha && qty > linha.stock) {
        toast(`Estoque máximo: ${linha.stock}.`, 'err')
        dispatchCart({ type: 'setQty', key, qty: linha.stock })
        return
      }
      dispatchCart({ type: 'setQty', key, qty })
    },
    [cartLines, toast],
  )

  const removeFromCart = useCallback((key) => dispatchCart({ type: 'remove', key }), [])
  const clearCart = useCallback(() => dispatchCart({ type: 'clear' }), [])

  /* ------------------------------------------------------------------------ */
  /* Pedidos                                                                   */
  /* ------------------------------------------------------------------------ */

  const placeOrder = useCallback(
    async (form) => {
      const { order } = await api.post('/orders', {
        items: cartLines.map((l) => ({
          productId: l.product.id,
          variantId: l.variant?.id ?? null,
          qty: l.qty,
        })),
        name: form.name,
        email: form.email ?? '',
        phone: form.phone,
        cpfCnpj: form.cpfCnpj ?? '',
        delivery: form.delivery,
        payment: form.payment,
        shippingServiceId: freteEscolhido?.servicoId,
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

  /** Confere o pagamento na processadora — rede contra webhook perdido. */
  const syncOrderPayment = useCallback(async (orderId) => {
    const { order, resultado } = await api.post(`/orders/${orderId}/sync-payment`)
    setOrders((list) => list.map((o) => (o.id === orderId ? order : o)))
    return resultado
  }, [])

  /** Refaz a cobrança — boleto vencido, cartão recusado, processadora fora. */
  const rechargeOrder = useCallback(async (orderId) => {
    const { payment } = await api.post(`/orders/${orderId}/charge`)
    setOrders((list) =>
      list.map((o) => (o.id === orderId ? { ...o, charge: payment } : o)),
    )
    return payment
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
      // Medidas do pacote, para a transportadora cotar e emitir a etiqueta.
      weightG: data.weightG ?? 0,
      lengthCm: data.lengthCm ?? 0,
      widthCm: data.widthCm ?? 0,
      heightCm: data.heightCm ?? 0,
      // Grade de variação: eixos e as combinações geradas a partir deles.
      variantAxes: data.variantAxes ?? [],
      variants: data.variants ?? [],
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
      freteOpcoes,
      freteEscolhido,
      setFreteEscolhido,
      freteErro,
      freteCarregando,
      freteIntegrado,
      semEntrega,
      outOfRange,
      saveZone,
      deleteZone,
      toggleZone,
      // pedidos
      placeOrder,
      updateOrderStatus,
      deleteOrder,
      rechargeOrder,
      syncOrderPayment,
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
      placeOrder, updateOrderStatus, deleteOrder, rechargeOrder, syncOrderPayment,
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
