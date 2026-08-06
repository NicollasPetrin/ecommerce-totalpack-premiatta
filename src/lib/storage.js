/**
 * Persistência local.
 *
 * Toda a loja roda hoje sobre `localStorage`, o que permite usar o sistema sem
 * backend. Quando houver uma API, basta trocar as funções deste arquivo por
 * chamadas HTTP — o restante do app fala apenas com o StoreContext.
 */

const PREFIX = 'totalpack:'

export const KEYS = {
  products: `${PREFIX}products`,
  categories: `${PREFIX}categories`,
  orders: `${PREFIX}orders`,
  settings: `${PREFIX}settings`,
  cart: `${PREFIX}cart`,
  session: `${PREFIX}session`,
  theme: `${PREFIX}theme`,
  cep: `${PREFIX}cep`,
}

export function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key)
    if (raw == null) return fallback
    return JSON.parse(raw)
  } catch {
    return fallback
  }
}

export function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch (err) {
    // Cota estourada normalmente significa imagens base64 grandes demais.
    console.error('Falha ao gravar no armazenamento local:', err)
    return false
  }
}

export function remove(key) {
  try {
    localStorage.removeItem(key)
  } catch {
    /* ignorado */
  }
}

/** Limpa apenas as chaves do TotalPack. */
export function clearAll() {
  Object.values(KEYS).forEach(remove)
}

/** Backup completo da loja em um único objeto. */
export function exportAll() {
  return {
    _app: 'TotalPack',
    _version: 1,
    _exportedAt: new Date().toISOString(),
    products: read(KEYS.products, []),
    categories: read(KEYS.categories, []),
    orders: read(KEYS.orders, []),
    settings: read(KEYS.settings, {}),
  }
}

/** Restaura um backup gerado por `exportAll`. */
export function importAll(data) {
  if (!data || data._app !== 'TotalPack') {
    throw new Error('Arquivo de backup inválido.')
  }
  if (Array.isArray(data.products)) write(KEYS.products, data.products)
  if (Array.isArray(data.categories)) write(KEYS.categories, data.categories)
  if (Array.isArray(data.orders)) write(KEYS.orders, data.orders)
  if (data.settings) write(KEYS.settings, data.settings)
  return true
}

/**
 * Hash simples para não guardar a senha do admin em texto puro.
 * Não é criptografia — é apenas ofuscação para um app 100% client-side.
 * Com backend, troque por bcrypt/argon2 no servidor.
 */
export function hash(text) {
  let h = 0x811c9dc5
  const s = String(text)
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}
