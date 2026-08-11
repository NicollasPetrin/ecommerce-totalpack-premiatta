import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useStore } from '../store/StoreContext'
import { discountPct, effectivePrice, money } from '../lib/format'
import ProductArt from '../components/ProductArt'
import ProductCard from '../components/ProductCard'
import QtyStepper from '../components/QtyStepper'
import ShippingCalculator from '../components/ShippingCalculator'
import Icon from '../components/Icon'

export default function Product() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { productById, categoryById, products, addToCart, setCartOpen, settings } = useStore()
  const [qty, setQty] = useState(1)
  /* Escolha por eixo: { Cor: 'Azul', Tamanho: 'P' }. Null enquanto o cliente
     não mexe, para o padrão poder ser recalculado se o produto mudar. */
  const [escolhas, setEscolhas] = useState(null)

  const product = productById[id]

  if (!product || !product.active) {
    return (
      <div className="wrap empty" style={{ minHeight: '58vh' }}>
        <Icon name="box" size={48} strokeWidth={1.2} />
        <h3>Produto não encontrado</h3>
        <p>Este item pode ter saído do catálogo.</p>
        <Link to="/catalogo" className="btn btn--primary">
          Voltar ao catálogo
        </Link>
      </div>
    )
  }

  const category = categoryById[product.categoryId]

  /* Com variação, tudo que é preço e estoque passa a vir dela. */
  const eixos = product.variantAxes ?? []
  const variacoes = (product.variants ?? []).filter((v) => v.active)
  const temVariacoes = eixos.length > 0 && variacoes.length > 0

  /* Ponto de partida: a primeira combinação com estoque. Abrir a página já
     num item esgotado obrigaria o cliente a descobrir sozinho que precisa
     trocar. */
  const padrao = variacoes.find((v) => v.stock > 0) ?? variacoes[0]
  const atuais = escolhas ?? padrao?.options ?? {}

  const casa = (v, alvo) => eixos.every((a) => v.options?.[a.name] === alvo[a.name])
  const escolhida = temVariacoes ? variacoes.find((v) => casa(v, atuais)) ?? null : null

  /** Existe combinação para esta opção, mantendo o resto do que já foi escolhido? */
  const disponivel = (eixo, opcao) =>
    variacoes.some((v) => {
      if (v.options?.[eixo] !== opcao) return false
      return eixos.every((a) => a.name === eixo || v.options?.[a.name] === atuais[a.name])
    })

  const comEstoque = (eixo, opcao) =>
    variacoes.some((v) => {
      if (v.options?.[eixo] !== opcao || v.stock <= 0) return false
      return eixos.every((a) => a.name === eixo || v.options?.[a.name] === atuais[a.name])
    })

  /* Combinação inexistente (grade incompleta) não tem preço nem estoque: cai
     no produto pai só para a tela não quebrar, e o botão fica travado. */
  const origem = escolhida ?? (temVariacoes ? { price: 0, promo: 0, stock: 0, sku: '' } : product)
  const price = effectivePrice(origem)
  const off = discountPct(origem.price, origem.promo)
  const out = origem.stock <= 0
  const low = !out && origem.stock <= settings.lowStockThreshold

  const related = products
    .filter((p) => p.active && p.categoryId === product.categoryId && p.id !== product.id)
    .slice(0, 4)

  const buyNow = () => {
    addToCart(product, qty, escolhida)
    if (!out) navigate('/checkout')
  }

  return (
    <div className="wrap pdp">
      <nav className="crumbs" aria-label="Trilha">
        <Link to="/">Início</Link>
        <Icon name="chevronRight" size={13} />
        {category && (
          <>
            <Link to={`/catalogo?cat=${category.slug}`}>{category.name}</Link>
            <Icon name="chevronRight" size={13} />
          </>
        )}
        <span>{product.name}</span>
      </nav>

      <div className="pdp__grid">
        <div className="pdp__media">
          <ProductArt product={product} className="pdp__art" />
          {off > 0 && <span className="pdp__badge">−{off}%</span>}
        </div>

        <div className="pdp__info">
          {category && (
            <Link to={`/catalogo?cat=${category.slug}`} className="pdp__cat">
              {category.name}
            </Link>
          )}

          <h1>{product.name}</h1>

          <div className="pdp__price">
            <strong>{money(price)}</strong>
            {off > 0 && (
              <>
                <s>{money(origem.price)}</s>
                <span className="tag tag--green">Economize {money(origem.price - price)}</span>
              </>
            )}
          </div>
          <p className="pdp__unit">
            Preço por {product.unit} · SKU {escolhida?.sku || product.sku}
          </p>

          <p className="pdp__desc">{product.description}</p>

          {temVariacoes &&
            eixos.map((eixo) => (
              <div className="pdp__variants" key={eixo.name}>
                <span className="pdp__variants-label">
                  {eixo.name}: <strong>{atuais[eixo.name] ?? '—'}</strong>
                </span>
                <div className="pdp__variants-list" role="radiogroup" aria-label={eixo.name}>
                  {eixo.options.map((opcao) => {
                    const existe = disponivel(eixo.name, opcao)
                    const temEstoque = comEstoque(eixo.name, opcao)
                    const marcada = atuais[eixo.name] === opcao
                    return (
                      <button
                        key={opcao}
                        type="button"
                        role="radio"
                        aria-checked={marcada}
                        disabled={!existe}
                        className={`vopt${marcada ? ' is-on' : ''}${
                          existe && !temEstoque ? ' is-out' : ''
                        }`}
                        onClick={() => {
                          const alvo = { ...atuais, [eixo.name]: opcao }
                          /* Trocar um eixo pode deixar a combinação sem
                             correspondente. Nesse caso puxamos a variação mais
                             próxima que tenha esta opção, em vez de deixar o
                             cliente num ponto vazio da grade. */
                          const achou = variacoes.find((v) => casa(v, alvo))
                          const proxima =
                            achou ??
                            variacoes.find(
                              (v) => v.options?.[eixo.name] === opcao && v.stock > 0,
                            ) ??
                            variacoes.find((v) => v.options?.[eixo.name] === opcao)

                          setEscolhas(proxima ? proxima.options : alvo)
                          // A quantidade pode não caber na combinação nova.
                          setQty((q) => Math.max(1, Math.min(q, proxima?.stock || 1)))
                        }}
                      >
                        {opcao}
                        {existe && !temEstoque && <em>esgotado</em>}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}

          <div className="pdp__stock">
            {out ? (
              <span className="tag tag--red">
                <Icon name="alert" size={14} /> Esgotado
              </span>
            ) : low ? (
              <span className="tag tag--orange">
                <Icon name="alert" size={14} /> Últimas {origem.stock} unidades
              </span>
            ) : (
              <span className="tag tag--green">
                <Icon name="check" size={14} /> Em estoque · {origem.stock} disponíveis
              </span>
            )}
          </div>

          <div className="pdp__buy">
            <QtyStepper value={qty} onChange={setQty} max={Math.max(1, origem.stock)} />
            <button
              className="btn btn--primary btn--lg"
              disabled={out}
              onClick={() => {
                addToCart(product, qty, escolhida)
                setCartOpen(true)
              }}
            >
              <Icon name="bag" size={18} /> Adicionar à sacola
            </button>
            <button className="btn btn--outline btn--lg" disabled={out} onClick={buyNow}>
              Comprar agora
            </button>
          </div>

          {qty > 1 && !out && (
            <p className="pdp__subtotal">
              Subtotal: <strong>{money(price * qty)}</strong>
            </p>
          )}

          <div className="pdp__ship">
            <ShippingCalculator />
          </div>

          <ul className="pdp__perks">
            <li>
              <Icon name="truck" size={18} />
              Frete grátis acima de {money(settings.freeShippingFrom)}
            </li>
            <li>
              <Icon name="box" size={18} />
              Entrega para todo o Brasil
            </li>
            <li>
              <Icon name="shield" size={18} />
              PIX, cartão ou boleto
            </li>
          </ul>

          {product.specs?.length > 0 && (
            <div className="pdp__specs">
              <h2>Especificações</h2>
              <ul>
                {product.specs.map((s) => (
                  <li key={s}>
                    <Icon name="check" size={15} />
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {related.length > 0 && (
        <section className="section">
          <header className="section__head">
            <div>
              <h2>Quem compra este, leva também</h2>
            </div>
          </header>
          <div className="grid grid--4">
            {related.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
