/**
 * Estado local do navegador.
 *
 * Catálogo, pedidos, contas e configurações moram no PostgreSQL e chegam pela
 * API. Aqui ficam só as três coisas que pertencem ao aparelho de quem está
 * navegando e não fazem sentido no servidor: a sacola antes de virar pedido,
 * o CEP digitado para consultar o frete, e a preferência de tema.
 */

const PREFIX = 'totalpack:'

export const KEYS = {
  cart: `${PREFIX}cart`,
  cep: `${PREFIX}cep`,
  theme: `${PREFIX}theme`,
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
