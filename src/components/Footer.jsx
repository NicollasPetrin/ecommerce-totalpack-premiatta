import { Link } from 'react-router-dom'
import { useStore } from '../store/StoreContext'
import { money } from '../lib/format'
import Icon from './Icon'

export default function Footer() {
  const { settings, categories } = useStore()
  const year = new Date().getFullYear()

  return (
    <footer className="foot">
      <div className="wrap foot__grid">
        <div className="foot__brand">
          <strong>{settings.storeName}</strong>
          <p>{settings.tagline}</p>
          <div className="foot__contact">
            <a href={`https://wa.me/${settings.whatsapp}`} target="_blank" rel="noreferrer">
              <Icon name="whatsapp" size={17} /> WhatsApp
            </a>
            <a href={`mailto:${settings.email}`}>
              <Icon name="mail" size={17} /> {settings.email}
            </a>
            <span>
              <Icon name="pin" size={17} /> {settings.address}
            </span>
            <span>
              <Icon name="clock" size={17} /> {settings.hours}
            </span>
          </div>
        </div>

        <div className="foot__col">
          <h4>Categorias</h4>
          <ul>
            {[...categories]
              .sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
              .map((c) => (
                <li key={c.id}>
                  <Link to={`/catalogo?cat=${c.slug}`}>{c.name}</Link>
                </li>
              ))}
          </ul>
        </div>

        <div className="foot__col">
          <h4>Compra</h4>
          <ul>
            <li>
              <Link to="/catalogo">Todos os produtos</Link>
            </li>
            <li>
              <Link to="/checkout">Finalizar pedido</Link>
            </li>
            <li>Frete grátis acima de {money(settings.freeShippingFrom)}</li>
            <li>Pagamento por PIX, cartão ou boleto</li>
            {settings.pickupEnabled && <li>Retirada na loja sem custo</li>}
          </ul>
        </div>

        <div className="foot__col">
          <h4>Loja</h4>
          <ul>
            <li>
              <Link to="/admin">Painel administrativo</Link>
            </li>
            <li>
              <a href={`https://instagram.com/${settings.instagram}`} target="_blank" rel="noreferrer">
                Instagram
              </a>
            </li>
          </ul>
        </div>
      </div>

      <div className="wrap foot__bar">
        <span>
          © {year} {settings.storeName}. Todos os direitos reservados.
        </span>
        <span className="foot__note">Preços e estoque sujeitos a alteração.</span>
      </div>
    </footer>
  )
}
