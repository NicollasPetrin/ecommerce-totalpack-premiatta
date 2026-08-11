import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { useStore, ORDER_STATUS, PAYMENT_LABEL } from '../store/StoreContext'
import { date, dateTime, maskCep, maskPhone, money, orderCode } from '../lib/format'
import Modal, { ConfirmDialog } from '../components/Modal'
import ProductArt from '../components/ProductArt'
import Icon from '../components/Icon'

const blankAddress = () => ({
  id: '',
  label: '',
  cep: '',
  address: '',
  number: '',
  complement: '',
  district: '',
  city: '',
  state: '',
  isDefault: false,
})

export default function Account() {
  const {
    currentCustomer, customerOrders, logoutCustomer,
    saveAddress, deleteAddress, setDefaultAddress, toast,
  } = useStore()
  const navigate = useNavigate()

  const [tab, setTab] = useState('pedidos')
  const [editingAddress, setEditingAddress] = useState(null)
  const [removingAddress, setRemovingAddress] = useState(null)
  const [openOrder, setOpenOrder] = useState(null)

  if (!currentCustomer) return <Navigate to="/entrar" replace state={{ from: '/conta' }} />

  const addresses = currentCustomer.addresses ?? []
  const spent = customerOrders
    .filter((o) => o.status !== 'cancelado')
    .reduce((s, o) => s + o.total, 0)

  return (
    <div className="wrap account">
      <header className="account__head">
        <div>
          <p className="account__hello">Olá, {currentCustomer.name.split(' ')[0]}</p>
          <h1>Minha conta</h1>
          <p className="account__meta">
            Cliente desde {date(currentCustomer.createdAt)} · {customerOrders.length}{' '}
            {customerOrders.length === 1 ? 'pedido' : 'pedidos'} · {money(spent)} em compras
          </p>
        </div>
        <button
          className="btn btn--outline"
          onClick={async () => {
            await logoutCustomer()
            toast('Você saiu da conta.')
            navigate('/')
          }}
        >
          <Icon name="logout" size={16} /> Sair
        </button>
      </header>

      <div className="segmented account__tabs" role="tablist">
        {[
          ['pedidos', 'Meus pedidos'],
          ['enderecos', 'Endereços'],
          ['dados', 'Meus dados'],
        ].map(([v, label]) => (
          <button
            key={v}
            role="tab"
            aria-selected={tab === v}
            className={tab === v ? 'is-on' : ''}
            onClick={() => setTab(v)}
          >
            {label}
            {v === 'pedidos' && <em>{customerOrders.length}</em>}
            {v === 'enderecos' && <em>{addresses.length}</em>}
          </button>
        ))}
      </div>

      {/* ------------------------------------------------------------ Pedidos */}
      {tab === 'pedidos' && (
        <section>
          {customerOrders.length === 0 ? (
            <div className="empty">
              <Icon name="receipt" size={44} strokeWidth={1.2} />
              <h3>Você ainda não fez pedidos</h3>
              <p>Quando fizer, eles ficam guardados aqui para consulta e recompra.</p>
              <Link to="/catalogo" className="btn btn--primary">
                Ver produtos
              </Link>
            </div>
          ) : (
            <ul className="orderlist">
              {customerOrders.map((o) => (
                <li key={o.id}>
                  <button className="orderlist__row" onClick={() => setOpenOrder(o.id)}>
                    <span className="orderlist__arts">
                      {o.items.slice(0, 3).map((i) => (
                        <span key={i.productId}>
                          <ProductArt product={i} />
                        </span>
                      ))}
                      {o.items.length > 3 && (
                        <span className="orderlist__more">+{o.items.length - 3}</span>
                      )}
                    </span>

                    <span className="orderlist__body">
                      <strong>{orderCode(o.seq, o.createdAt)}</strong>
                      <span>
                        {date(o.createdAt)} · {o.items.length}{' '}
                        {o.items.length === 1 ? 'item' : 'itens'}
                      </span>
                    </span>

                    <span className={`tag tag--${ORDER_STATUS[o.status].tone}`}>
                      {ORDER_STATUS[o.status].label}
                    </span>

                    <strong className="orderlist__total">{money(o.total)}</strong>
                    <Icon name="chevronRight" size={18} className="orderlist__chev" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* --------------------------------------------------------- Endereços */}
      {tab === 'enderecos' && (
        <section>
          <div className="account__actions">
            <button className="btn btn--primary" onClick={() => setEditingAddress(blankAddress())}>
              <Icon name="plus" size={16} /> Novo endereço
            </button>
          </div>

          {addresses.length === 0 ? (
            <div className="empty">
              <Icon name="pin" size={44} strokeWidth={1.2} />
              <h3>Nenhum endereço salvo</h3>
              <p>Salve um endereço para não precisar digitar tudo a cada compra.</p>
            </div>
          ) : (
            <div className="addresses">
              {addresses.map((a) => (
                <article key={a.id} className={`addr${a.isDefault ? ' is-default' : ''}`}>
                  <header>
                    <strong>{a.label || 'Endereço'}</strong>
                    {a.isDefault && <span className="tag tag--blue">Padrão</span>}
                  </header>

                  <p>
                    {a.address}, {a.number}
                    {a.complement && ` — ${a.complement}`}
                    <br />
                    {a.district} · {a.city}/{a.state}
                    <br />
                    CEP {maskCep(a.cep)}
                  </p>

                  <footer>
                    {!a.isDefault && (
                      <button
                        className="btn btn--ghost btn--sm"
                        onClick={async () => {
                          try {
                            await setDefaultAddress(a.id)
                            toast('Endereço padrão atualizado.')
                          } catch (err) {
                            toast(err.message, 'err')
                          }
                        }}
                      >
                        Tornar padrão
                      </button>
                    )}
                    <button
                      className="btn btn--ghost btn--sm"
                      onClick={() => setEditingAddress(a)}
                    >
                      Editar
                    </button>
                    <button
                      className="btn btn--ghost btn--sm addr__del"
                      onClick={() => setRemovingAddress(a)}
                    >
                      Excluir
                    </button>
                  </footer>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ------------------------------------------------------------- Dados */}
      {tab === 'dados' && <ProfileForm />}

      {/* ----------------------------------------------------------- Modais */}
      {editingAddress && (
        <AddressForm
          value={editingAddress}
          onClose={() => setEditingAddress(null)}
          onSave={async (data) => {
            try {
              await saveAddress(data)
              setEditingAddress(null)
              toast(data.id ? 'Endereço atualizado.' : 'Endereço salvo.')
            } catch (err) {
              toast(err.message, 'err')
            }
          }}
        />
      )}

      <ConfirmDialog
        open={Boolean(removingAddress)}
        onClose={() => setRemovingAddress(null)}
        onConfirm={async () => {
          try {
            await deleteAddress(removingAddress.id)
            toast('Endereço excluído.')
          } catch (err) {
            toast(err.message, 'err')
          }
        }}
        title="Excluir endereço"
        message={`“${removingAddress?.label || 'Endereço'}” será removido da sua conta.`}
      />

      {openOrder && (
        <OrderDetail orderId={openOrder} onClose={() => setOpenOrder(null)} />
      )}
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Meus dados                                                                  */
/* -------------------------------------------------------------------------- */

function ProfileForm() {
  const { currentCustomer, updateCustomer, changeCustomerPassword, toast } = useStore()
  const [f, setF] = useState({
    name: currentCustomer.name,
    email: currentCustomer.email,
    phone: currentCustomer.phone,
  })
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' })
  const [pwError, setPwError] = useState('')

  const saveProfile = async (e) => {
    e.preventDefault()
    try {
      await updateCustomer({
        name: f.name.trim(),
        email: f.email.trim().toLowerCase(),
        phone: f.phone,
      })
      toast('Dados atualizados.')
    } catch (err) {
      toast(err.message, 'err')
    }
  }

  const savePassword = async (e) => {
    e.preventDefault()
    setPwError('')
    if (pw.next.length < 8) return setPwError('A nova senha precisa ter ao menos 8 caracteres.')
    if (pw.next !== pw.confirm) return setPwError('A confirmação não confere.')
    if (!(await changeCustomerPassword(pw.current, pw.next))) {
      return setPwError('Senha atual incorreta.')
    }
    setPw({ current: '', next: '', confirm: '' })
    toast('Senha alterada.')
  }

  return (
    <div className="account__grid">
      <form className="panel" onSubmit={saveProfile}>
        <h2 className="panel__title">
          <Icon name="user" size={18} /> Meus dados
        </h2>

        <div className="stack gap-4">
          <div className="field">
            <label htmlFor="ac-name">Nome completo</label>
            <input
              id="ac-name"
              className="input"
              value={f.name}
              onChange={(e) => setF({ ...f, name: e.target.value })}
            />
          </div>

          <div className="field">
            <label htmlFor="ac-email">E-mail</label>
            <input
              id="ac-email"
              className="input"
              type="email"
              value={f.email}
              onChange={(e) => setF({ ...f, email: e.target.value })}
            />
          </div>

          <div className="field">
            <label htmlFor="ac-phone">Telefone</label>
            <input
              id="ac-phone"
              className="input"
              value={f.phone}
              onChange={(e) => setF({ ...f, phone: maskPhone(e.target.value) })}
            />
          </div>

          <button className="btn btn--primary" type="submit">
            Salvar dados
          </button>
        </div>
      </form>

      <form className="panel" onSubmit={savePassword}>
        <h2 className="panel__title">
          <Icon name="lock" size={18} /> Senha
        </h2>

        <div className="stack gap-4">
          <div className={`field${pwError ? ' has-error' : ''}`}>
            <label htmlFor="ac-cur">Senha atual</label>
            <input
              id="ac-cur"
              className="input"
              type="password"
              value={pw.current}
              onChange={(e) => setPw({ ...pw, current: e.target.value })}
              autoComplete="current-password"
            />
          </div>

          <div className="field">
            <label htmlFor="ac-new">Nova senha</label>
            <input
              id="ac-new"
              className="input"
              type="password"
              value={pw.next}
              onChange={(e) => setPw({ ...pw, next: e.target.value })}
              autoComplete="new-password"
            />
          </div>

          <div className="field">
            <label htmlFor="ac-conf">Repetir a nova senha</label>
            <input
              id="ac-conf"
              className="input"
              type="password"
              value={pw.confirm}
              onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
              autoComplete="new-password"
            />
            {pwError && <span className="err">{pwError}</span>}
          </div>

          <button className="btn btn--primary" type="submit">
            Alterar senha
          </button>
        </div>
      </form>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Endereço                                                                    */
/* -------------------------------------------------------------------------- */

function AddressForm({ value, onClose, onSave }) {
  const [f, setF] = useState({ ...value, cep: maskCep(value.cep ?? '') })
  const [errors, setErrors] = useState({})

  const set = (key, v) => {
    setF((old) => ({ ...old, [key]: v }))
    setErrors((e) => ({ ...e, [key]: undefined }))
  }

  const submit = (e) => {
    e.preventDefault()
    const err = {}
    if (f.cep.replace(/\D/g, '').length !== 8) err.cep = 'CEP incompleto.'
    if (!f.address.trim()) err.address = 'Informe a rua.'
    if (!f.number.trim()) err.number = 'Informe o número.'
    if (!f.district.trim()) err.district = 'Informe o bairro.'
    if (!f.city.trim()) err.city = 'Informe a cidade.'
    if (f.state.length !== 2) err.state = 'UF.'

    setErrors(err)
    if (Object.keys(err).length) return

    onSave({ ...f, label: f.label.trim() || 'Endereço' })
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={f.id ? 'Editar endereço' : 'Novo endereço'}
      footer={
        <>
          <button className="btn btn--secondary" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn--primary" onClick={submit}>
            Salvar endereço
          </button>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="stack gap-4">
        <div className="field">
          <label htmlFor="ad-label">Nome do endereço</label>
          <input
            id="ad-label"
            className="input"
            value={f.label}
            onChange={(e) => set('label', e.target.value)}
            placeholder="Casa, Trabalho, Escola…"
          />
        </div>

        <div className="form-grid">
          <div className={`field${errors.cep ? ' has-error' : ''}`}>
            <label htmlFor="ad-cep">CEP *</label>
            <input
              id="ad-cep"
              className="input"
              value={f.cep}
              onChange={(e) => set('cep', maskCep(e.target.value))}
              inputMode="numeric"
              placeholder="01310-100"
            />
            {errors.cep && <span className="err">{errors.cep}</span>}
          </div>

          <div className={`field${errors.address ? ' has-error' : ''}`}>
            <label htmlFor="ad-street">Rua *</label>
            <input
              id="ad-street"
              className="input"
              value={f.address}
              onChange={(e) => set('address', e.target.value)}
              placeholder="Av. Paulista"
            />
            {errors.address && <span className="err">{errors.address}</span>}
          </div>

          <div className={`field${errors.number ? ' has-error' : ''}`}>
            <label htmlFor="ad-num">Número *</label>
            <input
              id="ad-num"
              className="input"
              value={f.number}
              onChange={(e) => set('number', e.target.value)}
              placeholder="1000"
            />
            {errors.number && <span className="err">{errors.number}</span>}
          </div>

          <div className="field">
            <label htmlFor="ad-comp">Complemento</label>
            <input
              id="ad-comp"
              className="input"
              value={f.complement}
              onChange={(e) => set('complement', e.target.value)}
              placeholder="Apto 42"
            />
          </div>

          <div className={`field${errors.district ? ' has-error' : ''}`}>
            <label htmlFor="ad-dist">Bairro *</label>
            <input
              id="ad-dist"
              className="input"
              value={f.district}
              onChange={(e) => set('district', e.target.value)}
              placeholder="Bela Vista"
            />
            {errors.district && <span className="err">{errors.district}</span>}
          </div>

          <div className={`field${errors.city ? ' has-error' : ''}`}>
            <label htmlFor="ad-city">Cidade *</label>
            <input
              id="ad-city"
              className="input"
              value={f.city}
              onChange={(e) => set('city', e.target.value)}
              placeholder="São Paulo"
            />
            {errors.city && <span className="err">{errors.city}</span>}
          </div>

          <div className={`field field--uf${errors.state ? ' has-error' : ''}`}>
            <label htmlFor="ad-uf">UF *</label>
            <input
              id="ad-uf"
              className="input"
              value={f.state}
              onChange={(e) => set('state', e.target.value.toUpperCase().slice(0, 2))}
              maxLength={2}
              placeholder="SP"
            />
            {errors.state && <span className="err">{errors.state}</span>}
          </div>
        </div>

        <label className="switch">
          <input
            type="checkbox"
            checked={f.isDefault}
            onChange={(e) => set('isDefault', e.target.checked)}
          />
          <span className="switch__track" />
          Usar como endereço padrão
        </label>
      </form>
    </Modal>
  )
}

/* -------------------------------------------------------------------------- */
/* Detalhe do pedido                                                           */
/* -------------------------------------------------------------------------- */

function OrderDetail({ orderId, onClose }) {
  // Vem de `customerOrders`, a lista da própria conta — `orders` só existe
  // para o administrador.
  const { customerOrders, settings, addToCart, productById, toast } = useStore()
  const order = customerOrders.find((o) => o.id === orderId)
  if (!order) return null

  /** Recompra: devolve à sacola o que ainda existe e tem estoque. */
  const buyAgain = () => {
    let added = 0
    let missing = 0
    order.items.forEach((i) => {
      const product = productById[i.productId]
      if (!product?.active) {
        missing += 1
        return
      }
      // A variação comprada pode não existir mais; sem ela a recompra não
      // sabe qual opção repor, então o item entra como indisponível.
      const variant = i.variantId
        ? (product.variants ?? []).find((v) => v.id === i.variantId && v.active)
        : null
      if (i.variantId && !variant) {
        missing += 1
        return
      }
      const estoque = (variant ?? product).stock
      if (estoque > 0) {
        addToCart(product, Math.min(i.qty, estoque), variant)
        added += 1
      } else {
        missing += 1
      }
    })
    if (added === 0) toast('Nenhum item deste pedido está disponível agora.', 'err')
    else if (missing > 0) toast(`${added} item(ns) na sacola. ${missing} indisponível(is).`)
    onClose()
  }

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={`Pedido ${orderCode(order.seq, order.createdAt)}`}
      footer={
        <>
          <button className="btn btn--secondary" onClick={onClose}>
            Fechar
          </button>
          <button className="btn btn--primary" onClick={buyAgain}>
            <Icon name="refresh" size={16} /> Comprar de novo
          </button>
        </>
      }
    >
      <div className="stack gap-6">
        <div className="row gap-3">
          <span className={`tag tag--${ORDER_STATUS[order.status].tone}`}>
            {ORDER_STATUS[order.status].label}
          </span>
          <span className="hint">Feito em {dateTime(order.createdAt)}</span>
        </div>

        <ul className="summary__items">
          {order.items.map((i) => (
            <li key={i.productId}>
              <span className="summary__art">
                <ProductArt product={i} />
                <em>{i.qty}</em>
              </span>
              <span className="summary__name">{i.name}</span>
              <strong>{money(i.price * i.qty)}</strong>
            </li>
          ))}
        </ul>

        <dl className="totals">
          <div>
            <dt>Subtotal</dt>
            <dd>{money(order.subtotal)}</dd>
          </div>
          <div>
            <dt>{order.delivery === 'retirada' ? 'Retirada' : 'Entrega'}</dt>
            <dd>
              {order.shipping === 0 ? <span className="free">Grátis</span> : money(order.shipping)}
            </dd>
          </div>
          <div className="totals__grand">
            <dt>Total</dt>
            <dd>{money(order.total)}</dd>
          </div>
        </dl>

        <dl className="deflist">
          <div>
            <dt>Pagamento</dt>
            <dd>{PAYMENT_LABEL[order.payment] ?? order.payment}</dd>
          </div>
          <div>
            <dt>{order.delivery === 'retirada' ? 'Retirada' : 'Entrega'}</dt>
            <dd>
              {order.delivery === 'retirada'
                ? settings.address
                : `${order.customer.address}, ${order.customer.number}${
                    order.customer.complement ? ` — ${order.customer.complement}` : ''
                  } · ${order.customer.district} · ${order.customer.city}/${order.customer.state}`}
            </dd>
          </div>
          {order.note && (
            <div>
              <dt>Observação</dt>
              <dd>{order.note}</dd>
            </div>
          )}
        </dl>
      </div>
    </Modal>
  )
}
