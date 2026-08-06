import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../../store/StoreContext'
import Icon from '../../components/Icon'

export default function AdminLogin() {
  const { login, isAdmin } = useStore()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [show, setShow] = useState(false)
  const [sending, setSending] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()

  const from = location.state?.from ?? '/admin'

  if (isAdmin) return <Navigate to={from} replace />

  const submit = async (e) => {
    e.preventDefault()
    if (sending) return

    setSending(true)
    const result = await login(email, password)
    setSending(false)

    if (result.ok) {
      navigate(from, { replace: true })
    } else {
      setError(result.error)
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

        <div className="field">
          <label htmlFor="adm-email">E-mail</label>
          <input
            id="adm-email"
            className="input"
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value)
              setError('')
            }}
            autoComplete="username"
            placeholder="admin@totalpack.com.br"
          />
        </div>

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

        <button className="btn btn--primary btn--lg btn--block" type="submit" disabled={sending}>
          {sending ? 'Entrando…' : 'Entrar'}
        </button>

        <p className="login__hint">
          As credenciais iniciais são criadas pelo <code>npm run db:seed</code> e ficam no
          arquivo <code>.env</code>. Troque a senha em Configurações após o primeiro acesso.
        </p>

        <Link to="/" className="login__back">
          <Icon name="chevronLeft" size={15} /> Voltar para a loja
        </Link>
      </form>
    </div>
  )
}
