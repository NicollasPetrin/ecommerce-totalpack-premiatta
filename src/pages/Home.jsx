import { Link } from 'react-router-dom'
import { useStore } from '../store/StoreContext'
import { money } from '../lib/format'
import ProductCard from '../components/ProductCard'
import ProductArt from '../components/ProductArt'
import HeroCarousel from '../components/HeroCarousel'
import Logo from '../components/Logo'
import Icon from '../components/Icon'

/**
 * Página inicial deliberadamente simples.
 *
 * O público da loja não tem familiaridade com compras online, então aqui vale
 * menos seção, texto mais direto, botão grande e um passo a passo explícito de
 * como comprar. Toda a navegação principal cabe em dois blocos: categorias e
 * produtos mais pedidos.
 */
export default function Home() {
  const { products, categories, settings } = useStore()

  const live = products.filter((p) => p.active)
  const featured = live.filter((p) => p.featured).slice(0, 4)
  const ordered = [...categories].sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
  const countOf = (catId) => live.filter((p) => p.categoryId === catId).length

  /* Vitrine do carrossel: destaques primeiro, completados com promoções até
     dar um giro que valha a pena. */
  const carouselItems = [
    ...live.filter((p) => p.featured),
    ...live.filter((p) => !p.featured && p.promo > 0 && p.promo < p.price),
  ].slice(0, 8)

  /* Prateleira própria para as ofertas, como fazem os atacados de papelaria.
     Some sozinha quando não há promoção — seção vazia é pior que seção
     nenhuma. */
  const promos = live.filter((p) => p.promo > 0 && p.promo < p.price).slice(0, 4)

  const mailLink = `mailto:${settings.email}?subject=${encodeURIComponent(
    'Ajuda com um pedido de material escolar',
  )}`

  return (
    <>
      {/* ------------------------------------------------------------ Abertura */}
      <section className="open">
        <div className="wrap open__inner">
          <Logo size={104} className="open__logo" />

          <h1 className="open__title">Material escolar completo</h1>

          <p className="open__sub">
            Papel A4, colorset, cadernos e tudo o que a lista da escola pede.
            Você escolhe aqui e a gente entrega na sua casa.
          </p>

          <div className="open__cta">
            <Link to="/catalogo" className="btn btn--primary btn--xl">
              Ver todos os produtos
            </Link>
          </div>

          <p className="open__note">
            <Icon name="truck" size={18} />
            Entrega grátis em pedidos acima de {money(settings.freeShippingFrom)}
          </p>

          <HeroCarousel products={carouselItems} />
        </div>
      </section>

      {/* ---------------------------------------------------------- Categorias */}
      <section className="wrap section">
        <h2 className="simple-title">O que você está procurando?</h2>
        <p className="simple-sub">Toque em uma opção para ver os produtos.</p>

        <div className="bigcats">
          {ordered.map((c) => {
            const sample = live.find((p) => p.categoryId === c.id)
            return (
              <Link key={c.id} to={`/catalogo?cat=${c.slug}`} className="bigcat">
                <span className="bigcat__art">{sample && <ProductArt product={sample} />}</span>
                <span className="bigcat__name">{c.name}</span>
                <span className="bigcat__count">{countOf(c.id)} produtos</span>
              </Link>
            )
          })}
        </div>
      </section>

      {/* ------------------------------------------------------ Mais pedidos */}
      <section className="band">
        <div className="wrap section">
          <h2 className="simple-title">Os mais pedidos</h2>
          <p className="simple-sub">Os itens que mais saem para escolas e famílias.</p>

          <div className="grid grid--4">
            {featured.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>

          <div className="simple-more">
            <Link to="/catalogo" className="btn btn--primary btn--lg">
              Ver todos os produtos <Icon name="arrowRight" size={17} />
            </Link>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------- Promoções */}
      {promos.length > 0 && (
        <section className="wrap section">
          <h2 className="simple-title">Promoções da semana</h2>
          <p className="simple-sub">Preço menor enquanto durar o estoque.</p>

          <div className="grid grid--4">
            {promos.map((p) => (
              <ProductCard key={p.id} product={p} />
            ))}
          </div>
        </section>
      )}

      {/* ------------------------------------------------------ Como comprar */}
      <section className="wrap section">
        <h2 className="simple-title">Como comprar</h2>
        <p className="simple-sub">São três passos. Leva menos de dois minutos.</p>

        <ol className="steps">
          <li>
            <span className="steps__num">1</span>
            <h3>Escolha os produtos</h3>
            <p>
              Em cada produto, toque no botão vermelho <strong>Adicionar à sacola</strong>.
              Você pode escolher quantos quiser.
            </p>
          </li>
          <li>
            <span className="steps__num">2</span>
            <h3>Abra a sacola</h3>
            <p>
              Toque no ícone da sacola <Icon name="bag" size={17} /> no alto da tela e
              confira os itens. Depois toque em <strong>Finalizar pedido</strong>.
            </p>
          </li>
          <li>
            <span className="steps__num">3</span>
            <h3>Pague e pronto</h3>
            <p>
              Preencha nome, telefone e endereço. Em seguida você vai direto
              para o pagamento: Pix, boleto ou cartão.{' '}
              <strong>Os dados do cartão não passam pela nossa loja.</strong>
            </p>
          </li>
        </ol>
      </section>

      {/* ------------------------------------------------------------- Ajuda */}
      <section className="wrap section section--tight">
        <div className="help">
          <h2>Ficou com dúvida?</h2>
          <p>
            Se preferir, mande a lista da escola por e-mail que a gente monta o
            pedido e o orçamento para você.
          </p>

          <a className="btn btn--primary btn--xl" href={mailLink}>
            <Icon name="mail" size={20} /> Enviar e-mail
          </a>

          <div className="help__info">
            <span>
              <Icon name="clock" size={17} /> {settings.hours}
            </span>
            <span>
              <Icon name="pin" size={17} /> {settings.address}
            </span>
          </div>
        </div>
      </section>
    </>
  )
}
