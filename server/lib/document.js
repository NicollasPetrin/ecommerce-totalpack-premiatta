/**
 * Validação de CPF e CNPJ.
 *
 * O Asaas recusa cobrança com documento inválido, e o erro chegaria só depois
 * de o pedido já estar gravado. Conferir aqui devolve a mensagem no formulário,
 * onde o cliente ainda pode corrigir.
 *
 * O cálculo é o dígito verificador oficial — não basta contar os dígitos:
 * "111.111.111-11" tem 11 dígitos e é inválido.
 */

export const onlyDigits = (value) => String(value ?? '').replace(/\D/g, '')

function isValidCpf(cpf) {
  if (cpf.length !== 11) return false
  // Todos os dígitos iguais passam na conta mas não são CPFs reais.
  if (/^(\d)\1{10}$/.test(cpf)) return false

  const digit = (slice, startWeight) => {
    let sum = 0
    for (let i = 0; i < slice.length; i++) sum += Number(slice[i]) * (startWeight - i)
    const rest = (sum * 10) % 11
    return rest === 10 ? 0 : rest
  }

  return (
    digit(cpf.slice(0, 9), 10) === Number(cpf[9]) &&
    digit(cpf.slice(0, 10), 11) === Number(cpf[10])
  )
}

function isValidCnpj(cnpj) {
  if (cnpj.length !== 14) return false
  if (/^(\d)\1{13}$/.test(cnpj)) return false

  const digit = (slice) => {
    // Pesos do CNPJ: 5..2 seguidos de 9..2.
    let weight = slice.length - 7
    let sum = 0
    for (let i = 0; i < slice.length; i++) {
      sum += Number(slice[i]) * weight--
      if (weight < 2) weight = 9
    }
    const rest = sum % 11
    return rest < 2 ? 0 : 11 - rest
  }

  return (
    digit(cnpj.slice(0, 12)) === Number(cnpj[12]) &&
    digit(cnpj.slice(0, 13)) === Number(cnpj[13])
  )
}

/** Aceita CPF (11 dígitos) ou CNPJ (14). */
export function isValidDocument(value) {
  const digits = onlyDigits(value)
  if (digits.length === 11) return isValidCpf(digits)
  if (digits.length === 14) return isValidCnpj(digits)
  return false
}

/** 123.456.789-01 ou 12.345.678/0001-90 */
export function formatDocument(value) {
  const d = onlyDigits(value)
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5')
  return d
}
