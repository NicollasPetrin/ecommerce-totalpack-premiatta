import { useState } from 'react'
import { useStore } from '../store/StoreContext'
import { money } from '../lib/format'
import { formatCep, normalizeCep, zoneDeadline } from '../lib/shipping'
import Icon from './Icon'

/**
 * Consulta de frete por CEP.
 *
 * O CEP fica guardado no contexto, então quem calcular aqui já encontra o
 * campo preenchido no checkout — o cliente não digita duas vezes.
 */
export default function ShippingCalculator({ compact = false }) {
  const { cep, setCep, zone, outOfRange, settings, freeShipping } = useStore()
  const [draft, setDraft] = useState(() => formatCep(cep))
  const [touched, setTouched] = useState(false)

  const incomplete = touched && !normalizeCep(draft)

  const submit = (e) => {
    e.preventDefault()
    setTouched(true)
    const normalized = normalizeCep(draft)
    if (normalized) setCep(normalized)
  }

  const change = (e) => {
    const value = formatCep(e.target.value)
    setDraft(value)
    setTouched(false)
    const normalized = normalizeCep(value)
    // Assim que os 8 dígitos aparecem, o resultado sai sozinho.
    if (normalized) setCep(normalized)
  }

  const showResult = Boolean(normalizeCep(draft)) && normalizeCep(draft) === cep

  return (
    <div className={`shipcalc${compact ? ' shipcalc--compact' : ''}`}>
      <form onSubmit={submit}>
        <label htmlFor={`cep-${compact ? 'cart' : 'pdp'}`}>
          <Icon name="truck" size={17} />
          Calcular entrega
        </label>

        <div className="shipcalc__row">
          <input
            id={`cep-${compact ? 'cart' : 'pdp'}`}
            className="input"
            value={draft}
            onChange={change}
            inputMode="numeric"
            autoComplete="postal-code"
            placeholder="Digite seu CEP"
            maxLength={9}
          />
          <button type="submit" className="btn btn--secondary">
            Ver preço
          </button>
        </div>
      </form>

      {incomplete && <p className="shipcalc__msg shipcalc__msg--warn">CEP incompleto.</p>}

      {showResult && zone && (
        <p className="shipcalc__msg shipcalc__msg--ok">
          <Icon name="checkCircle" size={16} />
          <span>
            <strong>{zone.name}</strong> — {freeShipping ? 'frete grátis' : money(zone.fee)} ·
            chega em {zoneDeadline(zone)}
          </span>
        </p>
      )}

      {showResult && outOfRange && (
        <p className="shipcalc__msg shipcalc__msg--warn">
          <Icon name="alert" size={16} />
          <span>
            Ainda não entregamos nesse CEP.{' '}
            <a href={`mailto:${settings.email}`}>Fale conosco por e-mail</a>.
          </span>
        </p>
      )}
    </div>
  )
}
