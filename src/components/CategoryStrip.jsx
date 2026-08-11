import { Link, useSearchParams } from 'react-router-dom'
import { useStore } from '../store/StoreContext'
import ProductArt from './ProductArt'
import Icon from './Icon'

/**
 * Atalhos redondos de categoria, na linha do que os atacados de papelaria
 * fazem na home (Reval, VPA): a categoria fica a um toque de qualquer
 * página, sem precisar abrir o menu sanduíche.
 *
 * Só aparece nas telas estreitas — no desktop as categorias já estão na
 * barra do cabeçalho, e repetir seria ruído.
 */
export default function CategoryStrip() {
  const { categories, products } = useStore()
  const [params] = useSearchParams()
  const atual = params.get('cat')

  const ordenadas = [...categories].sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
  if (!ordenadas.length) return null

  const live = products.filter((p) => p.active)

  return (
    <nav className="catstrip" aria-label="Atalhos de categoria">
      <div className="catstrip__track">
        <Link to="/catalogo" className={`catshort${!atual ? ' is-on' : ''}`}>
          <span className="catshort__art catshort__art--all">
            <Icon name="grid" size={22} />
          </span>
          <span className="catshort__name">Tudo</span>
        </Link>

        {ordenadas.map((c) => {
          const amostra = live.find((p) => p.categoryId === c.id)
          return (
            <Link
              key={c.id}
              to={`/catalogo?cat=${c.slug}`}
              className={`catshort${atual === c.slug ? ' is-on' : ''}`}
            >
              <span className="catshort__art">
                {amostra ? <ProductArt product={amostra} /> : <Icon name="box" size={22} />}
              </span>
              <span className="catshort__name">{c.name}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
