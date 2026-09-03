import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { pool, transaction } from './pool.js'
import { parse, schemas } from '../lib/validate.js'
import { salvarVariacoes } from '../routes/catalog.js'

/**
 * Importa o catálogo real, exportado da Shopee.
 *
 * Roda contra o banco apontado por DATABASE_URL — em produção, é o do site no
 * ar. Serve para o primeiro carregamento e para repetições: a chave é o SKU,
 * então rodar duas vezes atualiza em vez de duplicar.
 *
 *   node server/db/importar-catalogo.js            # importa
 *   node server/db/importar-catalogo.js --demo     # e desativa a demonstração
 *
 * A validação é a mesma da rota do painel, de propósito: um produto que o
 * importador aceitasse e a tela recusasse seria impossível de editar depois.
 */

const AQUI = dirname(fileURLToPath(import.meta.url))
const DADOS = join(AQUI, 'catalogo-shopee.json')

const TETO_IMAGEM = 1_500_000
const TIPOS = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']

/**
 * Tamanho pedido à CDN da Shopee.
 *
 * As fotos originais têm ~280 KB cada. Embutidas no registro, os 13 produtos
 * somavam 4,8 MB de catálogo — e o catálogo inteiro é baixado por *todo*
 * visitante, porque a loja filtra no navegador. Era mais peso que a loja
 * inteira.
 *
 * A CDN redimensiona sob demanda e devolve WebP, então 400 px custam 29 KB em
 * vez de 280. Quatrocentos porque `.pdp__media` limita a foto a 460 px de
 * largura: pedir 800 dobraria o peso para uma nitidez que a tela não mostra.
 */
const TAMANHO_FOTO = '@resize_w400_nl.webp'

/**
 * Baixa a foto e devolve data URI.
 *
 * As imagens ficam embutidas no registro — o site não guarda arquivo. Falha
 * aqui não cancela o produto: catálogo sem foto é ruim, catálogo sem produto
 * é pior, e a foto pode ser posta pelo painel depois.
 */
async function baixarFoto(url) {
  if (!url) return null
  try {
    // Se a CDN não conhecer o sufixo, a original ainda serve.
    const r = await fetch(url + TAMANHO_FOTO).then((x) => (x.ok ? x : fetch(url)))
    if (!r.ok) throw new Error(`HTTP ${r.status}`)

    const tipo = (r.headers.get('content-type') ?? '').split(';')[0].trim()
    if (!TIPOS.includes(tipo)) throw new Error(`tipo não aceito: ${tipo || '?'}`)

    const bytes = Buffer.from(await r.arrayBuffer())
    const uri = `data:${tipo};base64,${bytes.toString('base64')}`
    if (uri.length > TETO_IMAGEM) throw new Error(`${(uri.length / 1024).toFixed(0)} KB acima do teto`)

    return uri
  } catch (e) {
    console.warn(`  [foto] ${e.message}`)
    return null
  }
}

/**
 * Preenche NCM e unidade fiscal onde ainda estiverem vazios.
 *
 * Separado do import inteiro porque é o único campo que pode chegar depois: o
 * catálogo entrou sem NCM, e a pesquisa fiscal veio semanas depois. Só toca no
 * que está em branco — quem corrigir um código pelo painel não vê a correção
 * ser desfeita no deploy seguinte, que é o que aconteceria com um UPDATE
 * simples.
 */
async function preencherFiscal(itens) {
  const comFiscal = itens.filter((i) => i.ncm && i.unitTrib)
  if (!comFiscal.length) return

  let n = 0
  for (const i of comFiscal) {
    const { rowCount } = await pool.query(
      `UPDATE products SET ncm = $1, unit_trib = $2
        WHERE sku = $3 AND (ncm = '' OR unit_trib = '')`,
      [i.ncm, i.unitTrib, i.sku],
    )
    n += rowCount
  }

  if (n) console.log(`[fiscal] NCM e unidade preenchidos em ${n} produto(s).`)
}

