import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../../store/StoreContext'
import Icon from '../../components/Icon'

export default function AdminLogin() {
  const { login, isAdmin, settings } = useStore()
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [show, setShow] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()

  const from = location.state?.from ?? '/admin'

  if (isAdmin) return <Navigate to={from} replace />

  const submit = (e) => {
    e.preventDefault()
    if (login(password)) {
      navigate(from, { replace: true })
    } else {
      setError('Senha incorreta. Tente novamente.')
      setPassword('')
    }
  }

  return (
    <div className="login">
      <form className="login__card" onSubmit={submit}>
        <span className="login__icon">
          <Icon name="lock" size={24} />
        </span>

        <h1>Painel administrativo</h1>
        <p>Entre para gerenciar produtos, pedidos e configurações da loja.</p>

        <div className={`field${error ? ' has-error' : ''}`}>
          <label htmlFor="pw">Senha</label>
          <div className="login__input">
            <input
              id="pw"
              className="input"
              type={show ? 'text' : 'password'}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                setError('')
              }}
              autoComplete="current-password"
              placeholder="••••••••"
            />
            <button
              type="button"
              className="icon-btn"
              onClick={() => setShow((v) => !v)}
              aria-label={show ? 'Ocultar senha' : 'Mostrar senha'}
            >
              <Icon name="eye" size={18} />
            </button>
          </div>
          {error && <span className="err">{error}</span>}
        </div>

        <button className="btn btn--primary btn--lg btn--block" type="submit">
          Entrar
        </button>

        {!settings.adminPassHash && (
          <p className="login__hint">
            Primeiro acesso? A senha padrão é <code>admin123</code>. Troque-a em
            Configurações depois de entrar.
          </p>
        )}

        <Link to="/" className="login__back">
          <Icon name="chevronLeft" size={15} /> Voltar para a loja
        </Link>
      </form>
    </div>
  )
}
