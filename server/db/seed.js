import { CATEGORIES, PRODUCTS, SETTINGS, CUSTOMERS, makeDemoOrders } from '../../src/data/seed.js'
import { pool, transaction } from './pool.js'
import { hashPassword } from '../lib/auth.js'

/**
 * Carrega o catálogo inicial no banco.
 *
 * Reaproveita `src/data/seed.js`, o mesmo arquivo que alimentava a loja antes
 * do servidor — assim não existem duas versões do catálogo para manter.
 *
 * É idempotente por conflito de chave natural (slug, e-mail): rodar de novo
 * atualiza em vez de duplicar. Pedidos de demonstração só entram se a tabela
 * estiver vazia, para não multiplicar a cada execução.
 */

const ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? 'admin@totalpack.com.br'
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? 'admin12345'
const DEMO_CUSTOMER_PASSWORD = process.env.SEED_CUSTOMER_PASSWORD ?? 'cliente12345'

const run = async () => {
  await transaction(async (client) => {
    /* ---- Administrador ---- */
    await client.query(
      `INSERT INTO admins (email, name, password_hash)
       VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash`,
      [ADMIN_EMAIL, 'Administrador', await hashPassword(ADMIN_PASSWORD)],
    )

    /* ---- Configurações ---- */
    await client.query(
      `INSERT INTO settings (id, store_name, tagline, email, phone, address, hours,
                             instagram, pix_key, free_shipping_from,
                             low_stock_threshold)
       VALUES (true,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO UPDATE SET
         store_name = EXCLUDED.store_name, tagline = EXCLUDED.tagline`,
      [
        SETTINGS.storeName, SETTINGS.tagline, SETTINGS.email, SETTINGS.phone,
        SETTINGS.address, SETTINGS.hours, SETTINGS.instagram, SETTINGS.pixKey,
        SETTINGS.freeShippingFrom, SETTINGS.lowStockThreshold,
      ],
    )

    /* ---- Categorias ---- */
    const categoryIds = new Map()
    for (const c of CATEGORIES) {
      const { rows } = await client.query(
        `INSERT INTO categories (name, slug, description, position)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (slug) DO UPDATE SET
           name = EXCLUDED.name, description = EXCLUDED.description,
           position = EXCLUDED.position
         RETURNING id`,
        [c.name, c.slug, c.description, c.order],
      )
      categoryIds.set(c.id, rows[0].id)
    }

    /* ---- Produtos ---- */
    const productIds = new Map()
    for (const p of PRODUCTS) {
      const { rows } = await client.query(
        `INSERT INTO products
           (category_id, name, sku, description, price, promo, stock, unit,
            art, tint, specs, featured, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13)
         ON CONFLICT DO NOTHING
         RETURNING id`,
        [
          categoryIds.get(p.categoryId) ?? null, p.name, p.sku, p.description,
          p.price, p.promo, p.stock, p.unit, p.art, p.tint,
          JSON.stringify(p.specs ?? []), p.featured, p.active,
        ],
      )

      if (rows[0]) {
        productIds.set(p.id, rows[0].id)
      } else {
        // Já existia: recupera o id pelo SKU para os pedidos de demonstração.
        const { rows: found } = await client.query(
          `SELECT id FROM products WHERE sku = $1 LIMIT 1`,
          [p.sku],
        )
        if (found[0]) productIds.set(p.id, found[0].id)
      }
    }

    /* ---- Zonas de entrega ---- */
    for (const z of SETTINGS.shippingZones) {
      await client.query(
        `INSERT INTO shipping_zones (name, cep_start, cep_end, fee, days, active)
         SELECT $1,$2,$3,$4,$5,$6
          WHERE NOT EXISTS (SELECT 1 FROM shipping_zones WHERE name = $1)`,
        [z.name, z.cepStart, z.cepEnd, z.fee, z.days, z.active],
      )
    }

    /* ---- Cliente de demonstração ---- */
    const customerIds = new Map()
    for (const c of CUSTOMERS) {
      const { rows } = await client.query(
        `INSERT INTO customers (name, email, phone, password_hash)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [c.name, c.email, c.phone, await hashPassword(DEMO_CUSTOMER_PASSWORD)],
      )
      const id = rows[0].id
      customerIds.set(c.id, id)

      for (const a of c.addresses) {
        await client.query(
          `INSERT INTO addresses
             (customer_id, label, cep, street, number, complement, district, city, state, is_default)
           SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10
            WHERE NOT EXISTS (
              SELECT 1 FROM addresses WHERE customer_id = $1 AND label = $2)`,
          [
            id, a.label, a.cep.replace(/\D/g, ''), a.address, a.number,
            a.complement, a.district, a.city, a.state, a.isDefault,
          ],
        )
      }
    }

    /* ---- Pedidos de demonstração ---- */
    const { rows: existingOrders } = await client.query(`SELECT count(*)::int AS n FROM orders`)
    if (existingOrders[0].n > 0) {
      console.log('[db] pedidos já existem — pulando os de demonstração.')
      return
    }

    for (const o of makeDemoOrders()) {
      const items = o.items.filter((i) => productIds.has(i.productId))
      if (!items.length) continue

      const subtotal = items.reduce((acc, i) => acc + i.price * i.qty, 0)
      const shipping = subtotal >= SETTINGS.freeShippingFrom ? 0 : o.shipping

      const { rows } = await client.query(
        `INSERT INTO orders (
           customer_id, status, customer_name, customer_email, customer_phone,
           delivery, delivery_zone, delivery_days,
           cep, street, number, complement, district, city, state,
           payment, note, subtotal, shipping, total, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$21)
         RETURNING id`,
        [
          o.customerId ? customerIds.get(o.customerId) ?? null : null,
          o.status, o.customer.name, o.customer.email, o.customer.phone,
          o.delivery, o.deliveryZone, o.deliveryDays,
          o.customer.cep.replace(/\D/g, ''), o.customer.address, o.customer.number,
          o.customer.complement, o.customer.district, o.customer.city, o.customer.state,
          o.payment, o.note, subtotal, shipping, subtotal + shipping, o.createdAt,
        ],
      )

      for (const i of items) {
        await client.query(
          `INSERT INTO order_items (order_id, product_id, name, sku, art, tint, price, qty)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [
            rows[0].id, productIds.get(i.productId), i.name, i.sku,
            i.art, i.tint, i.price, i.qty,
          ],
        )
      }
    }
  })

  console.log('\n[db] catálogo carregado.')
  console.log(`[db] admin:   ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`)
  console.log(`[db] cliente: ${CUSTOMERS[0].email} / ${DEMO_CUSTOMER_PASSWORD}`)
  console.log('[db] troque essas senhas antes de qualquer uso real.\n')

  await pool.end()
}

run().catch(async (err) => {
  console.error('[db] falha ao carregar o catálogo:', err.message)
  await pool.end()
  process.exit(1)
})
