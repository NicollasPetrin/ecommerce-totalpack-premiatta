import { useState } from 'react'
import { useStore } from '../../store/StoreContext'
import { money } from '../../lib/format'
import {
  findOverlap,
  findZone,
  formatCep,
  normalizeCep,
  zoneDeadline,
  zoneRange,
} from '../../lib/shipping'
import Modal, { ConfirmDialog } from '../../components/Modal'
import Icon from '../../components/Icon'

const blank = () => ({
  id: '',
  name: '',
  cepStart: '',
  cepEnd: '',
  fee: '',
  days: '',
  active: true,
})

export default function AdminShipping() {
  const { settings, saveSettings, zones, saveZone, deleteZone, toggleZone, toast } = useStore()

  const [editing, setEditing] = useState(null)
  const [removing, setRemoving] = useState(null)
  const [testCep, setTestCep] = useState('')

  const [rules, setRules] = useState({
    freeShippingFrom: String(settings.freeShippingFrom),
  })

  const saveRules = async (e) => {
    e.preventDefault()
    try {
      await saveSettings({
        ...settings,
        freeShippingFrom: Number(String(rules.freeShippingFrom).replace(',', '.')) || 0,
      })
      toast('Regras de entrega salvas.')
    } catch (err) {
      toast(err.message, 'err')
    }
  }

  const testZone = normalizeCep(testCep) ? findZone(testCep, zones) : null
  const active = zones.filter((z) => z.active !== false)

  return (
    <>
      <header className="apage__head">
        <div>
          <h1>Entrega</h1>
          <p>
            {active.length} de {zones.length} regiões atendidas. O cliente digita o CEP e
            recebe o preço da região correspondente.
          </p>
        </div>
        <button className="btn btn--primary" onClick={() => setEditing(blank())}>
          <Icon name="plus" size={16} /> Nova região
        </button>
      </header>

      <div className="acols acols--settings">
        <section className="acard acard--flush">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Região</th>
                  <th>Faixa de CEP</th>
                  <th className="ta-right">Preço</th>
                  <th className="ta-right">Prazo</th>
                  <th>Atende</th>
                  <th className="ta-right">Ações</th>
                </tr>
              </thead>
              <tbody>
                {zones.map((z) => (
                  <tr key={z.id} className={z.active === false ? 'is-dim' : ''}>
                    <td>
                      <strong>{z.name}</strong>
                    </td>
                    <td className="mono nowrap">{zoneRange(z)}</td>
                    <td className="ta-right nowrap">
                      <strong>{money(z.fee)}</strong>
                    </td>
                    <td className="ta-right nowrap">{zoneDeadline(z)}</td>
                    <td>
                      <label className="switch switch--bare">
                        <input
                          type="checkbox"
                          checked={z.active !== false}
                          onChange={() =>
                            toggleZone(z.id).catch((err) => toast(err.message, 'err'))
                          }
                        />
                        <span className="switch__track" />
                      </label>
                    </td>
                    <td className="ta-right nowrap">
                      <button
                        className="icon-btn"
                        onClick={() => setEditing({ ...z, fee: String(z.fee), days: String(z.days) })}
                        aria-label={`Editar ${z.name}`}
                      >
                        <Icon name="edit" size={17} />
                      </button>
                      <button
                        className="icon-btn icon-btn--danger"
                        onClick={() => setRemoving(z)}
                        aria-label={`Excluir ${z.name}`}
                      >
                        <Icon name="trash" size={17} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {zones.length === 0 && (
            <div className="empty">
              <Icon name="truck" size={40} strokeWidth={1.2} />
              <h3>Nenhuma região cadastrada</h3>
              <p>
                Sem nenhuma região cadastrada, a loja não consegue aceitar pedidos.
                Cadastre ao menos a área que você atende.
              </p>
            </div>
          )}
        </section>

        <div className="stack gap-6">
          {/* --------------------------------------------------- Regras gerais */}
          <form className="acard" onSubmit={saveRules}>
            <header className="acard__head">
              <h2>Regras gerais</h2>
            </header>

            <div className="stack gap-4">
              <div className="field">
                <label htmlFor="z-free">Frete grátis a partir de (R$)</label>
                <input
                  id="z-free"
                  className="input"
                  inputMode="decimal"
                  value={rules.freeShippingFrom}
                  onChange={(e) => setRules({ ...rules, freeShippingFrom: e.target.value })}
                />
                <span className="hint">
                  Vale para todas as regiões. Deixe 0 para nunca dar frete grátis.
                </span>
              </div>

              <button className="btn btn--primary" type="submit">
                Salvar regras
              </button>
            </div>
          </form>

          {/* ------------------------------------------------------ Simulador */}
          <section className="acard">
            <header className="acard__head">
              <h2>Testar um CEP</h2>
            </header>

            <div className="stack gap-3">
              <input
                className="input"
                value={testCep}
                onChange={(e) => setTestCep(formatCep(e.target.value))}
                inputMode="numeric"
                placeholder="01310-100"
                maxLength={9}
                aria-label="CEP para teste"
              />

              {normalizeCep(testCep) &&
                (testZone ? (
                  <p className="ziptest ziptest--ok">
                    <Icon name="checkCircle" size={17} />
                    <span>
                      <strong>{testZone.name}</strong>
                      <br />
                      {money(testZone.fee)} · {zoneDeadline(testZone)}
                    </span>
                  </p>
                ) : (
                  <p className="ziptest ziptest--warn">
                    <Icon name="alert" size={17} />
                    <span>
                      Nenhuma região cobre este CEP. O cliente verá um aviso e será
                      direcionado ao e-mail da loja.
                    </span>
                  </p>
                ))}

              <p className="hint">
                É exatamente o que o cliente vê ao digitar o CEP na loja.
              </p>
            </div>
          </section>

          <section className="acard">
            <header className="acard__head">
              <h2>Como isso funciona</h2>
            </header>
            <p className="acard__note">
              O preço vem da tabela acima, não de uma consulta às transportadoras. Você
              controla a margem, mas precisa revisar os valores de tempos em tempos —
              sobretudo para itens pesados: uma resma de papel A4 tem cerca de 2,5 kg, e
              dez resmas num pedido mudam bastante o custo real do envio.
            </p>
          </section>
        </div>
      </div>

      {editing && (
        <ZoneForm
          value={editing}
          zones={zones}
          onClose={() => setEditing(null)}
          onSave={async (data) => {
            try {
              await saveZone(data)
              setEditing(null)
              toast(data.id ? 'Região atualizada.' : 'Região cadastrada.')
            } catch (err) {
              toast(err.message, 'err')
            }
          }}
        />
      )}

      <ConfirmDialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          try {
            await deleteZone(removing.id)
            toast('Região excluída.')
          } catch (err) {
            toast(err.message, 'err')
          }
        }}
        title="Excluir região"
        message={`“${removing?.name}” será removida. Clientes desse intervalo de CEP deixarão de conseguir escolher entrega.`}
      />
    </>
  )
}

/* -------------------------------------------------------------------------- */

function ZoneForm({ value, zones, onClose, onSave }) {
  const [f, setF] = useState({
    ...value,
    cepStart: formatCep(value.cepStart),
    cepEnd: formatCep(value.cepEnd),
  })
  const [errors, setErrors] = useState({})

  const set = (key, v) => {
    setF((old) => ({ ...old, [key]: v }))
    setErrors((e) => ({ ...e, [key]: undefined }))
  }

  const submit = (e) => {
    e.preventDefault()

    const start = normalizeCep(f.cepStart)
    const end = normalizeCep(f.cepEnd)
    const fee = Number(String(f.fee).replace(',', '.'))
    const days = Number(f.days)
    const err = {}

    if (f.name.trim().length < 2) err.name = 'Informe o nome da região.'
    if (!start) err.cepStart = 'CEP inicial incompleto.'
    if (!end) err.cepEnd = 'CEP final incompleto.'
    if (start && end && Number(start) > Number(end)) {
      err.cepEnd = 'O CEP final precisa ser maior que o inicial.'
    }
    if (!Number.isFinite(fee) || fee < 0) err.fee = 'Preço inválido.'
    if (!Number.isFinite(days) || days < 1) err.days = 'Informe ao menos 1 dia.'

    if (!Object.keys(err).length && f.active !== false) {
      const clash = findOverlap(
        { id: f.id, cepStart: start, cepEnd: end },
        zones,
      )
      if (clash) {
        err.cepStart = `Esta faixa se cruza com “${clash.name}” (${zoneRange(clash)}).`
      }
    }

    setErrors(err)
    if (Object.keys(err).length) return

    onSave({
      ...f,
      // Sem id em região nova: quem gera é o banco.
      id: f.id || null,
      name: f.name.trim(),
      cepStart: start,
      cepEnd: end,
      fee,
      days,
    })
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={f.id ? 'Editar região' : 'Nova região'}
      footer={
        <>
          <button className="btn btn--secondary" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn btn--primary" onClick={submit}>
            Salvar
          </button>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="stack gap-4">
        <div className={`field${errors.name ? ' has-error' : ''}`}>
          <label htmlFor="zf-name">Nome da região *</label>
          <input
            id="zf-name"
            className="input"
            value={f.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="Grande São Paulo"
          />
          {errors.name && <span className="err">{errors.name}</span>}
          <span className="hint">Este nome aparece para o cliente ao calcular o frete.</span>
        </div>

        <div className="form-grid">
          <div className={`field${errors.cepStart ? ' has-error' : ''}`}>
            <label htmlFor="zf-start">Do CEP *</label>
            <input
              id="zf-start"
              className="input"
              value={f.cepStart}
              onChange={(e) => set('cepStart', formatCep(e.target.value))}
              inputMode="numeric"
              maxLength={9}
              placeholder="06000-000"
            />
            {errors.cepStart && <span className="err">{errors.cepStart}</span>}
          </div>

          <div className={`field${errors.cepEnd ? ' has-error' : ''}`}>
            <label htmlFor="zf-end">Até o CEP *</label>
            <input
              id="zf-end"
              className="input"
              value={f.cepEnd}
              onChange={(e) => set('cepEnd', formatCep(e.target.value))}
              inputMode="numeric"
              maxLength={9}
              placeholder="09999-999"
            />
            {errors.cepEnd && <span className="err">{errors.cepEnd}</span>}
          </div>

          <div className={`field${errors.fee ? ' has-error' : ''}`}>
            <label htmlFor="zf-fee">Preço do frete (R$) *</label>
            <input
              id="zf-fee"
              className="input"
              inputMode="decimal"
              value={f.fee}
              onChange={(e) => set('fee', e.target.value)}
              placeholder="18,90"
            />
            {errors.fee && <span className="err">{errors.fee}</span>}
          </div>

          <div className={`field${errors.days ? ' has-error' : ''}`}>
            <label htmlFor="zf-days">Prazo (dias úteis) *</label>
            <input
              id="zf-days"
              className="input"
              inputMode="numeric"
              value={f.days}
              onChange={(e) => set('days', e.target.value.replace(/\D/g, ''))}
              placeholder="2"
            />
            {errors.days && <span className="err">{errors.days}</span>}
          </div>
        </div>

        <label className="switch">
          <input
            type="checkbox"
            checked={f.active !== false}
            onChange={(e) => set('active', e.target.checked)}
          />
          <span className="switch__track" />
          Atender esta região
        </label>
      </form>
    </Modal>
  )
}
