import { createPortal } from 'react-dom'
import { useStore } from '../store/StoreContext'
import Icon from './Icon'

export default function Toaster() {
  const { toasts } = useStore()

  return createPortal(
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast--${t.kind}`}>
          <Icon name={t.kind === 'err' ? 'alert' : 'checkCircle'} size={19} />
          <span>{t.message}</span>
        </div>
      ))}
    </div>,
    document.body,
  )
}
