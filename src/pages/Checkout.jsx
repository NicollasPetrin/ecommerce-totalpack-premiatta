import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useStore } from '../store/StoreContext'
import { api } from '../lib/api'
import { PAYMENT_LABEL } from '../store/StoreContext'
import { maskCep, maskDoc, maskPhone, money } from '../lib/format'
import { formatCep, zoneDeadline } from '../lib/shipping'
import ProductArt from '../components/ProductArt'
import Icon from '../components/Icon'

const EMPTY = {
  name: '',
  phone: '',
  email: '',
  cpfCnpj: '',
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
  // Usados só quando há conta aberta.
  addressId: '',
  addressLabel: '',
  saveAddress: false,
}

export default function Checkout() {
  const {
    cartLines, subtotal, shipping, settings, placeOrder, toast,
    cep, setCep, zone, outOfRange, freeShipping,
    freteIntegrado, freteOpcoes, freteEscolhido, setFreteEscolhido,
    freteErro, freteCausa, freteCarregando, semEntrega,
    currentCustomer, defaultAddress,
  } = useStore()
  const navigate = useNavigate()

  /**
   * Com conta aberta, o formulário já nasce preenchido com os dados do cliente
   * e o endereço padrão. Sem conta, só reaproveita o CEP calculado na sacola.
   */
  const [form, setForm] = useState(() => {
    const base = { ...EMPTY, cep: formatCep(cep) }
    if (!currentCustomer) return base

    return {
      ...base,
      name: currentCustomer.name,
      phone: currentCustomer.phone,
      email: currentCustomer.email,
      cpfCnpj: maskDoc(currentCustomer.cpfCnpj ?? ''),
      ...(defaultAddress
        ? {
            addressId: defaultAddress.id,
            // O banco guarda só os 8 dígitos; a tela mostra com máscara.
            cep: maskCep(defaultAddress.cep),
            address: defaultAddress.address,
            number: defaultAddress.number,
            complement: defaultAddress.complement,
            district: defaultAddress.district,
            city: defaultAddress.city,
            state: defaultAddress.state,
          }
        : {}),
    }
  })

  /**
   * O endereço padrão da conta chega com o CEP já preenchido, mas o frete só
   * é calculado a partir do CEP guardado no contexto. Sem isto, o resumo abre
   * em "A calcular" mesmo com o endereço completo na tela.
   */
  useEffect(() => {
    const digits = form.cep.replace(/\D/g, '')
    if (digits.length === 8 && digits !== cep) setCep(digits)
    // Só na montagem: depois disso quem manda é a digitação do cliente.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const savedAddresses = currentCustomer?.addresses ?? []

  /** Preenche o formulário com um endereço salvo e recalcula o frete. */
  const useSavedAddress = (a) => {
    const digitos = a.cep.replace(/\D/g, '')
    setCep(digitos)
    // Endereço escolhido é endereço decidido: a busca não deve reescrevê-lo.
    cepConsultado.current = digitos
    setForm((f) => ({
      ...f,
      addressId: a.id,
      cep: maskCep(a.cep),
      address: a.address,
      number: a.number,
      complement: a.complement,
      district: a.district,
      city: a.city,
      state: a.state,
      saveAddress: false,
    }))
    setErrors({})
  }

  /** Limpa os campos para digitar um endereço novo. */
  const useNewAddress = () => {
    setCep('')
    setForm((f) => ({
      ...f,
      addressId: '',
      cep: '',
      address: '',
      number: '',
      complement: '',
      district: '',
      city: '',
      state: '',
      saveAddress: true,
    }))
    setErrors({})
  }
  const [errors, setErrors] = useState({})
  const [sending, setSending] = useState(false)
  const [buscandoCep, setBuscandoCep] = useState(false)
  /* Qual CEP a busca automática já resolveu. Nasce com o do endereço padrão
     da conta: aquele endereço veio do cadastro do cliente, que pode ter
     corrigido a rua à mão, e sobrescrevê-lo com a versão dos Correios seria
     desfazer a correção. */
  const cepConsultado = useRef((defaultAddress?.cep ?? '').replace(/\D/g, ''))
  /* Qual CEP tem consulta a caminho. Separado do de cima porque "pedido" e
     "preenchido" são momentos diferentes — confundir os dois foi o que
     quebrou a primeira versão. */
  const cepEmBusca = useRef('')
  const [verTodas, setVerTodas] = useState(false)

  /**
   * Curadoria das opções de frete.
   *
   * A transportadora devolve doze serviços com nomes que só quem trabalha com
   * logística distingue ("Jadlog .Package" e "Jadlog .Package Centralizado").
   * Doze alternativas é decisão travada — pela Lei de Hick, o tempo de escolha
   * cresce com o número de opções, e o público desta loja não tem repertório
   * para comparar transportadora.
   *
   * Então destacamos as duas perguntas que a pessoa de fato se faz: qual é a
   * mais barata e qual chega antes. O resto fica a um clique.
   */
  const { destaque, visiveis } = useMemo(() => {
    const lista = Array.isArray(freteOpcoes) ? freteOpcoes : []
    if (lista.length === 0) return { destaque: {}, visiveis: [] }

    const barata = [...lista].sort((a, b) => a.preco - b.preco)[0]
    // Empate de prazo decide pelo preço: chegar junto e custar menos é melhor.
    const rapida = [...lista].sort(
      (a, b) => a.prazoDias - b.prazoDias || a.preco - b.preco,
    )[0]

    const marcas = {}
    marcas[barata.servicoId] = { rotulo: 'Mais barato', tom: 'verde' }
    // Quando a mais barata também é a mais rápida, um selo só — dois na mesma
    // linha diriam a mesma coisa duas vezes.
    if (rapida.servicoId !== barata.servicoId) {
      marcas[rapida.servicoId] = { rotulo: 'Chega antes', tom: 'azul' }
    }

    if (verTodas) return { destaque: marcas, visiveis: lista }

    /* Com poucas opções não vale esconder nada: o clique a mais custaria
       mais que a rolagem que ele evita. */
    if (lista.length <= 3) return { destaque: marcas, visiveis: lista }

    const escolhidos = [barata, rapida].filter(
      (o, i, arr) => arr.findIndex((x) => x.servicoId === o.servicoId) === i,
    )

    // A opção já escolhida nunca some da lista, mesmo não sendo destaque —
    // ver a própria escolha desaparecer é desnorteante.
    if (freteEscolhido && !escolhidos.some((o) => o.servicoId === freteEscolhido.servicoId)) {
      escolhidos.push(freteEscolhido)
    }

    return { destaque: marcas, visiveis: escolhidos }
  }, [freteOpcoes, freteEscolhido, verTodas])

  const ship = shipping ?? 0
  const grand = subtotal + ship

  /**
   * Preenchimento do endereço a partir do CEP.
   *
   * Só dispara quando o CEP muda para outro completo e diferente do que já foi
   * consultado — sem isso, cada tecla depois do oitavo dígito viraria uma
   * consulta nova, e mexer no número da casa refaria a busca.
   *
   * Sobrescreve rua, bairro, cidade e UF de propósito: se o CEP mudou, o que
   * estava ali é de outro endereço. Número e complemento nunca são tocados —
   * nenhum CEP sabe deles, e apagar o que a pessoa digitou seria hostil.
   */
  useEffect(() => {
    const digitos = form.cep.replace(/\D/g, '')
    if (digitos.length !== 8) return
    // Já preenchido para este CEP, ou já pedido e a caminho.
    if (digitos === cepConsultado.current || digitos === cepEmBusca.current) return

    cepEmBusca.current = digitos
    setBuscandoCep(true)

    api
      .get(`/cep/${digitos}`)
      /* Sem cancelamento na limpeza, e isso é o ponto.
       *
       * O React chama o efeito duas vezes no desenvolvimento, de propósito,
       * para expor efeito que não tolera ser refeito. Com cancelamento, a
       * primeira ida era abortada pela limpeza e a segunda desistia por ver o
       * CEP já marcado: nada preenchia, e a requisição aparecia como 200 no
       * painel de rede — o pior tipo de erro para achar.
       *
       * Em vez de cancelar, a resposta é aceita só se ainda for a atual. Isso
       * resolve os dois casos de uma vez: a repetição do desenvolvimento e o
       * cliente que troca o CEP antes de a resposta anterior chegar. */
      .then(({ endereco }) => {
        if (cepEmBusca.current !== digitos || !endereco) return
        cepConsultado.current = digitos

        setForm((f) => ({
          ...f,
          // Cidade e UF vêm sempre; rua e bairro faltam em CEP de cidade
          // inteira, comum em município pequeno. Nesse caso o que já estava
          // escrito é melhor que vazio.
          address: endereco.rua || f.address,
          district: endereco.bairro || f.district,
          city: endereco.cidade,
          state: endereco.uf,
        }))
        setErrors((x) => ({
          ...x, address: undefined, district: undefined, city: undefined, state: undefined,
        }))

        /* O cursor vai para o número, que é o que falta e o único que a
           consulta não tem como saber. Só quando está vazio: quem voltou para
           corrigir o CEP não quer perder o lugar onde estava. */
        if (endereco.rua) {
          /* setTimeout, e não requestAnimationFrame: rAF não dispara em aba
             que não está desenhando, e o preenchimento pode muito bem
             terminar com a aba em segundo plano. */
          setTimeout(() => {
            const campo = document.getElementById('ck-number')
            if (campo && !campo.value) campo.focus()
          }, 0)
        }
      })
      /* Falha não vira erro na tela: o formulário continua preenchível à mão,
         como era antes de existir esta busca. Mas o CEP é liberado, para uma
         nova tentativa ser possível se a pessoa corrigir e voltar. */
      .catch(() => {
        if (cepEmBusca.current === digitos) cepEmBusca.current = ''
      })
      .finally(() => {
        if (cepEmBusca.current === digitos || !cepEmBusca.current) setBuscandoCep(false)
      })
  }, [form.cep])

  const set = (key) => (e) => {
    let v = e.target.value
    if (key === 'phone') v = maskPhone(v)
    if (key === 'cpfCnpj') v = maskDoc(v)
    if (key === 'state') v = v.toUpperCase().slice(0, 2)
    if (key === 'cep') {
      v = maskCep(v)
      // Digitar o CEP aqui recalcula o frete na hora.
      setCep(v.replace(/\D/g, ''))
    }
    setForm((f) => ({ ...f, [key]: v }))
    setErrors((x) => ({ ...x, [key]: undefined }))
  }

  const validate = () => {
    const e = {}
    if (form.name.trim().length < 3) e.name = 'Informe o nome completo.'
    if (form.phone.replace(/\D/g, '').length < 10) e.phone = 'Telefone incompleto.'
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email))
      e.email = 'E-mail inválido.'

    // Comprimento só; o dígito verificador é conferido no servidor, que
    // devolve o erro no campo se não bater.
    const doc = form.cpfCnpj.replace(/\D/g, '')
    if (doc.length !== 11 && doc.length !== 14) {
      e.cpfCnpj = 'Informe um CPF (11 dígitos) ou CNPJ (14).'
    }

    if (form.cep.replace(/\D/g, '').length !== 8) e.cep = 'CEP incompleto.'
    else if (semEntrega) e.cep = freteErro || 'Ainda não entregamos neste CEP.'
    else if (freteIntegrado && !freteEscolhido) e.cep = 'Escolha uma forma de envio.'
    if (!form.address.trim()) e.address = 'Informe a rua.'
    if (!form.number.trim()) e.number = 'Informe o número.'
    if (!form.district.trim()) e.district = 'Informe o bairro.'
    if (!form.city.trim()) e.city = 'Informe a cidade.'
    if (form.state.length !== 2) e.state = 'UF.'

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

  const submit = async (e) => {
    e.preventDefault()
    if (sending) return
    if (!validate()) return

    setSending(true)
    try {
      const order = await placeOrder(form)

      /**
       * Com processadora ligada, o cliente vai direto para a página de
       * pagamento — sem uma tela intermediária pedindo mais um clique.
       *
       * `replace` em vez de `href`: assim o botão "voltar" do navegador não
       * traz o cliente de volta ao checkout, o que geraria um segundo pedido.
       * Ele volta à confirmação pelo retorno automático do Asaas.
       */
      if (order.charge?.checkoutUrl) {
        window.location.replace(order.charge.checkoutUrl)
        return
      }

      navigate(`/pedido/${order.id}`, { replace: true })
    } catch (err) {
      // O servidor pode recusar por estoque, CEP ou campo inválido.
      if (err.details && Object.keys(err.details).length) {
        setErrors(err.details)
      }
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
        {/* Armadilha para robô. Fica fora da ordem de tabulação e escondido
            do leitor de tela, então ninguém de verdade chega nele — mas
            preenchedor automático de formulário preenche tudo que encontra.
            O servidor descarta o pedido quando vier preenchido. */}
        <div className="armadilha" aria-hidden="true">
          <label htmlFor="website">Não preencha este campo</label>
          <input
            id="website"
            name="website"
            type="text"
            tabIndex={-1}
            autoComplete="off"
            value={form.website ?? ''}
            onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))}
          />
        </div>

        <div className="checkout__form">
          {!currentCustomer && (
            <div className="loginhint">
              <Icon name="user" size={18} />
              <p>
                <strong>Já tem conta?</strong>{' '}
                <Link to="/entrar" state={{ from: '/checkout' }}>
                  Entre
                </Link>{' '}
                para usar seus endereços salvos. Você também pode continuar sem
                cadastro.
              </p>
            </div>
          )}

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
                <label htmlFor="ck-phone">Telefone *</label>
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

              <div className={`field col-2${errors.cpfCnpj ? ' has-error' : ''}`}>
                <label htmlFor="ck-doc">CPF ou CNPJ *</label>
                <input
                  id="ck-doc"
                  className="input"
                  value={form.cpfCnpj}
                  onChange={set('cpfCnpj')}
                  inputMode="numeric"
                  placeholder="123.456.789-01"
                />
                {errors.cpfCnpj ? (
                  <span className="err">{errors.cpfCnpj}</span>
                ) : (
                  <span className="hint">Necessário para emitir a cobrança.</span>
                )}
              </div>
            </div>
          </section>

          {/* ------------------------------------------------------ Entrega */}
          <section className="panel">
            <h2 className="panel__title">
              <Icon name="truck" size={18} /> Entrega
            </h2>

            <p className="panel__lead">
              {freteIntegrado
                ? 'Informe o CEP e escolha como quer receber.'
                : freeShipping
                  ? 'Frete grátis neste pedido.'
                  : zone
                    ? `${money(zone.fee)} · chega em ${zoneDeadline(zone)}.`
                    : 'Informe o CEP abaixo para ver o valor do frete.'}
            </p>

            {/* Opções reais da transportadora. Só aparece com integração
                ligada; sem ela o valor continua vindo da tabela de CEP. */}
            {freteIntegrado && (
              <div className="freteopts">
                {freteCarregando && <p className="hint">Calculando o frete…</p>}

                {!freteCarregando && freteErro && (
                  <p className="err">
                    <Icon name="alert" size={14} /> {freteErro}
                  </p>
                )}

                {/* Só chega para quem está logado no painel: o cliente não tem
                    o que fazer com a mensagem crua da transportadora. */}
                {freteCausa && (
                  <p className="freteopts__causa">
                    <strong>Diagnóstico (visível só para o administrador):</strong> {freteCausa}
                  </p>
                )}

                {!freteCarregando &&
                  !freteErro &&
                  Array.isArray(freteOpcoes) &&
                  freteOpcoes.length > 0 && (
                    <>
                      <ul className="freteopts__list" role="radiogroup" aria-label="Forma de envio">
                        {visiveis.map((o) => {
                          const marcado = freteEscolhido?.servicoId === o.servicoId
                          return (
                            <li key={o.servicoId}>
                              <button
                                type="button"
                                role="radio"
                                aria-checked={marcado}
                                className={`freteopt${marcado ? ' is-on' : ''}`}
                                onClick={() => setFreteEscolhido(o)}
                              >
                                <span className="freteopt__nome">
                                  {destaque[o.servicoId] && (
                                    <em className={`freteopt__tag is-${destaque[o.servicoId].tom}`}>
                                      {destaque[o.servicoId].rotulo}
                                    </em>
                                  )}
                                  <strong>
                                    {o.prazoDias === 1 ? '1 dia útil' : `${o.prazoDias} dias úteis`}
                                  </strong>
                                  <span className="freteopt__transp">
                                    {o.transportadora} {o.nome}
                                  </span>
                                </span>
                                <span className="freteopt__preco">{money(o.preco)}</span>
                              </button>
                            </li>
                          )
                        })}
                      </ul>

                      {/* Divulgação progressiva: as duas escolhas que as pessoas
                          realmente fazem ficam à vista; as outras dez, atrás de
                          um clique de quem quiser comparar. */}
                      {freteOpcoes.length > visiveis.length && (
                        <button
                          type="button"
                          className="freteopts__mais"
                          onClick={() => setVerTodas(true)}
                        >
                          Ver as outras {freteOpcoes.length - visiveis.length} opções
                          <Icon name="chevronDown" size={15} />
                        </button>
                      )}
                    </>
                  )}
              </div>
            )}

            {savedAddresses.length > 0 && (
              <div className="savedaddr">
                <span className="label">Endereços salvos na sua conta</span>
                <div className="savedaddr__list">
                  {savedAddresses.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      className={`savedaddr__item${form.addressId === a.id ? ' is-on' : ''}`}
                      onClick={() => useSavedAddress(a)}
                    >
                      <span className="savedaddr__mark" />
                      <span>
                        <strong>
                          {a.label}
                          {a.isDefault && <em> · padrão</em>}
                        </strong>
                        {a.address}, {a.number}
                        {a.complement && ` — ${a.complement}`} · {a.district} · {a.city}/
                        {a.state}
                      </span>
                    </button>
                  ))}

                  <button
                    type="button"
                    className={`savedaddr__item${!form.addressId ? ' is-on' : ''}`}
                    onClick={useNewAddress}
                  >
                    <span className="savedaddr__mark" />
                    <span>
                      <strong>Usar outro endereço</strong>
                      Digitar um endereço novo para esta entrega
                    </span>
                  </button>
                </div>
              </div>
            )}

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
                {errors.cep ? (
                  <span className="err">{errors.cep}</span>
                ) : buscandoCep ? (
                  <span className="hint">Buscando endereço…</span>
                ) : zone ? (
                  <span className="hint hint--ok">
                    {zone.name} · chega em {zoneDeadline(zone)}
                  </span>
                ) : null}
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

              {currentCustomer && !form.addressId && (
                <div className="field col-2 savecheck">
                  <label className="switch">
                    <input
                      type="checkbox"
                      checked={form.saveAddress}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, saveAddress: e.target.checked }))
                      }
                    />
                    <span className="switch__track" />
                    Salvar este endereço na minha conta
                  </label>

                  {form.saveAddress && (
                    <input
                      className="input"
                      value={form.addressLabel}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, addressLabel: e.target.value }))
                      }
                      placeholder="Dê um nome: Casa, Trabalho, Escola…"
                    />
                  )}
                </div>
              )}
            </div>
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
                        : value === 'cartao'
                          ? 'Enviamos um link seguro para pagamento'
                          : 'Enviamos o boleto após a confirmação'}
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
                <li key={l.key}>
                  <span className="summary__art">
                    <ProductArt product={l.product} />
                    <em>{l.qty}</em>
                  </span>
                  <span className="summary__name">
                    {l.product.name}
                    {l.variant && <em className="summary__variant">{l.variant.name}</em>}
                  </span>
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
                <dt>Entrega</dt>
                <dd>
                  {shipping === null ? (
                    <span className="pending">A calcular</span>
                  ) : ship === 0 ? (
                    <span className="free">Grátis</span>
                  ) : (
                    money(ship)
                  )}
                </dd>
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
