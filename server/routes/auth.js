import { Router } from 'express'
import { many, one, transaction } from '../db/pool.js'
import { wrap, conflict, unauthorized, badRequest } from '../lib/http.js'
import { parse, schemas } from '../lib/validate.js'
import {
  clearSession, hashPassword, requireCustomer, setSession, verifyPassword,
} from '../lib/auth.js'
import * as s from '../lib/serialize.js'

export const authRoutes = Router()

/** Cliente com endereços, no formato que o front espera. */
async function loadCustomer(id) {
  const row = await one(`SELECT * FROM customers WHERE id = $1`, [id])
  if (!row) return null
  row.addresses = await many(
    `SELECT * FROM addresses WHERE customer_id = $1
      ORDER BY is_default DESC, created_at`,
    [id],
  )
  return s.customer(row)
}

/* ------------------------------------------------------------------ Cadastro */

authRoutes.post(
  '/signup',
  wrap(async (req, res) => {
    const data = parse(schemas.signup, req.body)

    const existing = await one(`SELECT id FROM customers WHERE lower(email) = $1`, [data.email])
    if (existing) throw conflict('Já existe uma conta com este e-mail.')

    const passwordHash = await hashPassword(data.password)
    const row = await one(
      `INSERT INTO customers (name, email, phone, password_hash)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [data.name, data.email, data.phone, passwordHash],
    )

    setSession(res, { sub: row.id, role: 'customer' })
    res.status(201).json({ customer: await loadCustomer(row.id) })
  }),
)

/* --------------------------------------------------------------------- Login */

authRoutes.post(
  '/login',
  wrap(async (req, res) => {
    const { email, password } = parse(schemas.login, req.body)

    const row = await one(`SELECT * FROM customers WHERE lower(email) = $1`, [email])

    // Mesma mensagem para e-mail inexistente e senha errada: não entregamos
    // a quem tentar adivinhar quais e-mails têm conta.
    const ok = row && (await verifyPassword(password, row.password_hash))
    if (!ok) throw unauthorized('E-mail ou senha incorretos.')

    setSession(res, { sub: row.id, role: 'customer' })
    res.json({ customer: await loadCustomer(row.id) })
  }),
)

authRoutes.post('/logout', (req, res) => {
  clearSession(res)
  res.json({ ok: true })
})

/* ----------------------------------------------------------------- Sessão */

authRoutes.get(
  '/me',
  wrap(async (req, res) => {
    if (!req.user || req.user.role !== 'customer') return res.json({ customer: null })
    res.json({ customer: await loadCustomer(req.user.sub) })
  }),
)

/* ------------------------------------------------------------------ Perfil */

authRoutes.put(
  '/me',
  requireCustomer,
  wrap(async (req, res) => {
    const data = parse(schemas.profile, req.body)

    const taken = await one(
      `SELECT id FROM customers WHERE lower(email) = $1 AND id <> $2`,
      [data.email, req.user.sub],
    )
    if (taken) throw conflict('Este e-mail já está em uso por outra conta.')

    await one(
      `UPDATE customers SET name = $1, email = $2, phone = $3 WHERE id = $4 RETURNING id`,
      [data.name, data.email, data.phone, req.user.sub],
    )
    res.json({ customer: await loadCustomer(req.user.sub) })
  }),
)

authRoutes.put(
  '/me/password',
  requireCustomer,
  wrap(async (req, res) => {
    const { current, next } = parse(schemas.passwordChange, req.body)

    const row = await one(`SELECT password_hash FROM customers WHERE id = $1`, [req.user.sub])
    if (!row || !(await verifyPassword(current, row.password_hash))) {
      throw badRequest('Senha atual incorreta.')
    }

    await one(`UPDATE customers SET password_hash = $1 WHERE id = $2 RETURNING id`, [
      await hashPassword(next),
      req.user.sub,
    ])
    res.json({ ok: true })
  }),
)

/* --------------------------------------------------------------- Endereços */

authRoutes.get(
  '/me/addresses',
  requireCustomer,
  wrap(async (req, res) => {
    const rows = await many(
      `SELECT * FROM addresses WHERE customer_id = $1 ORDER BY is_default DESC, created_at`,
      [req.user.sub],
    )
    res.json({ addresses: rows.map(s.address) })
  }),
)

authRoutes.post(
  '/me/addresses',
  requireCustomer,
  wrap(async (req, res) => {
    const data = parse(schemas.address, req.body)
    const customerId = req.user.sub

    const address = await transaction(async (client) => {
      const { rows: existing } = await client.query(
        `SELECT id FROM addresses WHERE customer_id = $1`,
        [customerId],
      )
      // O primeiro endereço vira padrão automaticamente.
      const isDefault = data.isDefault || existing.length === 0

      if (isDefault) {
        await client.query(
          `UPDATE addresses SET is_default = false WHERE customer_id = $1`,
          [customerId],
        )
      }

      const { rows } = await client.query(
        `INSERT INTO addresses
           (customer_id, label, cep, street, number, complement, district, city, state, is_default)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [
          customerId, data.label, data.cep, data.street, data.number,
          data.complement, data.district, data.city, data.state, isDefault,
        ],
      )
      return rows[0]
    })

    res.status(201).json({ address: s.address(address) })
  }),
)