async function main() {
  const desativarDemo = process.argv.includes('--demo')
  const itens = JSON.parse(readFileSync(DADOS, 'utf8'))

  if (process.argv.includes('--fiscal')) {
    await preencherFiscal(itens)
    await pool.end()
    return
  }

  /* --se-novo: só importa se o catálogo ainda não estiver lá.
   *
   * É como o import entra em produção sem ninguém digitar comando: `npm start`
   * chama com esta bandeira, então o primeiro deploy carrega o catálogo e
   * todos os seguintes não fazem nada. Sem a guarda, cada deploy sobrescreveria
   * preço e nome editados pelo painel — que é justamente o trabalho que
   * ninguém quer refazer. */
  if (process.argv.includes('--se-novo')) {
    const { rows } = await pool.query(
      `SELECT 1 FROM products WHERE sku = ANY($1::text[]) LIMIT 1`,
      [itens.map((i) => i.sku)],
    )
    if (rows.length) {
      console.log('[catálogo] já importado; nada a fazer.')
      await pool.end()
      return
    }
  }

  const { rows: cats } = await pool.query(`SELECT id, slug FROM categories`)
  const catPorSlug = new Map(cats.map((c) => [c.slug, c.id]))

  console.log(`[catálogo] ${itens.length} produtos a importar\n`)

  let novos = 0
  let atualizados = 0

  for (const item of itens) {
    const { categoriaSlug, imagemUrl, origem, ...produto } = item

    const categoryId = catPorSlug.get(categoriaSlug) ?? null
    if (!categoryId) console.warn(`  [categoria] "${categoriaSlug}" não existe — produto fica sem categoria`)

    const existente = await pool
      .query(`SELECT id, image FROM products WHERE sku = $1`, [produto.sku])
      .then((r) => r.rows[0])

    /* Só baixa a foto quando não há uma. Reimportar não deve gastar rede nem
       sobrescrever uma imagem que alguém trocou pelo painel — salvo com
       --refazer-fotos, para quando o tamanho pedido à CDN muda. */
    const refazerFotos = process.argv.includes('--refazer-fotos')
    const image = (!refazerFotos && existente?.image) || (await baixarFoto(imagemUrl))

    let d
    try {
      d = parse(schemas.product, { ...produto, categoryId, image })
    } catch (e) {
      console.error(`  ✗ ${produto.sku}: ${e.message} ${JSON.stringify(e.details ?? {})}`)
      continue
    }

    await transaction(async (client) => {
      const campos = [
        d.categoryId, d.name, d.sku, d.description, d.price, d.promo, d.stock,
        d.unit, d.art, d.tint, d.image, JSON.stringify(d.specs), d.featured, d.active,
        d.weightG, d.lengthCm, d.widthCm, d.heightCm, JSON.stringify(d.variantAxes),
        d.ncm, d.unitTrib, d.gtin, d.cclassTrib,
      ]

      const { rows } = existente
        ? await client.query(
            `UPDATE products SET
               category_id=$1, name=$2, sku=$3, description=$4, price=$5, promo=$6,
               stock=$7, unit=$8, art=$9, tint=$10, image=$11, specs=$12::jsonb,
               featured=$13, active=$14, weight_g=$15, length_cm=$16, width_cm=$17,
               height_cm=$18, variant_axes=$19::jsonb,
               ncm=$20, unit_trib=$21, gtin=$22, cclass_trib=$23
             WHERE id=$24 RETURNING *`,
            [...campos, existente.id],
          )
        : await client.query(
            `INSERT INTO products
               (category_id, name, sku, description, price, promo, stock, unit,
                art, tint, image, specs, featured, active,
                weight_g, length_cm, width_cm, height_cm, variant_axes,
                ncm, unit_trib, gtin, cclass_trib)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13,$14,
                     $15,$16,$17,$18,$19,$20,$21,$22,$23)
             RETURNING *`,
            campos,
          )

      await salvarVariacoes(client, rows[0].id, d.variants)
    })

    existente ? atualizados++ : novos++
    console.log(
      `  ${existente ? '↻' : '+'} ${d.sku.padEnd(22)} ${String(d.variants.length).padStart(3)} var  ` +
      `${image ? 'com foto' : 'SEM FOTO'}  ${d.name.slice(0, 46)}`,
    )
  }

  console.log(`\n[catálogo] ${novos} novos, ${atualizados} atualizados`)

  if (desativarDemo) {
    /* Desativa, nunca apaga: o catálogo de demonstração pode ter pedido antigo
       apontando para ele, e apagar levaria o histórico junto. Reverter é um
       clique no painel. */
    const skus = itens.map((i) => i.sku)
    const { rows } = await pool.query(
      `UPDATE products SET active = false
        WHERE active AND NOT (sku = ANY($1::text[]))
        RETURNING sku, name`,
      [skus],
    )
    console.log(`[demonstração] ${rows.length} produtos desativados`)
    for (const r of rows) console.log(`  – ${r.sku.padEnd(22)} ${r.name.slice(0, 46)}`)
  }

  await pool.end()
}

main().catch((e) => {
  console.error('[catálogo] falhou:', e.message)
  process.exit(1)
})
