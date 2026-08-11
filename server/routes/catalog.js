import { Router } from 'express'
import { many, one, transaction } from '../db/pool.js'
import { wrap, notFound, conflict } from '../lib/http.js'
import { parse, schemas, validarUuid } from '../lib/validate.js'
import { requireAdmin } from '../lib/auth.js'
import * as s from '../lib/serialize.js'

export const catalogRoutes = Router()

catalogRoutes.param('id', validarUuid)

/**
 * Produto com as suas variações embutidas.
 *
 * O `$1` é a flag de admin: o visitante só enxerga variação ativa, do mesmo
 * jeito que só enxerga produto ativo. O LATERAL evita repetir a linha do
 * produto uma vez por variação, que é o que um JOIN comum faria.
 */
const COM_VARIACOES = `
  SELECT p.*, COALESCE(v.variants, '[]'::json) AS variants
    FROM products p
    LEFT JOIN LATERAL (
      SELECT json_agg(x ORDER BY x.position, x.name) AS variants
        FROM product_variants x
       WHERE x.product_id = p.id AND ($1::boolean OR x.active)
    ) v ON true`

/**
 * Grava a lista de variações de um produto.
 *
 * As que já existiam são atualizadas pelo id em vez de apagadas e recriadas:
 * os itens de pedido apontam para elas, e recriar quebraria esse vínculo com
 * o histórico. O que sumiu da lista é removido de fato.
 */
async function salvarVariacoes(client, productId, variantes) {
  const manter = variantes.map((v) => v.id).filter(Boolean)

  await client.query(
    `DELETE FROM product_variants
      WHERE product_id = $1 AND NOT (id = ANY($2::uuid[]))`,
    [productId, manter],
  )

  for (const [i, v] of variantes.entries()) {
    const opcoes = JSON.stringify(v.options ?? {})
    if (v.id) {
      await client.query(
        `UPDATE product_variants
            SET name=$1, options=$2::jsonb, sku=$3, gtin=$4, price=$5, promo=$6,
                stock=$7, active=$8, position=$9
          WHERE id=$10 AND product_id=$11`,
        [v.name, opcoes, v.sku, v.gtin, v.price, v.promo, v.stock, v.active, i, v.id, productId],
      )
    } else {
      await client.query(
        `INSERT INTO product_variants
           (product_id, name, options, sku, gtin, price, promo, stock, active, position)
         VALUES ($1,$2,$3::jsonb,$4,$5,$6,$7,$8,$9,$10)`,
        [productId, v.name, opcoes, v.sku, v.gtin, v.price, v.promo, v.stock, v.active, i],
      )
    }
  }

  const { rows } = await client.query(
    `SELECT * FROM product_variants WHERE product_id = $1 ORDER BY position, name`,
    [productId],
  )
  return rows
}

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
      `${COM_VARIACOES}
        WHERE ($1::boolean OR p.active)
        ORDER BY p.featured DESC, p.name`,
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
      `${COM_VARIACOES} WHERE p.id = $2 AND ($1::boolean OR p.active)`,
      [isAdmin, req.params.id],
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
    const row = await transaction(async (client) => {
      const { rows } = await client.query(
        `INSERT INTO products
           (category_id, name, sku, description, price, promo, stock, unit,
            art, tint, image, specs, featured, active,
            weight_g, length_cm, width_cm, height_cm, variant_axes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,
                 $15,$16,$17,$18,$19)
         RETURNING *`,
        [
          d.categoryId, d.name, d.sku, d.description, d.price, d.promo, d.stock,
          d.unit, d.art, d.tint, d.image, JSON.stringify(d.specs), d.featured, d.active,
          d.weightG, d.lengthCm, d.widthCm, d.heightCm, JSON.stringify(d.variantAxes),
        ],
      )
      const produto = rows[0]
      produto.variants = await salvarVariacoes(client, produto.id, d.variants)
      return produto
    })
    res.status(201).json({ product: s.product(row) })
  }),
)

catalogRoutes.put(
  '/products/:id',
  requireAdmin,
  wrap(async (req, res) => {
    const d = parse(schemas.product, req.body)
    const row = await transaction(async (client) => {
      const { rows } = await client.query(
        `UPDATE products SET
           category_id=$1, name=$2, sku=$3, description=$4, price=$5, promo=$6,
           stock=$7, unit=$8, art=$9, tint=$10, image=$11, specs=$12::jsonb,
           featured=$13, active=$14,
           weight_g=$15, length_cm=$16, width_cm=$17, height_cm=$18,
           variant_axes=$19::jsonb
         WHERE id=$20 RETURNING *`,
        [
          d.categoryId, d.name, d.sku, d.description, d.price, d.promo, d.stock,
          d.unit, d.art, d.tint, d.image, JSON.stringify(d.specs), d.featured,
          d.active, d.weightG, d.lengthCm, d.widthCm, d.heightCm, JSON.stringify(d.variantAxes),
          req.params.id,
        ],
      )
      const produto = rows[0]
      if (!produto) return null
      produto.variants = await salvarVariacoes(client, produto.id, d.variants)
      return produto
    })
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
