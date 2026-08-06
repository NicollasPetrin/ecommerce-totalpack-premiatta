/**
 * Frete por faixa de CEP.
 *
 * O cálculo é uma busca simples: o CEP do cliente vira um número de 8 dígitos
 * e procuramos a primeira zona ativa cujo intervalo o contenha. Sem servidor,
 * sem token, sem chamada externa — o preço é o que você cadastrou no painel.
 *
 * Quando quiser cotação real (Correios, Jadlog…), é este arquivo que passa a
 * conversar com uma função no servidor; nenhuma tela precisa mudar.
 */

/** Devolve os 8 dígitos do CEP, ou null se estiver incompleto. */
export function normalizeCep(value) {
  const digits = String(value ?? '').replace(/\D/g, '')
  return digits.length === 8 ? digits : null
}

/** Formata 8 dígitos como 01310-100. */
export function formatCep(value) {
  const digits = String(value ?? '').replace(/\D/g, '').slice(0, 8)
  return digits.length > 5 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : digits
}

/** Zona de entrega correspondente ao CEP, ou null se não atendemos a região. */
export function findZone(cep, zones = []) {
  const normalized = normalizeCep(cep)
  if (!normalized) return null

  const value = Number(normalized)
  return (
    zones.find(
      (z) =>
        z.active !== false &&
        value >= Number(z.cepStart) &&
        value <= Number(z.cepEnd),
    ) ?? null
  )
}

/** Texto do intervalo de uma zona: "01000-000 a 05999-999". */
export const zoneRange = (zone) =>
  `${formatCep(zone.cepStart)} a ${formatCep(zone.cepEnd)}`

/** Prazo em texto: "2 dias úteis". */
export const zoneDeadline = (zone) =>
  zone.days === 1 ? '1 dia útil' : `${zone.days} dias úteis`

/**
 * Menor preço entre as zonas ativas — usado no "frete a partir de R$ X"
 * antes de o cliente informar o CEP.
 */
export function cheapestFee(zones = []) {
  const active = zones.filter((z) => z.active !== false)
  return active.length ? Math.min(...active.map((z) => z.fee)) : 0
}

/** Duas zonas não podem cobrir o mesmo CEP: a busca pegaria sempre a primeira. */
export function findOverlap(zone, zones = []) {
  const start = Number(zone.cepStart)
  const end = Number(zone.cepEnd)
  return (
    zones.find(
      (z) =>
        z.id !== zone.id &&
        z.active !== false &&
        start <= Number(z.cepEnd) &&
        end >= Number(z.cepStart),
    ) ?? null
  )
}
