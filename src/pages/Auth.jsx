import { useState } from 'react'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store/StoreContext'
import { maskPhone } from '../lib/format'
import Icon from '../components/Icon'

/** Entrar e criar conta na mesma tela, alternando entre os dois modos. */
export default function Auth() {
  const { currentCustomer, loginCustomer, signup, toast, customers } = useStore()
  const navigate = useNavigate()
  const location = useLocation()

  const [mode, setMode] = useState('entrar')
  const [f, setF] = useState({ name: '', email: '', phone: '', password: '', confirm: '' })
  const [errors, setErrors] = useState({})
  const [show, setShow] = useState(false)

  const from = location.state?.from ?? '/conta'

  if (currentCustomer) return <Navigate to={from} replace />

  const set = (key) => (e) => {
    const v = key === 'phone' ? maskPhone(e.target.value) : e.target.value
    setF((old) => ({ ...old, [key]: v }))
    setErrors((x) => ({ ...x, [key]: undefined, geral: undefined }))
  }

  const switchMode = (next) => {
    setMode(next)
    setErrors({})
  }

  const submit = (e) => {
    e.preventDefault()
    const err = {}

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) err.email = 'E-mail inválido.'
    if (f.password.length < 6) err.password = 'A senha precisa ter ao menos 6 caracteres.'

    if (mode === 'criar') {
      if (f.name.trim().length < 3) err.name = 'Informe seu nome completo.'
      if (f.phone.replace(/\D/g, '').length < 10) err.phone = 'Telefone incompleto.'
      if (f.password !== f.confirm) err.confirm = 'As senhas não conferem.'
    }

    setErrors(err)
    if (Object.keys(err).length) return

    const result =
      mode === 'entrar'
        ? loginCustomer(f.email, f.password)
        : signup({ name: f.name, email: f.email, phone: f.phone, password: f.password })

    if (!result.ok) {
      setErrors({ geral: result.error })
      return
    }

    toast(mode === 'entrar' ? `Bem-vindo de volta, ${result.account.name.split(' ')[0]}!` : 'Conta criada.')
    navigate(from, { replace: true })
  }

  // Só mostra a dica da conta de teste enquanto ela existir intocada.
  const demo = customers.find((c) => c.id === 'cus_demo' && c.passHash === null)

  return (
    <div className="wrap auth">
      <div className="auth__card">
        <span className="auth__icon">
          <Icon name="user" size={24} />
        </span>

        <h1>{mode === 'entrar' ? 'Entrar na sua conta' : 'Criar conta'}</h1>
        <p className="auth__lead">
          {mode === 'entrar'
            ? 'Acesse seus endereços salvos e o histórico de pedidos.'
            : 'Guarde seus endereços e acompanhe seus pedidos anteriores.'}
        </p>

        <div className="segmented auth__tabs" role="tablist">
          <button
            role="tab"
            aria-selected={mode === 'entrar'}
            className={mode === 'entrar' ? 'is-on' : ''}
            onClick={() => switchMode('entrar')}
            type="button"
          >
            Já tenho conta
          </button>
          <button
            role="tab"
            aria-selected={mode === 'criar'}
            className={mode === 'criar' ? 'is-on' : ''}
            onClick={() => switchMode('criar')}
            type="button"
          >
            Criar conta
          </button>
        </div>

        <form onSubmit={submit} noValidate className="stack gap-4">
          {mode === 'criar' && (
            <div className={`field${errors.name ? ' has-error' : ''}`}>
              <label htmlFor="au-name">Nome completo</label>
              <input
                id="au-name"
                className="input"
                value={f.name}
                onChange={set('name')}
                autoComplete="name"
                placeholder="Maria Silva"
              />
              {errors.name && <span className="err">{errors.name}</span>}
            </div>
          )}

          <div className={`field${errors.email ? ' has-error' : ''}`}>
            <label htmlFor="au-email">E-mail</label>
            <input
              id="au-email"
              className="input"
              type="email"
              value={f.email}
              onChange={set('email')}
              autoComplete="email"
              placeholder="maria@email.com"
            />
            {errors.email && <span className="err">{errors.email}</span>}
          </div>

          {mode === 'criar' && (
            <div className={`field${errors.phone ? ' has-error' : ''}`}>
              <label htmlFor="au-phone">Telefone</label>
              <input
                id="au-phone"
                className="input"
                value={f.phone}
                onChange={set('phone')}
                inputMode="tel"
                autoComplete="tel"
                placeholder="(11) 91234-5678"
              />
              {errors.phone && <span className="err">{errors.phone}</span>}
            </div>
          )}

          <div className={`field${errors.password ? ' has-error' : ''}`}>
            <label htmlFor="au-pass">Senha</label>
            <div className="auth__pass">
              <input
                id="au-pass"
                className="input"
                type={show ? 'text' : 'password'}
                value={f.password}
                onChange={set('password')}
                autoComplete={mode === 'entrar' ? 'current-password' : 'new-password'}
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
            {errors.password && <span className="err">{errors.password}</span>}
          </div>

          {mode === 'criar' && (
            <div className={`field${errors.confirm ? ' has-error' : ''}`}>
              <label htmlFor="au-conf">Repetir a senha</label>
              <input
                id="au-conf"
                className="input"
                type="password"
                value={f.confirm}
                onChange={set('confirm')}
                autoComplete="new-password"
                placeholder="••••••••"
              />
              {errors.confirm && <span className="err">{errors.confirm}</span>}
            </div>
          )}

          {errors.geral && (
            <p className="auth__error">
              <Icon name="alert" size={16} /> {errors.geral}
            </p>
          )}

          <button className="btn btn--primary btn--lg btn--block" type="submit">
            {mode === 'entrar' ? 'Entrar' : 'Criar minha conta'}
          </button>
        </form>

        {mode === 'entrar' && demo && (
          <p className="auth__demo">
            Conta de teste: <code>{demo.email}</code> · senha <code>cliente123</code>
          </p>
        )}

        <p className="auth__guest">
          Você também pode <Link to="/catalogo">comprar sem criar conta</Link>.
        </p>
      </div>
    </div>
  )
}
