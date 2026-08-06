import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useStore } from '../store/StoreContext'
import { PAYMENT_LABEL } from '../store/StoreContext'
import { maskCep, maskPhone, money } from '../lib/format'
import ProductArt from '../components/ProductArt'
import Icon from '../components/Icon'

const EMPTY = {
  name: '',
  phone: '',
  email: '',
  cep: '',
  address: '',
  number: '',
  complement: '',
  district: '',
  city: '',
  state: '',
  delivery: 'entrega',
  payment: 'pix',
  note: '',
}

export default function Checkout() {
  const { cartLines, subtotal, shipping, total, settings, placeOrder, toast } = useStore()
  const navigate = useNavigate()
  const [form, setForm] = useState(EMPTY)
  const [errors, setErrors] = useState({})
  const [sending, setSending] = useState(false)

  const isPickup = form.delivery === 'retirada'
  const ship = isPickup ? 0 : shipping
  const grand = subtotal + ship

  const set = (key) => (e) => {
    let v = e.target.value
    if (key === 'phone') v = maskPhone(v)
    if (key === 'cep') v = maskCep(v)
    if (key === 'state') v = v.toUpperCase().slice(0, 2)
    setForm((f) => ({ ...f, [key]: v }))
    setErrors((x) => ({ ...x, [key]: undefined }))
  }

  const validate = () => {
    const e = {}
    if (form.name.trim().length < 3) e.name = 'Informe o nome completo.'
    if (form.phone.replace(/\D/g, '').length < 10) e.phone = 'Telefone incompleto.'
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))
      e.email = 'E-mail inválido.'

    if (!isPickup) {
      if (form.cep.replace(/\D/g, '').length !== 8) e.cep = 'CEP incompleto.'
      if (!form.address.trim()) e.address = 'Informe a rua.'
      if (!form.number.trim()) e.number = 'Informe o número.'
      if (!form.district.trim()) e.district = 'Informe o bairro.'
      if (!form.city.trim()) e.city = 'Informe a cidade.'
      if (form.state.length !== 2) e.state = 'UF.'
    }

    setErrors(e)
    if (Object.keys(e).length) {
      toast('Revise os campos destacados.', 'err')
      document
        .querySelector('.field.has-error input, .field.has-error textarea')
        ?.focus()
      return false
    }
    return true
  }

  const submit = (e) => {
    e.preventDefault()
    if (sending) return
    if (!validate()) return

    setSending(true)
    try {
      const order = placeOrder(form)
      navigate(`/pedido/${order.id}`, { replace: true })
    } catch (err) {
      toast(err.message ?? 'Não foi possível finalizar o pedido.', 'err')
      setSending(false)
    }
  }

  if (cartLines.length === 0) {
    return (
      <div className="wrap empty" style={{ minHeight: '60vh' }}>
        <Icon name="bag" size={48} strokeWidth={1.2} />
        <h3>Sua sacola está vazia</h3>
        <p>Escolha os produtos antes de finalizar o pedido.</p>
        <Link to="/catalogo" className="btn btn--primary">
          Ver produtos
        </Link>
      </div>
    )
  }

  return (
    <div className="wrap checkout">
      <header className="checkout__head">
        <nav className="crumbs" aria-label="Trilha">
          <Link to="/">Início</Link>
          <Icon name="chevronRight" size={13} />
          <span>Finalizar pedido</span>
        </nav>
        <h1>Finalizar pedido</h1>
        <p>Confirme seus dados. O pagamento é combinado após a confirmação.</p>
      </header>

      <form className="checkout__grid" onSubmit={submit} noValidate>
        <div className="checkout__form">
          {/* -------------------------------------------------------- Dados */}
          <section className="panel">
            <h2 className="panel__title">
              <Icon name="user" size={18} /> Seus dados
            </h2>

            <div className="form-grid">
              <div className={`field col-2${errors.name ? ' has-error' : ''}`}>
                <label htmlFor="ck-name">Nome completo *</label>
                <input
                  id="ck-name"
                  className="input"
                  value={form.name}
                  onChange={set('name')}
                  autoComplete="name"
                  placeholder="Maria Silva"
                />
                {errors.name && <span className="err">{errors.name}</span>}
              </div>

              <div className={`field${errors.phone ? ' has-error' : ''}`}>
                <label htmlFor="ck-phone">WhatsApp *</label>
                <input
                  id="ck-phone"
                  className="input"
                  value={form.phone}
                  onChange={set('phone')}
                  inputMode="tel"
                  autoComplete="tel"
                  placeholder="(11) 91234-5678"
                />
                {errors.phone && <span className="err">{errors.phone}</span>}
              </div>

              <div className={`field${errors.email ? ' has-error' : ''}`}>
                <label htmlFor="ck-email">E-mail</label>
                <input
                  id="ck-email"
                  className="input"
                  type="email"
                  value={form.email}
                  onChange={set('email')}
                  autoComplete="email"
                  placeholder="maria@email.com"
                />
                {errors.email && <span className="err">{errors.email}</span>}
              </div>
            </div>
          </section>

          {/* ------------------------------------------------------ Entrega */}
          <section className="panel">
            <h2 className="panel__title">
              <Icon name="truck" size={18} /> Entrega
            </h2>

            <div className="options">
              <label className={`option${form.delivery === 'entrega' ? ' is-on' : ''}`}>
                <input
                  type="radio"
                  name="delivery"
                  value="entrega"
                  checked={form.delivery === 'entrega'}
                  onChange={set('delivery')}
                />
                <span className="option__mark" />
                <span className="option__body">
                  <strong>Entrega no endereço</strong>
                  <span>
                    {subtotal >= settings.freeShippingFrom
                      ? 'Frete grátis neste pedido'
                      : `${money(settings.shippingFee)} · 2 a 4 dias úteis`}
                  </span>
                </span>
              </label>

              {settings.pickupEnabled && (
                <label className={`option${isPickup ? ' is-on' : ''}`}>
                  <input
                    type="radio"
                    name="delivery"
                    value="retirada"
                    checked={isPickup}
                    onChange={set('delivery')}
                  />
                  <span className="option__mark" />
                  <span className="option__body">
                    <strong>Retirar na loja</strong>
                    <span>Sem custo · {settings.address}</span>
                  </span>
                </label>
              )}
            </div>

            {!isPickup && (
              <div className="form-grid" style={{ marginTop: 18 }}>
                <div className={`field${errors.cep ? ' has-error' : ''}`}>
                  <label htmlFor="ck-cep">CEP *</label>
                  <input
                    id="ck-cep"
                    className="input"
                    value={form.cep}
                    onChange={set('cep')}
                    inputMode="numeric"
                    autoComplete="postal-code"
                    placeholder="01310-100"
                  />
                  {errors.cep && <span className="err">{errors.cep}</span>}
                </div>

                <div className={`field${errors.address ? ' has-error' : ''}`}>
                  <label htmlFor="ck-address">Rua *</label>
                  <input
                    id="ck-address"
                    className="input"
                    value={form.address}
                    onChange={set('address')}
                    autoComplete="address-line1"
                    placeholder="Av. Paulista"
                  />
                  {errors.address && <span className="err">{errors.address}</span>}
                </div>

                <div className={`field${errors.number ? ' has-error' : ''}`}>
                  <label htmlFor="ck-number">Número *</label>
                  <input
                    id="ck-number"
                    className="input"
                    value={form.number}
                    onChange={set('number')}
                    placeholder="1000"
                  />
                  {errors.number && <span className="err">{errors.number}</span>}
                </div>

                <div className="field">
                  <label htmlFor="ck-comp">Complemento</label>
                  <input
                    id="ck-comp"
                    className="input"
                    value={form.complement}
                    onChange={set('complement')}
                    placeholder="Apto 42"
                  />
                </div>

                <div className={`field${errors.district ? ' has-error' : ''}`}>
                  <label htmlFor="ck-district">Bairro *</label>
                  <input
                    id="ck-district"
                    className="input"
                    value={form.district}
                    onChange={set('district')}
                    placeholder="Bela Vista"
                  />
                  {errors.district && <span className="err">{errors.district}</span>}
                </div>

                <div className={`field${errors.city ? ' has-error' : ''}`}>
                  <label htmlFor="ck-city">Cidade *</label>
                  <input
                    id="ck-city"
                    className="input"
                    value={form.city}
                    onChange={set('city')}
                    autoComplete="address-level2"
                    placeholder="São Paulo"
                  />
                  {errors.city && <span className="err">{errors.city}</span>}
                </div>

                <div className={`field field--uf${errors.state ? ' has-error' : ''}`}>
                  <label htmlFor="ck-state">UF *</label>
                  <input
                    id="ck-state"
                    className="input"
                    value={form.state}
                    onChange={set('state')}
                    maxLength={2}
                    placeholder="SP"
                  />
                  {errors.state && <span className="err">{errors.state}</span>}
                </div>
              </div>
            )}
          </section>

          {/* ---------------------------------------------------- Pagamento */}
          <section className="panel">
            <h2 className="panel__title">
              <Icon name="shield" size={18} /> Pagamento
            </h2>

            <div className="options options--grid">
              {Object.entries(PAYMENT_LABEL).map(([value, label]) => (
                <label
                  key={value}
                  className={`option${form.payment === value ? ' is-on' : ''}`}
                >
                  <input
                    type="radio"
                    name="payment"
                    value={value}
                    checked={form.payment === value}
                    onChange={set('payment')}
                  />
                  <span className="option__mark" />
                  <span className="option__body">
                    <strong>{label}</strong>
                    <span>
                      {value === 'pix'
                        ? 'Chave enviada após o pedido'
                        : value === 'boleto'
                          ? 'Vencimento em 3 dias'
                          : value === 'cartao'
                            ? 'Maquininha na entrega'
                            : 'Combine o troco'}
                    </span>
                  </span>
                </label>
              ))}
            </div>

            <div className="field" style={{ marginTop: 18 }}>
              <label htmlFor="ck-note">Observação do pedido</label>
              <textarea
                id="ck-note"
                className="textarea"
                value={form.note}
                onChange={set('note')}
                placeholder="Ex.: colorset nas cores azul, verde e amarelo."
              />
              <span className="hint">
                Use este campo para indicar cores, variações ou instruções de entrega.
              </span>
            </div>
          </section>
        </div>

        {/* ------------------------------------------------------- Resumo */}
        <aside className="checkout__summary">
          <div className="panel summary">
            <h2 className="panel__title">Resumo do pedido</h2>

            <ul className="summary__items">
              {cartLines.map((l) => (
                <li key={l.productId}>
                  <span className="summary__art">
                    <ProductArt product={l.product} />
                    <em>{l.qty}</em>
                  </span>
                  <span className="summary__name">{l.product.name}</span>
                  <strong>{money(l.lineTotal)}</strong>
                </li>
              ))}
            </ul>

            <dl className="totals">
              <div>
                <dt>Subtotal</dt>
                <dd>{money(subtotal)}</dd>
              </div>
              <div>
                <dt>{isPickup ? 'Retirada' : 'Entrega'}</dt>
                <dd>{ship === 0 ? <span className="free">Grátis</span> : money(ship)}</dd>
              </div>
              <div className="totals__grand">
                <dt>Total</dt>
                <dd>{money(grand)}</dd>
              </div>
            </dl>

            <button
              type="submit"
              className="btn btn--primary btn--lg btn--block"
              disabled={sending}
            >
              {sending ? 'Enviando…' : 'Confirmar pedido'}
            </button>

            <p className="summary__note">
              <Icon name="lock" size={14} /> Nenhum dado de cartão é solicitado neste site.
            </p>
          </div>
        </aside>
      </form>
    </div>
  )
}
