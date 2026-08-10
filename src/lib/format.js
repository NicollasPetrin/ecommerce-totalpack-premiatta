/** Utilitários de formatação (pt-BR). */

const BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
})

const NUM = new Intl.NumberFormat('pt-BR')

/**
 * Marcas de acentuação combinantes (U+0300–U+036F), removidas após
 * `normalize('NFD')`. Construído por código para o arquivo não depender de
 * caracteres invisíveis no fonte.
 */
const DIACRITICS = new RegExp(
  `[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`,
  'g',
)

export const money = (v) => BRL.format(Number(v) || 0)

export const num = (v) => NUM.format(Number(v) || 0)

export const date = (iso, opts = {}) =>
  new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...opts,
  })

export const dateTime = (iso) =>
  new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

/** Slug amigável para URL, sem acentos. */
export const slugify = (s) =>
  String(s)
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

/** Normaliza texto para busca (sem acentos, minúsculo). */
export const norm = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(DIACRITICS, '')
    .toLowerCase()

/** Máscara de telefone brasileiro: (11) 91234-5678 */
export function maskPhone(value) {
  const d = String(value).replace(/\D/g, '').slice(0, 11)
  if (d.length <= 2) return d
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}

/**
 * Máscara de CPF/CNPJ, decidida pela quantidade de dígitos:
 * 123.456.789-01 até 11, 12.345.678/0001-90 a partir daí.
 */
export function maskDoc(value) {
  const d = String(value).replace(/\D/g, '').slice(0, 14)

  if (d.length <= 11) {
    return d
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2')
  }

  return d
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2')
}

/** Máscara de CEP: 01234-567 */
export function maskCep(value) {
  const d = String(value).replace(/\D/g, '').slice(0, 8)
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d
}

/** Percentual de desconto entre preço cheio e promocional. */
export const discountPct = (price, promo) =>
  price > 0 && promo > 0 && promo < price
    ? Math.round((1 - promo / price) * 100)
    : 0

/** Preço efetivo de um produto (considera promoção). */
export const effectivePrice = (p) =>
  p?.promo > 0 && p.promo < p.price ? p.promo : (p?.price ?? 0)

/** Identificador curto e único o bastante para uso local. */
export const uid = (prefix = 'id') =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`

/** Número de pedido legível: #2026-0007 */
export const orderCode = (seq, iso) =>
  `#${new Date(iso).getFullYear()}-${String(seq).padStart(4, '0')}`

export const clamp = (n, min, max) => Math.min(Math.max(n, min), max)
