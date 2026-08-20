import { Router } from 'express'
import { many, one } from '../db/pool.js'
import { wrap, notFound, badRequest } from '../lib/http.js'
import { parse, schemas, validarUuid } from '../lib/validate.js'
import {
  clearSession, requireAdmin, setSession, verifyPassword, hashPassword,
} from '../lib/auth.js'
import { findOverlaps, findZone } from '../lib/zones.js'
import { limiteLogin, limiteExterno } from '../lib/ratelimit.js'
import { config } from '../config.js'
import { itensComMedidas, quoteForCart } from '../lib/shipping/service.js'
import { esquecerToken } from '../lib/shipping/credenciais.js'
import { esquecerChaveEmail } from '../lib/email/service.js'
import { esquecerChaveFiscal } from '../lib/fiscal/service.js'
import * as s from '../lib/serialize.js'

export const storeRoutes = Router()

storeRoutes.param('id', validarUuid)

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
         instagram=$7, pix_key=$8, free_shipping_from=$9, low_stock_threshold=$10,
         sender_name=$11, sender_doc=$12, sender_cep=$13, sender_street=$14,
         sender_number=$15, sender_compl=$16, sender_district=$17,
         sender_city=$18, sender_state=$19,
         /* Vazio não apaga o que já existe: a tela nunca recebe o token de
            volta, então mandar vazio significa "não mexi nele". */
         melhorenvio_token = CASE WHEN $20 = '' THEN melhorenvio_token ELSE $20 END,
         auto_label = $21,
         notify_email = $22,
         notify_customer = $23,
         /* Mesma regra do token da transportadora: vazio = nao mexi. */
         email_key = CASE WHEN $24 = '' THEN email_key ELSE $24 END,
         /* E a chave do emissor de nota, pela mesma regra. */
         fiscal_key = CASE WHEN $25 = '' THEN fiscal_key ELSE $25 END,
         auto_invoice = $26,
         fiscal_sandbox = $27,
         fiscal_bank_id = $28,
         /* Mesma regra das chaves: vazio = nao mexi. */
         fiscal_webhook_secret = CASE WHEN $29 = '' THEN fiscal_webhook_secret ELSE $29 END
       WHERE id = true RETURNING *`,
      [
        d.storeName, d.tagline, d.email, d.phone, d.address, d.hours,
        d.instagram, d.pixKey, d.freeShippingFrom, d.lowStockThreshold,
        d.senderName, d.senderDoc, d.senderCep, d.senderStreet,
        d.senderNumber, d.senderCompl, d.senderDistrict,
        d.senderCity, d.senderState, d.melhorenvioToken, d.autoLabel,
        d.notifyEmail, d.notifyCustomer, d.emailKey,
        d.fiscalKey, d.autoInvoice, d.fiscalSandbox, d.fiscalBankId,
        d.fiscalWebhookSecret,
      ],
    )
    // A troca do token tem que valer na próxima cotação, não daqui a 30s.
    esquecerToken()
    esquecerChaveEmail()
    esquecerChaveFiscal()
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

/**
 * Opções reais de frete para a sacola, quando há transportadora integrada.
 *
 * Recebe só ids e quantidades: peso, medida e preço saem do banco. Passa pelo
 * limite das rotas externas porque cada chamada aqui consome cota da conta da
 * transportadora — e esta é uma rota pública, aberta a qualquer visitante.
 */
storeRoutes.post(
  '/shipping/options',
  limiteExterno,
  wrap(async (req, res) => {
    if (config.shippingProvider === 'manual') {
      // Sem integração, quem responde é a tabela de faixas de CEP.
      return res.json({ provider: 'manual', options: [] })
    }

    const linhas = Array.isArray(req.body?.items) ? req.body.items.slice(0, 60) : []
    const itens = await itensComMedidas(
      linhas
        .filter((l) => typeof l?.productId === 'string')
        .map((l) => ({ productId: l.productId, qty: Math.max(1, Number(l.qty) || 1) })),
    )

    const r = await quoteForCart({ cep: req.body?.cep, itens })

    // O diagnóstico da transportadora só sai para quem administra a loja.
    const { causa, corpo, ...publico } = r
    const ehAdmin = req.user?.role === 'admin'

    res.json({
      provider: config.shippingProvider,
      ...publico,
      ...(ehAdmin && causa ? { causa, corpo } : {}),
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
  limiteLogin,
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
