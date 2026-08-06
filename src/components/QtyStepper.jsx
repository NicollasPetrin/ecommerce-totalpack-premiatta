import Icon from './Icon'
import { clamp } from '../lib/format'

/** Controle de quantidade: − [n] + */
export default function QtyStepper({ value, onChange, min = 1, max = 999, size = 'md' }) {
  const set = (v) => onChange(clamp(v, min, max))

  return (
    <div className={`stepper${size === 'sm' ? ' stepper--sm' : ''}`}>
      <button
        type="button"
        onClick={() => set(value - 1)}
        disabled={value <= min}
        aria-label="Diminuir quantidade"
      >
        <Icon name="minus" size={size === 'sm' ? 14 : 16} />
      </button>

      <input
        type="text"
        inputMode="numeric"
        value={value}
        onChange={(e) => {
          const n = parseInt(e.target.value.replace(/\D/g, ''), 10)
          set(Number.isNaN(n) ? min : n)
        }}
        aria-label="Quantidade"
      />

      <button
        type="button"
        onClick={() => set(value + 1)}
        disabled={value >= max}
        aria-label="Aumentar quantidade"
      >
        <Icon name="plus" size={size === 'sm' ? 14 : 16} />
      </button>
    </div>
  )
}
