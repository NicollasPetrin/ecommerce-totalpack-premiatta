import { Link } from 'react-router-dom'
import Icon from '../components/Icon'

export default function NotFound() {
  return (
    <div className="notfound">
      <Icon name="box" size={52} strokeWidth={1.1} />
      <h1>Página não encontrada</h1>
      <p>O endereço que você acessou não existe ou foi movido.</p>
      <div className="row gap-3">
        <Link to="/" className="btn btn--primary">
          Ir para a loja
        </Link>
        <Link to="/admin" className="btn btn--outline">
          Painel administrativo
        </Link>
      </div>
    </div>
  )
}
