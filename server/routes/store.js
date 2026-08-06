import { Router } from 'express'
import { many, one } from '../db/pool.js'
import { wrap, notFound, badRequest } from '../lib/http.js'
import { parse, schemas } from '../lib/validate.js'
import {
  clearSession, requireAdmin, setSession, verifyPassword, hashPassword,
} from '../lib/auth.js'
import { findOverlaps, findZone } from '../lib/shipping.js'
import * as s from '../lib/serialize.js'

export const storeRoutes = Router()

/* -------------------------------------------------------------- Configurações */

storeRoutes.get(
  '/settings',
  wrap(async (_req, res) => {
    const row = await one(`SELECT * FROM settings WHERE id = true`)
    res.json({ settings: s.settings(row) })
  }),
)

storeRoutes.put(
  '/settings',
  requireAdmin,
  wrap(async (req, res) => {
    const d = parse(schemas.settings, req.body)
    const row = await one(
      `UPDATE settings SET
         store_name=$1, tagline=$2, email=$3, phone=$4, address=$5, hours=$6,
         instagram=$7, pix_key=$8, free_shipping_from=$9, pickup_enabled=$10,
         low_stock_threshold=$11
       WHERE id = true RETURNING *`,
      [
        d.storeName, d.tagline, d.email, d.phone, d.address, d.hours,
        d.instagram, d.pixKey, d.freeShippingFrom, d.pickupEnabled, d.lowStockThreshold,
      ],
    )
    res.json({ settings: s.settings(row) })
  }),
)

/* ------------------------------------------------------------------- Frete */

storeRoutes.get(
  '/shipping/zones',
  wrap(async (req, res) => {
    const isAdmin = req.user?.role === 'admin'
    const rows = await many(
      `SELECT * FROM shipping_zones WHERE ($1::boolean OR active) ORDER BY cep_start`,
      [isAdmin],
    )
    res.json({ zones: rows.map(s.zone) })
  }),
)

/** Consulta pública de frete por CEP, usada pela loja. */
storeRoutes.get(
  '/shipping/quote',
  wrap(async (req, res) => {
    const zone = await findZone(req.query.cep)
    if (!zone) return res.json({ zone: null })
    res.json({
      zone: { id: zone.id, name: zone.name, fee: Number(zone.fee), days: zone.days },
    })
  }),
)

storeRoutes.post(
  '/shipping/zones',
  requireAdmin,
  wrap(async (req, res) => {
    const d = parse(schemas.zone, req.body)

    if (d.active) {
      const clash = await findOverlaps({ cepStart: d.cepStart, cepEnd: d.cepEnd })
      if (clash.length) {
        throw badRequest('Faixa sobreposta.', {
          cepStart: `Esta faixa se cruza com “${clash[0].name}”.`,
        })
      }
    }

    const row = await one(
      `INSERT INTO shipping_zones (name, cep_start, cep_end, fee, days, active)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [d.name, d.cepStart, d.cepEnd, d.fee, d.days, d.active],
    )
    res.status(201).json({ zone: s.zone(row) })
  }),
)

storeRoutes.put(
  '/shipping/zones/:id',
  requireAdmin,
  wrap(async (req, res) => {
    const d = parse(schemas.zone, req.body)

    if (d.active) {
      const clash = await findOverlaps({
        cepStart: d.cepStart,
        cepEnd: d.cepEnd,
        excludeId: req.params.id,
      })
      if (clash.length) {
        throw badRequest('Faixa sobreposta.', {
          cepStart: `Esta faixa se cruza com “${clash[0].name}”.`,
        })
      }
    }

    const row = await one(
      `UPDATE shipping_zones SET name=$1, cep_start=$2, cep_end=$3, fee=$4, days=$5, active=$6
        WHERE id=$7 RETURNING *`,
      [d.name, d.cepStart, d.cepEnd, d.fee, d.days, d.active, req.params.id],
    )
    if (!row) throw notFound('Região não encontrada.')
    res.json({ zone: s.zone(row) })
  }),
)

storeRoutes.put(
  '/shipping/zones/:id/active',
  requireAdmin,
  wrap(async (req, res) => {
    const row = await one(
      `UPDATE shipping_zones SET active = NOT active WHERE id = $1 RETURNING *`,
      [req.params.id],
    )
    if (!row) throw notFound('Região não encontrada.')
    res.json({ zone: s.zone(row) })
  }),
)

storeRoutes.delete(
  '/shipping/zones/:id',
  requireAdmin,
  wrap(async (req, res) => {
    const row = await one(`DELETE FROM shipping_zones WHERE id = $1 RETURNING id`, [
      req.params.id,
    ])
    if (!row) throw notFound('Região não encontrada.')
    res.json({ ok: true })
  }),
)

/* ----------------------------------------------------------- Acesso do admin */

storeRoutes.post(
  '/admin/login',
  wrap(async (req, res) => {
    const { email, password } = parse(schemas.login, req.body)
    const row = await one(`SELECT * FROM admins WHERE lower(email) = $1`, [email])

    const ok = row && (await verifyPassword(password, row.password_hash))
    if (!ok) throw badRequest('E-mail ou senha incorretos.')

    setSession(res, { sub: row.id, role: 'admin' })
    res.json({ admin: { id: row.id, name: row.name, email: row.email } })
  }),
)

storeRoutes.post('/admin/logout', (req, res) => {
  clearSession(res)
  res.json({ ok: true })
})

storeRoutes.get('/admin/me', (req, res) => {
  res.json({ admin: req.user?.role === 'admin' ? { id: req.user.sub } : null })
})

storeRoutes.put(
  '/admin/password',
  requireAdmin,
  wrap(async (req, res) => {
    const { current, next } = parse(schemas.passwordChange, req.body)
    const row = await one(`SELECT password_hash FROM admins WHERE id = $1`, [req.user.sub])
    if (!row || !(await verifyPassword(current, row.password_hash))) {
      throw badRequest('Senha atual incorreta.')
    }
    await one(`UPDATE admins SET password_hash = $1 WHERE id = $2 RETURNING id`, [
      await hashPassword(next),
      req.user.sub,
    ])
    res.json({ ok: true })
  }),
)

/* ------------------------------------------------------- Clientes (admin) */

storeRoutes.get(
  '/admin/customers',
  requireAdmin,
  wrap(async (_req, res) => {
    const rows = await many(`SELECT * FROM customers ORDER BY created_at DESC`)
    const addresses = await many(`SELECT * FROM addresses ORDER BY is_default DESC, created_at`)

    const byCustomer = new Map()
    for (const a of addresses) {
      if (!byCustomer.has(a.customer_id)) byCustomer.set(a.customer_id, [])
      byCustomer.get(a.customer_id).push(a)
    }

    res.json({
      customers: rows.map((r) => s.customer({ ...r, addresses: byCustomer.get(r.id) ?? [] })),
    })
  }),
)
