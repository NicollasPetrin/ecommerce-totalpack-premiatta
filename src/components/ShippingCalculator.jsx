import { useEffect, useState } from 'react'
import { useStore } from '../store/StoreContext'
import { api } from '../lib/api'
import { money } from '../lib/format'
import { formatCep, normalizeCep, zoneDeadline } from '../lib/shipping'
import Icon from './Icon'

/**
 * Consulta de frete por CEP.
 *
 * O CEP fica guardado no contexto, então quem calcular aqui já encontra o
 * campo preenchido no checkout — o cliente não digita duas vezes.
 *
 * Com `items`, cota exatamente aquele item na transportadora. É o caso da
 * página do produto, e existe porque a resposta precisa ser a mesma que o
 * checkout vai dar: antes esta tela lia a tabela de faixas de CEP enquanto o
 * checkout perguntava à transportadora, e os dois mostravam preços
 * diferentes para a mesma entrega. Prometer um número e cobrar outro no fim
 * é o pior lugar para o cliente descobrir a diferença.
 *
 * Sem `items`, usa a cotação da sacola que o contexto já fez — na sacola,
 * refazer o pedido aqui seria uma chamada repetida à transportadora.
 */
export default function ShippingCalculator({ compact = false, items = null }) {
  const {
    cep, setCep, zone, outOfRange, settings, freeShipping,
    freteOpcoes, freteIntegrado, freteCarregando,
  } = useStore()

  const [draft, setDraft] = useState(() => formatCep(cep))
  const [touched, setTouched] = useState(false)

  // Cotação própria, só quando esta tela cota um item específico.
  const [proprio, setProprio] = useState(null)
  const [carregandoProprio, setCarregandoProprio] = useState(false)

  const incomplete = touched && !normalizeCep(draft)

  /* A dependência do efeito é o conteúdo, não a referência do array.
     Sem isso, um chamador que montasse `items` na renderização — que é o
     natural de se escrever — daria um array novo a cada volta e o efeito
     cotaria em laço infinito. Assim qualquer chamador pode passar a lista
     inline sem saber disso. */
  const chaveItens = items?.length ? JSON.stringify(items) : ''

  useEffect(() => {
    if (!chaveItens || cep.replace(/\D/g, '').length !== 8) {
      setProprio(null)
      return
    }

    let cancelado = false
    setCarregandoProprio(true)

    api
      .post('/shipping/options', { cep, items: JSON.parse(chaveItens) })
      .then((r) => {
        if (!cancelado) setProprio(r)
      })
      .catch(() => {
        // Falar da transportadora que não respondeu não ajuda quem compra: a
        // tela volta para a tabela de faixas, que é uma resposta honesta.
        if (!cancelado) setProprio(null)
      })
      .finally(() => {
        if (!cancelado) setCarregandoProprio(false)
      })

    return () => {
      cancelado = true
    }
  }, [cep, chaveItens])

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

  /* Qual resposta mostrar: a desta tela, se ela cota; senão a da sacola. */
  const opcoes = items ? (proprio?.options ?? null) : freteOpcoes
  const integrado = freteIntegrado
  const carregando = items ? carregandoProprio : freteCarregando

  /* A transportadora devolve uma dúzia de serviços. Aqui não se escolhe nada
     — a escolha é no checkout — então mostrar a lista inteira só ocuparia a
     tela. O mais barato responde "quanto custa"; o prazo mais curto responde
     "quando chega". As duas perguntas de quem está decidindo a compra. */
  const barato = opcoes?.length ? [...opcoes].sort((a, b) => a.preco - b.preco)[0] : null
  const rapido = opcoes?.length
    ? [...opcoes].sort((a, b) => a.prazoDias - b.prazoDias || a.preco - b.preco)[0]
    : null

  const dias = (n) => (n === 1 ? '1 dia útil' : `${n} dias úteis`)

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

      {showResult && carregando && (
        <p className="shipcalc__msg">Consultando as transportadoras…</p>
      )}

      {/* ------------------------------------- Transportadora integrada */}
      {showResult && !carregando && integrado && barato && (
        <div className="shipcalc__frete">
          <p className="shipcalc__msg shipcalc__msg--ok">
            <Icon name="checkCircle" size={16} />
            <span>
              <strong>{money(barato.preco)}</strong> com {barato.transportadora || barato.nome} ·
              chega em {dias(barato.prazoDias)}
            </span>
          </p>

          {/* Só aparece quando pagar mais adianta de verdade. */}
          {rapido && rapido.servicoId !== barato.servicoId && rapido.prazoDias < barato.prazoDias && (
            <p className="shipcalc__msg shipcalc__alt">
              ou <strong>{money(rapido.preco)}</strong> com{' '}
              {rapido.transportadora || rapido.nome}, em {dias(rapido.prazoDias)}
            </p>
          )}

          {opcoes.length > 2 && (
            <p className="shipcalc__nota">
              {opcoes.length} transportadoras disponíveis. Você escolhe ao finalizar o pedido.
            </p>
          )}
        </div>
      )}

      {showResult && !carregando && integrado && opcoes && !opcoes.length && (
        <p className="shipcalc__msg shipcalc__msg--warn">
          <Icon name="alert" size={16} />
          <span>
            Nenhuma transportadora atende esse CEP.{' '}
            <a href={`mailto:${settings.email}`}>Fale conosco por e-mail</a>.
          </span>
        </p>
      )}

      {/* ----------------------------- Sem integração: faixas de CEP */}
      {showResult && !carregando && !integrado && zone && (
        <p className="shipcalc__msg shipcalc__msg--ok">
          <Icon name="checkCircle" size={16} />
          <span>
            <strong>{zone.name}</strong> — {freeShipping ? 'frete grátis' : money(zone.fee)} ·
            chega em {zoneDeadline(zone)}
          </span>
        </p>
      )}

      {showResult && !carregando && !integrado && outOfRange && (
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
