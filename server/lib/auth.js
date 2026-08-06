import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { config } from '../config.js'
import { unauthorized, forbidden } from './http.js'

const ROUNDS = 12

export const hashPassword = (plain) => bcrypt.hash(plain, ROUNDS)
export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash)

/**
 * Sessão em cookie httpOnly: o JavaScript da página não alcança o token,
 * então um XSS não consegue roubá-lo.
 */
export function setSession(res, payload) {
  const token = jwt.sign(payload, config.jwtSecret, {
    expiresIn: config.sessionMaxAge / 1000,
  })

  res.cookie(config.cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
    maxAge: config.sessionMaxAge,
    path: '/',
  })
}

export function clearSession(res) {
  res.clearCookie(config.cookieName, { path: '/' })
}

/** Lê a sessão do cookie e põe em req.user; nunca lança. */
export function readSession(req, _res, next) {
  const token = req.cookies?.[config.cookieName]
  if (!token) {
    req.user = null
    return next()
  }
  try {
    req.user = jwt.verify(token, config.jwtSecret)
  } catch {
    req.user = null
  }
  next()
}

/** Exige um cliente autenticado. */
export function requireCustomer(req, _res, next) {
  if (!req.user || req.user.role !== 'customer') return next(unauthorized())
  next()
}

/** Exige um administrador autenticado. */
export function requireAdmin(req, _res, next) {
  if (!req.user) return next(unauthorized())
  if (req.user.role !== 'admin') return next(forbidden())
  next()
}
