import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useStore } from '../../store/StoreContext'
import Icon from '../../components/Icon'
import { api } from '../../lib/api'

export default function AdminSettings() {
  const { settings, saveSettings, changePassword, toast } = useStore()

  const [f, setF] = useState({
    ...settings,
    freeShippingFrom: String(settings.freeShippingFrom),
    lowStockThreshold: String(settings.lowStockThreshold),
  })
  const [saving, setSaving] = useState(false)
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' })
  const [pwError, setPwError] = useState('')
  const [teste, setTeste] = useState(null)
  const [testando, setTestando] = useState(false)

  /* O que ainda falta para a transportadora aceitar o endereço de origem. */
  const faltamRemetente = [
    ['senderDoc', 'CNPJ ou CPF'],
    ['senderCep', 'CEP'],
    ['senderStreet', 'rua'],
    ['senderNumber', 'número'],
    ['senderDistrict', 'bairro'],
    ['senderCity', 'cidade'],
    ['senderState', 'UF'],
  ]
    .filter(([campo]) => !String(f[campo] ?? '').trim())
    .map(([, rotulo]) => rotulo)

  const set = (key) => (e) =>
    setF((old) => ({
      ...old,
      [key]: e.target.type === 'checkbox' ? e.target.checked : e.target.value,
    }))

  const saveStore = async (e) => {
    e.preventDefault()
    setSaving(true)
    try {
      await saveSettings({
        ...f,
        freeShippingFrom: Number(String(f.freeShippingFrom).replace(',', '.')) || 0,
        lowStockThreshold: Number(f.lowStockThreshold) || 0,
      })
      toast('Configurações salvas.')
    } catch (err) {
      toast(err.message, 'err')
    } finally {
      setSaving(false)
    }
  }

  const savePassword = async (e) => {
    e.preventDefault()
    setPwError('')
    if (pw.next.length < 8) return setPwError('A nova senha precisa ter ao menos 8 caracteres.')
    if (pw.next !== pw.confirm) return setPwError('A confirmação não confere.')
    if (!(await changePassword(pw.current, pw.next))) return setPwError('Senha atual incorreta.')
    setPw({ current: '', next: '', confirm: '' })
    toast('Senha alterada.')
  }

  return (
    <>
      <header className="apage__head">
        <div>
          <h1>Configurações</h1>
          <p>Dados da loja, acesso e informações do sistema.</p>
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
                <label htmlFor="s-mail">E-mail</label>
                <input id="s-mail" className="input" type="email" value={f.email} onChange={set('email')} />
                <span className="hint">
                  Canal de contato: aparece no rodapé, na ajuda da página inicial e quando um
                  CEP fica fora de cobertura.
                </span>
              </div>

              <div className="field">
                <label htmlFor="s-phone">Telefone</label>
                <input id="s-phone" className="input" value={f.phone} onChange={set('phone')} />
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

            <h3 className="apage__sub">Avisos por e-mail</h3>
            <p className="hint">
              A loja avisa você a cada venda, e o cliente a cada etapa — incluindo
              o código de rastreio quando a etiqueta sai.
            </p>

            <div className="field">
              <label htmlFor="s-emailkey">Chave do provedor de e-mail</label>
              <input
                id="s-emailkey"
                className="input"
                type="password"
                value={f.emailKey ?? ''}
                onChange={set('emailKey')}
                placeholder="cole aqui a chave que começa com re_…"
                autoComplete="off"
                spellCheck={false}
              />
              <span className="hint">
                Como a da transportadora, o valor gravado nunca volta para esta
                tela: deixar em branco mantém o que já está salvo.
              </span>
            </div>

            <div className="field">
              <label htmlFor="s-notify">Receber aviso de venda em</label>
              <input
                id="s-notify"
                className="input"
                type="email"
                value={f.notifyEmail ?? ''}
                onChange={set('notifyEmail')}
                placeholder={f.email}
              />
              <span className="hint">
                Em branco usa o e-mail de contato da loja ({f.email || '—'}).
              </span>
            </div>

            <label className="switchrow">
              <input
                type="checkbox"
                checked={f.notifyCustomer !== false}
                onChange={set('notifyCustomer')}
              />
              <span>
                <strong>Avisar o cliente por e-mail</strong>
                Confirmação do pedido, aviso de pagamento e o código de rastreio
                quando a encomenda sair. Desligue se preferir falar por outro canal
                — o aviso de venda para você continua vindo.
              </span>
            </label>

            <hr className="rule" />

            {/* Remetente da etiqueta — separado do endereço acima de propósito:
                aquele é texto livre para mostrar no rodapé, este vai para a
                transportadora e precisa de cada parte no seu campo. */}
            <h3 className="apage__sub">Remetente das etiquetas</h3>
            <p className="hint">
              Usado na cotação e na emissão da etiqueta. Sem estes campos, a
              transportadora não calcula o frete nem aceita a postagem.
            </p>

            {/* O token fica aqui, e não em variável de ambiente, porque trocar
                variável no Railway exige deploy — e deploy falha. Colado aqui,
                vale na cotação seguinte. */}
            <div className="field">
              <label htmlFor="s-metoken">Chave da transportadora (Melhor Envio)</label>
              <input
                id="s-metoken"
                className="input"
                type="password"
                value={f.melhorenvioToken ?? ''}
                onChange={set('melhorenvioToken')}
                placeholder="cole aqui o token que começa com eyJ…"
                autoComplete="off"
                spellCheck={false}
              />
              <span className="hint">
                Pegue em GERENCIAR → TOKENS no painel do Melhor Envio. Não é o
                <code> client_secret</code> da Área Dev, que tem 40 caracteres.
                Por segurança o valor gravado nunca volta para esta tela: deixar
                em branco mantém o que já está salvo.
              </span>
            </div>

            <label className="switchrow">
              <input
                type="checkbox"
                checked={f.autoLabel !== false}
                onChange={set('autoLabel')}
              />
              <span>
                <strong>Comprar a etiqueta automaticamente</strong>
                Assim que o pagamento é confirmado, a loja compra a etiqueta do
                serviço que o cliente escolheu e debita da sua carteira no Melhor
                Envio. Desligue se preferir conferir cada pedido antes de despachar.
              </span>
            </label>

            {/* Teste de conexão: dispara uma cotação de mentira e mostra o
                retorno cru da transportadora, sem precisar ir ao checkout. */}
            <div className="testeconn">
              <button
                type="button"
                className="btn btn--outline btn--sm"
                disabled={testando}
                onClick={async () => {
                  setTestando(true)
                  setTeste(null)
                  try {
                    setTeste(await api.post('/shipping/test'))
                  } catch (err) {
                    setTeste({ ok: false, conclusao: err.message })
                  } finally {
                    setTestando(false)
                  }
                }}
              >
                <Icon name="refresh" size={15} />
                {testando ? 'Testando…' : 'Testar conexão com a transportadora'}
              </button>

              {teste && (
                <div className={`testeconn__res${teste.ok ? ' is-ok' : ''}`}>
                  <strong>
                    <Icon name={teste.ok ? 'checkCircle' : 'alert'} size={15} /> {teste.conclusao}
                  </strong>

                  {teste.configuracao && (
                    <dl className="testeconn__cfg">
                      <div><dt>Provedor</dt><dd>{teste.configuracao.provedor}</dd></div>
                      <div><dt>Endereço da API</dt><dd>{teste.configuracao.endereco}</dd></div>
                      <div><dt>Ambiente</dt><dd>{teste.configuracao.ambienteDoEndereco}</dd></div>
                      <div>
                        <dt>Token</dt>
                        <dd>
                          {teste.configuracao.tokenPresente
                            ? `${teste.configuracao.tokenTamanho} caracteres · ${
                                teste.configuracao.pareceToken
                                  ? 'formato de JWT (certo)'
                                  : 'NÃO parece um JWT'
                              } · vindo do ${teste.configuracao.origemDoToken}`
                            : 'ausente'}
                        </dd>
                      </div>
                      <div><dt>User-Agent</dt><dd>{teste.configuracao.userAgent}</dd></div>
                      <div>
                        <dt>Renovação automática</dt>
                        <dd>{teste.configuracao.renovacaoConfigurada ? 'configurada' : 'não'}</dd>
                      </div>
                      <div><dt>CEP de origem</dt><dd>{teste.configuracao.remetenteCep}</dd></div>
                    </dl>
                  )}

                  {teste.servicos?.length > 0 && (
                    <ul className="testeconn__srv">
                      {teste.servicos.map((sv) => (
                        <li key={sv.servicoId}>
                          {sv.transportadora} {sv.nome} — R$ {sv.preco} · {sv.prazoDias} dia(s)
                        </li>
                      ))}
                    </ul>
                  )}

                  {teste.causa && <p className="testeconn__cru">{teste.causa}</p>}
                  {teste.corpo && (
                    <p className="testeconn__cru">{JSON.stringify(teste.corpo).slice(0, 400)}</p>
                  )}
                </div>
              )}
            </div>

            {faltamRemetente.length > 0 && (
              <div className="avisofrete avisofrete--inline">
                <Icon name="alert" size={18} />
                <div>
                  <strong>Remetente incompleto</strong>
                  <p>
                    Falta preencher: {faltamRemetente.join(', ')}. Sem isso o frete
                    não é calculado e ninguém consegue finalizar a compra.
                  </p>
                </div>
              </div>
            )}

            <div className="form-grid">
              <div className="field">
                <label htmlFor="s-sname">Nome ou razão social</label>
                <input
                  id="s-sname"
                  className="input"
                  value={f.senderName ?? ''}
                  onChange={set('senderName')}
                  placeholder={f.storeName}
                />
              </div>

              <div className="field">
                <label htmlFor="s-sdoc">CNPJ ou CPF</label>
                <input
                  id="s-sdoc"
                  className="input"
                  value={f.senderDoc ?? ''}
                  onChange={set('senderDoc')}
                  inputMode="numeric"
                />
              </div>

              <div className="field">
                <label htmlFor="s-scep">CEP</label>
                <input
                  id="s-scep"
                  className="input"
                  value={f.senderCep ?? ''}
                  onChange={set('senderCep')}
                  inputMode="numeric"
                  placeholder="17232232"
                />
              </div>

              <div className="field">
                <label htmlFor="s-snum">Número</label>
                <input
                  id="s-snum"
                  className="input"
                  value={f.senderNumber ?? ''}
                  onChange={set('senderNumber')}
                />
              </div>

              <div className="field col-2">
                <label htmlFor="s-sstreet">Rua</label>
                <input
                  id="s-sstreet"
                  className="input"
                  value={f.senderStreet ?? ''}
                  onChange={set('senderStreet')}
                />
              </div>

              <div className="field">
                <label htmlFor="s-scompl">Complemento</label>
                <input
                  id="s-scompl"
                  className="input"
                  value={f.senderCompl ?? ''}
                  onChange={set('senderCompl')}
                />
              </div>

              <div className="field">
                <label htmlFor="s-sdist">Bairro</label>
                <input
                  id="s-sdist"
                  className="input"
                  value={f.senderDistrict ?? ''}
                  onChange={set('senderDistrict')}
                />
              </div>

              <div className="field">
                <label htmlFor="s-scity">Cidade</label>
                <input
                  id="s-scity"
                  className="input"
                  value={f.senderCity ?? ''}
                  onChange={set('senderCity')}
                />
              </div>

              <div className="field field--uf">
                <label htmlFor="s-sstate">UF</label>
                <input
                  id="s-sstate"
                  className="input"
                  value={f.senderState ?? ''}
                  onChange={set('senderState')}
                  maxLength={2}
                />
              </div>
            </div>

            <hr className="rule" />

            <div className="form-grid">
              <div className="field">
                <label htmlFor="s-low">Alerta de estoque baixo (un.)</label>
                <input
                  id="s-low"
                  className="input"
                  inputMode="numeric"
                  value={f.lowStockThreshold}
                  onChange={set('lowStockThreshold')}
                />
                <span className="hint">
                  Produtos neste nível aparecem destacados na visão geral.
                </span>
              </div>

              <div className="field">
                <span className="label">Frete</span>
                <Link to="/admin/entrega" className="btn btn--outline">
                  <Icon name="truck" size={16} /> Configurar entrega
                </Link>
              </div>
            </div>

            <div className="row gap-3">
              <button className="btn btn--primary" type="submit" disabled={saving}>
                {saving ? 'Salvando…' : 'Salvar alterações'}
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
                A senha é guardada no banco com bcrypt e conferida no servidor. Nem o
                navegador nem o banco veem a senha em texto.
              </p>
            </div>
          </form>

          {/* -------------------------------------------------- Backup */}
          <section className="acard">
            <header className="acard__head">
              <h2>Backup dos dados</h2>
            </header>

            <div className="stack gap-3">
              <p className="acard__note">
                Os dados agora vivem no PostgreSQL, então o backup é do banco, não de um
                arquivo baixado pelo navegador. O comando abaixo gera uma cópia completa:
              </p>

              <pre className="codeblock">pg_dump -U totalpack -d totalpack -F c -f backup.dump</pre>

              <p className="acard__note">
                Para restaurar: <code>pg_restore -U totalpack -d totalpack backup.dump</code>.
                Vale agendar isso para rodar sozinho antes de a loja receber pedidos de
                verdade.
              </p>
            </div>
          </section>
        </div>
      </div>
    </>
  )
}
