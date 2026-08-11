/**
 * Tradução entre o banco (snake_case) e o front (camelCase).
 *
 * O formato de saída é exatamente o que as telas já consumiam quando os dados
 * vinham do localStorage — foi assim que a migração para a API não obrigou a
 * reescrever componente nenhum.
 */

export const category = (r) => ({
  id: r.id,
  name: r.name,
  slug: r.slug,
  description: r.description,
  order: r.position,
})

export const variant = (r) => ({
  id: r.id,
  name: r.name,
  sku: r.sku,
  price: Number(r.price),
  promo: Number(r.promo),
  stock: r.stock,
  active: r.active,
})

export const product = (r) => ({
  id: r.id,
  categoryId: r.category_id,
  name: r.name,
  sku: r.sku,
  description: r.description,
  price: Number(r.price),
  promo: Number(r.promo),
  stock: r.stock,
  unit: r.unit,
  art: r.art,
  tint: r.tint,
  image: r.image,
  specs: r.specs ?? [],
  featured: r.featured,
  active: r.active,
  // Medidas do pacote, para a etiqueta de envio.
  weightG: Number(r.weight_g ?? 0),
  lengthCm: Number(r.length_cm ?? 0),
  widthCm: Number(r.width_cm ?? 0),
  heightCm: Number(r.height_cm ?? 0),
  variantLabel: r.variant_label ?? '',
  variants: (r.variants ?? []).map(variant),
})

export const address = (r) => ({
  id: r.id,
  label: r.label,
  cep: r.cep,
  address: r.street,
  number: r.number,
  complement: r.complement,
  district: r.district,
  city: r.city,
  state: r.state,
  isDefault: r.is_default,
})

/** Nunca inclui password_hash. */
export const customer = (r) => ({
  id: r.id,
  name: r.name,
  email: r.email,
  phone: r.phone,
  cpfCnpj: r.doc ?? '',
  createdAt: r.created_at,
  addresses: (r.addresses ?? []).map(address),
})

export const zone = (r) => ({
  id: r.id,
  name: r.name,
  cepStart: r.cep_start,
  cepEnd: r.cep_end,
  fee: Number(r.fee),
  days: r.days,
  active: r.active,
})

export const orderItem = (r) => ({
  productId: r.product_id,
  variantId: r.variant_id ?? null,
  variantName: r.variant_name ?? '',
  name: r.name,
  sku: r.sku,
  art: r.art,
  tint: r.tint,
  price: Number(r.price),
  qty: r.qty,
})

export const order = (r) => ({
  id: r.id,
  seq: r.seq,
  customerId: r.customer_id,
  status: r.status,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
  delivery: r.delivery,
  deliveryZone: r.delivery_zone,
  deliveryDays: r.delivery_days,
  payment: r.payment,
  note: r.note,
  subtotal: Number(r.subtotal),
  shipping: Number(r.shipping),
  total: Number(r.total),
  customer: {
    name: r.customer_name,
    email: r.customer_email,
    phone: r.customer_phone,
    cpfCnpj: r.customer_doc ?? '',
    cep: r.cep,
    address: r.street,
    number: r.number,
    complement: r.complement,
    district: r.district,
    city: r.city,
    state: r.state,
  },
  items: (r.items ?? []).map(orderItem),
})

/** Nunca expõe `raw`: pode conter dados internos da processadora. */
export const payment = (r) =>
  r
    ? {
        id: r.id,
        provider: r.provider,
        method: r.method,
        status: r.status,
        amount: Number(r.amount),
        checkoutUrl: r.checkout_url,
        paidAt: r.paid_at,
        expiresAt: r.expires_at,
        createdAt: r.created_at,
      }
    : null

export const settings = (r) => ({
  storeName: r.store_name,
  tagline: r.tagline,
  email: r.email,
  phone: r.phone,
  address: r.address,
  hours: r.hours,
  instagram: r.instagram,
  pixKey: r.pix_key,
  freeShippingFrom: Number(r.free_shipping_from),
  lowStockThreshold: r.low_stock_threshold,
})
