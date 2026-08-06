/** Erro com status HTTP, para o middleware de erro traduzir na resposta. */
export class HttpError extends Error {
  constructor(status, message, details) {
    super(message)
    this.status = status
    this.details = details
  }
}

export const badRequest = (msg, details) => new HttpError(400, msg, details)
export const unauthorized = (msg = 'Faça login para continuar.') => new HttpError(401, msg)
export const forbidden = (msg = 'Você não tem acesso a isto.') => new HttpError(403, msg)
export const notFound = (msg = 'Não encontrado.') => new HttpError(404, msg)
export const conflict = (msg) => new HttpError(409, msg)

/**
 * Envolve um handler assíncrono para que qualquer rejeição chegue ao
 * middleware de erro — sem isto, um `await` que falha derruba a requisição
 * sem resposta.
 */
export const wrap = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next)

/** Middleware final de erro. */
export function errorHandler(err, req, res, _next) {
  const status = err.status ?? 500

  if (status >= 500) {
    console.error('[api] erro não tratado:', err)
  }

  res.status(status).json({
    error: status >= 500 ? 'Erro interno no servidor.' : err.message,
    ...(err.details ? { details: err.details } : {}),
  })
}