authRoutes.put(
  '/me/addresses/:id',
  requireCustomer,
  wrap(async (req, res) => {
    const data = parse(schemas.address, req.body)
    const customerId = req.user.sub

    const address = await transaction(async (client) => {
      // O WHERE com customer_id impede editar endereço de outra conta.
      const { rows: owned } = await client.query(
        `SELECT id FROM addresses WHERE id = $1 AND customer_id = $2`,
        [req.params.id, customerId],
      )
      if (!owned.length) return null

      if (data.isDefault) {
        await client.query(
          `UPDATE addresses SET is_default = false WHERE customer_id = $1`,
          [customerId],
        )
      }

      const { rows } = await client.query(
        `UPDATE addresses
            SET label=$1, cep=$2, street=$3, number=$4, complement=$5,
                district=$6, city=$7, state=$8, is_default=$9
          WHERE id = $10 AND customer_id = $11
          RETURNING *`,
        [
          data.label, data.cep, data.street, data.number, data.complement,
          data.district, data.city, data.state, data.isDefault,
          req.params.id, customerId,
        ],
      )
      return rows[0]
    })

    if (!address) throw badRequest('Endereço não encontrado.')
    res.json({ address: s.address(address) })
  }),
)

authRoutes.put(
  '/me/addresses/:id/default',
  requireCustomer,
  wrap(async (req, res) => {
    await transaction(async (client) => {
      await client.query(`UPDATE addresses SET is_default = false WHERE customer_id = $1`, [
        req.user.sub,
      ])
      await client.query(
        `UPDATE addresses SET is_default = true WHERE id = $1 AND customer_id = $2`,
        [req.params.id, req.user.sub],
      )
    })
    res.json({ ok: true })
  }),
)

authRoutes.delete(
  '/me/addresses/:id',
  requireCustomer,
  wrap(async (req, res) => {
    await transaction(async (client) => {
      const { rows } = await client.query(
        `DELETE FROM addresses WHERE id = $1 AND customer_id = $2 RETURNING is_default`,
        [req.params.id, req.user.sub],
      )
      // Se o padrão saiu, o mais antigo que sobrar assume.
      if (rows[0]?.is_default) {
        await client.query(
          `UPDATE addresses SET is_default = true
            WHERE id = (SELECT id FROM addresses WHERE customer_id = $1
                        ORDER BY created_at LIMIT 1)`,
          [req.user.sub],
        )
      }
    })
    res.json({ ok: true })
  }),
)
