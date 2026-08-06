import { useRef, useState } from 'react'
import { useStore } from '../../store/StoreContext'
import { exportAll } from '../../lib/storage'
import { maskPhone } from '../../lib/format'
import { ConfirmDialog } from '../../components/Modal'
import Icon from '../../components/Icon'

export default function AdminSettings() {
  const { settings, setSettings, resetCatalog, importBackup, changePassword, toast } = useStore()

  const [f, setF] = useState({
    ...settings,
    shippingFee: String(settings.shippingFee),
    freeShippingFrom: String(settings.freeShippingFrom),
    lowStockThreshold: String(settings.lowStockThreshold),
  })
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' })
  const [pwError, setPwError] = useState('')
  const [resetting, setResetting] = useState(false)
  const fileRef = useRef(null)

  const set = (key) => (e) =>
    setF((old) => ({
      ...old,
      [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value,
    }))

  const saveStore = (e) => {
    e.preventDefault()
    setSettings((s) => ({
      ...s,
      ...f,
      whatsapp: String(f.whatsapp).replace(/\D/g, ''),
      shippingFee: Number(String(f.shippingFee).replace(',', '.')) || 0,
      freeShippingFrom: Number(String(f.freeShippingFrom).replace(',', '.')) || 0,
      lowStockThreshold: Number(f.lowStockThreshold) || 0,
    }))
    toast('Configurações salvas.')
  }

  const savePassword = (e) => {
    e.preventDefault()
    setPwError('')
    if (pw.next.length < 6) return setPwError('A nova senha precisa ter ao menos 6 caracteres.')
    if (pw.next !== pw.confirm) return setPwError('A confirmação não confere.')
    if (!changePassword(pw.current, pw.next)) return setPwError('Senha atual incorreta.')
    setPw({ current: '', next: '', confirm: '' })
    toast('Senha alterada.')
  }

  const download = () => {
    const data = exportAll()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `totalpack-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    toast('Backup exportado.')
  }

  const upload = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        importBackup(JSON.parse(String(reader.result)))
        toast('Backup restaurado.')
      } catch (err) {
        toast(err.message ?? 'Arquivo inválido.', 'err')
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  return (
    <>
      <header className="apage__head">
        <div>
          <h1>Configurações</h1>
          <p>Dados da loja, regras de entrega, acesso e backup.</p>
        </div>
      </header>

      <div className="acols acols--settings">
        {/* --------------------------------------------------------- Loja */}
        <form className="acard" onSubmit={saveStore}>
          <header className="acard__head">
            <h2>Dados da loja</h2>
          </header>

          <div className="stack gap-4">
            <div className="form-grid">
              <div className="field col-2">
                <label htmlFor="s-name">Nome da loja</label>
                <input id="s-name" className="input" value={f.storeName} onChange={set('storeName')} />
              </div>

              <div className="field col-2">
                <label htmlFor="s-tag">Frase de apoio</label>
                <input id="s-tag" className="input" value={f.tagline} onChange={set('tagline')} />
              </div>

              <div className="field">
                <label htmlFor="s-wa">WhatsApp (com DDI)</label>
                <input
                  id="s-wa"
                  className="input"
                  value={f.whatsapp}
                  onChange={set('whatsapp')}
                  placeholder="5511999999999"
                />
                <span className="hint">
                  Usado no botão de pedido: {maskPhone(String(f.whatsapp).slice(2))}
                </span>
              </div>

              <div className="field">
                <label htmlFor="s-mail">E-mail</label>
                <input id="s-mail" className="input" type="email" value={f.email} onChange={set('email')} />
              </div>

              <div className="field col-2">
                <label htmlFor="s-addr">Endereço</label>
                <input id="s-addr" className="input" value={f.address} onChange={set('address')} />
              </div>

              <div className="field">
                <label htmlFor="s-hours">Horário</label>
                <input id="s-hours" className="input" value={f.hours} onChange={set('hours')} />
              </div>

              <div className="field">
                <label htmlFor="s-ig">Instagram</label>
                <input id="s-ig" className="input" value={f.instagram} onChange={set('instagram')} />
              </div>

              <div className="field col-2">
                <label htmlFor="s-pix">Chave PIX</label>
                <input id="s-pix" className="input" value={f.pixKey} onChange={set('pixKey')} />
              </div>
            </div>

            <hr className="rule" />

            <div className="form-grid">
              <div className="field">
                <label htmlFor="s-fee">Frete padrão (R$)</label>
                <input
                  id="s-fee"
                  className="input"
                  inputMode="decimal"
                  value={f.shippingFee}
                  onChange={set('shippingFee')}
                />
              </div>

              <div className="field">
                <label htmlFor="s-free">Frete grátis a partir de (R$)</label>
                <input
                  id="s-free"
                  className="input"
                  inputMode="decimal"
                  value={f.freeShippingFrom}
                  onChange={set('freeShippingFrom')}
                />
              </div>

              <div className="field">
                <label htmlFor="s-low">Alerta de estoque baixo (un.)</label>
                <input
                  id="s-low"
                  className="input"
                  inputMode="numeric"
                  value={f.lowStockThreshold}
                  onChange={set('lowStockThreshold')}
                />
              </div>

              <div className="field" style={{ justifyContent: 'flex-end' }}>
                <label className="switch">
                  <input type="checkbox" checked={f.pickupEnabled} onChange={set('pickupEnabled')} />
                  <span className="switch__track" />
                  Permitir retirada na loja
                </label>
              </div>
            </div>

            <div className="row gap-3">
              <button className="btn btn--primary" type="submit">
                Salvar alterações
              </button>
            </div>
          </div>
        </form>

        <div className="stack gap-6">
          {/* ------------------------------------------------------ Senha */}
          <form className="acard" onSubmit={savePassword}>
            <header className="acard__head">
              <h2>Senha de acesso</h2>
            </header>

            <div className="stack gap-4">
              <div className={`field${pwError ? ' has-error' : ''}`}>
                <label htmlFor="pw-cur">Senha atual</label>
                <input
                  id="pw-cur"
                  className="input"
                  type="password"
                  value={pw.current}
                  onChange={(e) => setPw({ ...pw, current: e.target.value })}
                  autoComplete="current-password"
                />
              </div>

              <div className="field">
                <label htmlFor="pw-new">Nova senha</label>
                <input
                  id="pw-new"
                  className="input"
                  type="password"
                  value={pw.next}
                  onChange={(e) => setPw({ ...pw, next: e.target.value })}
                  autoComplete="new-password"
                />
              </div>

              <div className="field">
                <label htmlFor="pw-conf">Confirmar nova senha</label>
                <input
                  id="pw-conf"
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

              <p className="hint">
                A senha é guardada apenas neste navegador, de forma ofuscada. Para uma loja
                em produção, mova a autenticação para um servidor.
              </p>
            </div>
          </form>

          {/* ----------------------------------------------------- Backup */}
          <section className="acard">
            <header className="acard__head">
              <h2>Backup e dados</h2>
            </header>

            <div className="stack gap-3">
              <button className="btn btn--outline btn--block" onClick={download}>
                <Icon name="download" size={16} /> Exportar backup (.json)
              </button>

              <button
                className="btn btn--outline btn--block"
                onClick={() => fileRef.current?.click()}
              >
                <Icon name="upload" size={16} /> Restaurar backup
              </button>
              <input ref={fileRef} type="file" accept="application/json" hidden onChange={upload} />

              <hr className="rule" />

              <button className="btn btn--danger btn--block" onClick={() => setResetting(true)}>
                <Icon name="refresh" size={16} /> Restaurar catálogo de exemplo
              </button>
              <p className="hint">
                Substitui produtos, categorias e pedidos pelos dados originais de
                demonstração. A senha é preservada.
              </p>
            </div>
          </section>
        </div>
      </div>

      <ConfirmDialog
        open={resetting}
        onClose={() => setResetting(false)}
        onConfirm={() => {
          resetCatalog()
          toast('Catálogo restaurado.')
        }}
        title="Restaurar catálogo de exemplo"
        message="Todos os produtos, categorias e pedidos atuais serão substituídos pelos dados de demonstração. Exporte um backup antes se quiser preservar o que existe hoje."
        confirmLabel="Restaurar"
      />
    </>
  )
}
