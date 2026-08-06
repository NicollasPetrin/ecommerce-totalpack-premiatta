/**
 * Cliente HTTP da API.
 *
 * O front chama sempre `/api/...` na própria origem: no desenvolvimento o Vite
 * encaminha para o Express (ver vite.config.js) e em produção os dois são
 * servidos juntos. A sessão viaja num cookie httpOnly, por isso `credentials`.
 */

/** Erro de API já com a mensagem e os erros por campo que o servidor mandou. */
export class ApiError extends Error {
  constructor(status, message, details) {
    super(message)
    this.status = status
    this.details = details ?? {}
  }
}

async function request(method, path, body) {
  let response
  try {
    response = await fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError(0, 'Não foi possível falar com o servidor. Ele está no ar?')
  }

  if (response.status === 204) return null

  let payload
  try {
    payload = await response.json()
  } catch {
    payload = {}
  }

  if (!response.ok) {
    throw new ApiError(
      response.status,
      payload.error ?? 'Algo deu errado.',
      payload.details,
    )
  }

  return payload
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body),
  put: (path, body) => request('PUT', path, body),
  del: (path) => request('DELETE', path),
}
