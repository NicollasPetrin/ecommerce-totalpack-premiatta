import { many, one } from '../db/pool.js'

/**
 * Cálculo de frete no servidor.
 *
 * O cliente informa apenas o CEP; preço e prazo vêm sempre do banco. Se o
 * cálculo ficasse no navegador, bastaria editar o JavaScript para pagar
 * R$ 0,00 de frete.
 */

export const normalizeCep = (value) => {
  const digits = String(value ?? '').replace(/\D/g, '')
  return digits.length === 8 ? digits : null
}

/** Zona que cobre o CEP, ou null. */
export async function findZone(cep) {
  const normalized = normalizeCep(cep)
  if (!normalized) return null

  return one(
    `SELECT id, name, cep_start, cep_end, fee, days
       FROM shipping_zones
      WHERE active AND $1 BETWEEN cep_start AND cep_end
      ORDER BY cep_start
      LIMIT 1`,
    [normalized],
  )
}

/** Zonas que se cruzam com um intervalo — impede tabela ambígua. */
export async function findOverlaps({ cepStart, cepEnd, excludeId = null }) {
  return many(
    `SELECT id, name, cep_start, cep_end
       FROM shipping_zones
      WHERE active
        AND ($3::uuid IS NULL OR id <> $3)
        AND cep_start <= $2
        AND cep_end   >= $1`,
    [cepStart, cepEnd, excludeId],
  )
}

/**
 * Frete de um pedido: zero se o subtotal alcança o frete grátis, senão o preço
 * da zona. Quem cria o pedido já garantiu que a zona existe.
 */
export function quote({ zone, subtotal, freeShippingFrom }) {
  const free = subtotal >= Number(freeShippingFrom) && subtotal > 0
  return { fee: free ? 0 : Number(zone.fee), zone, free }
}
