import { Router } from 'express'
import { many, one } from '../db/pool.js'
import { wrap, notFound, conflict } from '../lib/http.js'
import { parse, schemas } from '../lib/validate.js'
import { requireAdmin } from '../lib/auth.js'
import * as s from '../lib/serialize.js'

export const catalogRoutes = Router()

/* ======================================================== Público (leitura) */

catalogRoutes.get(
  '/categories',
  wrap(async (_req, res) => {
    const rows = await many(`SELECT * FROM categories ORDER BY position, name`)
    res.json({ categories: rows.map(s.category) })
  }),
)

/**
 * Catálogo. Sem sessão de admin, só produtos ativos — um produto desativado
 * não deve vazar nem por URL direta.
 */
catalogRoutes.get(
  '/products',
  wrap(async (req, res) => {
    const isAdmin = req.user?.role === 'admin'
    const rows = await many(
      `SELECT * FROM products
        WHERE ($1::boolean OR active)
        ORDER BY featured DESC, name`,
      [isAdmin],
    )
    res.json({ products: rows.map(s.product) })
  }),
)

catalogRoutes.get(
  '/products/:id',
  wrap(async (req, res) => {
    const isAdmin = req.user?.role === 'admin'
    const row = await one(
      `SELECT * FROM products WHERE id = $1 AND ($2::boolean OR active)`,
      [req.params.id, isAdmin],
    )
    if (!row) throw notFound('Produto não encontrado.')
    res.json({ product: s.product(row) })
  }),
)

/* ========================================================== Admin (escrita) */

catalogRoutes.post(
  '/categories',
  requireAdmin,
  wrap(async (req, res) => {
    const data = parse(schemas.category, req.body)
    const taken = await one(`SELECT id FROM categories WHERE slug = $1`, [data.slug])
    if (taken) throw conflict('Já existe uma categoria com este endereço.')

    const row = await one(
      `INSERT INTO categories (name, slug, description, position)
       VALUES ($1,$2,$3,$4) RETURNING *`,
      [data.name, data.slug, data.description, data.position],
    )
    res.status(201).json({ category: s.category(row) })
  }),
)

catalogRoutes.put(
  '/categories/:id',
  requireAdmin,
  wrap(async (req, res) => {
    const data = parse(schemas.category, req.body)
    const taken = await one(`SELECT id FROM categories WHERE slug = $1 AND id <> $2`, [
      data.slug,
      req.params.id,
    ])
    if (taken) throw conflict('Já existe uma categoria com este endereço.')

    const row = await one(
      `UPDATE categories SET name=$1, slug=$2, description=$3, position=$4
        WHERE id=$5 RETURNING *`,
      [data.name, data.slug, data.description, data.position, req.params.id],
    )
    if (!row) throw notFound('Categoria não encontrada.')
    res.json({ category: s.category(row) })
  }),
)

catalogRoutes.delete(
  '/categories/:id',
  requireAdmin,
  wrap(async (req, res) => {
    // Os produtos ficam sem categoria (ON DELETE SET NULL), não somem.
    const row = await one(`DELETE FROM categories WHERE id = $1 RETURNING id`, [req.params.id])
    if (!row) throw notFound('Categoria não encontrada.')
    res.json({ ok: true })
  }),
)

catalogRoutes.post(
  '/products',
  requireAdmin,
  wrap(async (req, res) => {
    const d = parse(schemas.product, req.body)
    const row = await one(
      `INSERT INTO products
         (category_id, name, sku, description, price, promo, stock, unit,
          art, tint, image, specs, featured, active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14)
       RETURNING *`,
      [
        d.categoryId, d.name, d.sku, d.description, d.price, d.promo, d.stock,
        d.unit, d.art, d.tint, d.image, JSON.stringify(d.specs), d.featured, d.active,
      ],
    )
    res.status(201).json({ product: s.product(row) })
  }),
)

catalogRoutes.put(
  '/products/:id',
  requireAdmin,
  wrap(async (req, res) => {
    const d = parse(schemas.product, req.body)
    const row = await one(
      `UPDATE products SET
         category_id=$1, name=$2, sku=$3, description=$4, price=$5, promo=$6,
         stock=$7, unit=$8, art=$9, tint=$10, image=$11, specs=$12::jsonb,
         featured=$13, active=$14
       WHERE id=$15 RETURNING *`,
      [
        d.categoryId, d.name, d.sku, d.description, d.price, d.promo, d.stock,
        d.unit, d.art, d.tint, d.image, JSON.stringify(d.specs), d.featured,
        d.active, req.params.id,
      ],
    )
    if (!row) throw notFound('Produto não encontrado.')
    res.json({ product: s.product(row) })
  }),
)

catalogRoutes.put(
  '/products/:id/active',
  requireAdmin,
  wrap(async (req, res) => {
    const row = await one(
      `UPDATE products SET active = NOT active WHERE id = $1 RETURNING *`,
      [req.params.id],
    )
    if (!row) throw notFound('Produto não encontrado.')
    res.json({ product: s.product(row) })
  }),
)

catalogRoutes.delete(
  '/products/:id',
  requireAdmin,
  wrap(async (req, res) => {
    const row = await one(`DELETE FROM products WHERE id = $1 RETURNING id`, [req.params.id])
    if (!row) throw notFound('Produto não encontrado.')
    res.json({ ok: true })
  }),
)
