import { useMemo, useRef, useState } from 'react'
import { useStore } from '../../store/StoreContext'
import { effectivePrice, money, norm, slugify, uid } from '../../lib/format'
import Modal, { ConfirmDialog } from '../../components/Modal'
import ProductArt, { ART_KINDS, ART_LABELS } from '../../components/ProductArt'
import Icon from '../../components/Icon'

/* Cores das ilustrações: as quatro da logo primeiro, depois tons de apoio. */
const TINTS = [
  '#d32a1f', '#f2a81d', '#1f7a3a', '#0e8fa2',
  '#e5683a', '#c9a227', '#45a049', '#2c7d9e',
  '#a3231a', '#ff8a3d', '#8e6f1f', '#6e6a63',
]

const blank = (categoryId) => ({
  id: '',
  name: '',
  categoryId,
  price: '',
  promo: '',
  stock: '',
  unit: 'unidade',
  sku: '',
  art: 'sheet',
  tint: '#0e8fa2',
  image: '',
  featured: false,
  active: true,
  description: '',
  specs: [],
})

export default function AdminProducts() {
  const {
    products, categories, categoryById, settings,
    saveProduct, deleteProduct, toggleProduct, toast,
  } = useStore()

  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [view, setView] = useState('todos') // todos | ativos | inativos | baixo
  const [editing, setEditing] = useState(null)
  const [removing, setRemoving] = useState(null)

  const list = useMemo(() => {
    const term = norm(q)
    return products
      .filter((p) => {
        if (cat && p.categoryId !== cat) return false
        if (view === 'ativos' && !p.active) return false
        if (view === 'inativos' && p.active) return false
        if (view === 'baixo' && p.stock > settings.lowStockThreshold) return false
        if (term && !norm(`${p.name} ${p.sku}`).includes(term)) return false
        return true
      })
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  }, [products, q, cat, view, settings.lowStockThreshold])

  const counts = {
    todos: products.length,
    ativos: products.filter((p) => p.active).length,
    inativos: products.filter((p) => !p.active).length,
    baixo: products.filter((p) => p.stock <= settings.lowStockThreshold).length,
  }

  return (
    <>
      <header className="apage__head">
        <div>
          <h1>Produtos</h1>
          <p>{products.length} itens cadastrados no catálogo.</p>
        </div>
        <button
          className="btn btn--primary"
          onClick={() => setEditing(blank(categories[0]?.id ?? ''))}
        >
          <Icon name="plus" size={16} /> Novo produto
        </button>
      </header>

      <div className="atoolbar">
        <div className="asearch">
          <Icon name="search" size={17} />
          <input
            className="input"
            placeholder="Buscar por nome ou SKU…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {q && (
            <button className="icon-btn" onClick={() => setQ('')} aria-label="Limpar">
              <Icon name="close" size={15} />
            </button>
          )}
        </div>

        <select className="select" value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">Todas as categorias</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>

        <div className="segmented" role="tablist">
          {[
            ['todos', 'Todos'],
            ['ativos', 'Ativos'],
            ['inativos', 'Inativos'],
            ['baixo', 'Estoque baixo'],
          ].map(([v, label]) => (
            <button
              key={v}
              role="tab"
              aria-selected={view === v}
              className={view === v ? 'is-on' : ''}
              onClick={() => setView(v)}
            >
              {label} <em>{counts[v]}</em>
            </button>
          ))}
        </div>
      </div>

      <section className="acard acard--flush">
        <div className="table-wrap">
          <table className="table table--products">
            <thead>
              <tr>
                <th>Produto</th>
                <th>Categoria</th>
                <th className="ta-right">Preço</th>
                <th className="ta-right">Estoque</th>
                <th>Status</th>
                <th className="ta-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => {
                const low = p.stock <= settings.lowStockThreshold
                return (
                  <tr key={p.id} className={!p.active ? 'is-dim' : ''}>
                    <td>
                      <div className="cellprod">
                        <span className="cellprod__art">
                          <ProductArt product={p} />
                        </span>
                        <div>
                          <strong>{p.name}</strong>
                          <span className="mono">{p.sku || '—'}</span>
                        </div>
                        {p.featured && (
                          <span className="tag tag--blue" title="Aparece na home">
                            <Icon name="sparkles" size={12} /> Destaque
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="nowrap">{categoryById[p.categoryId]?.name ?? '—'}</td>
                    <td className="ta-right nowrap">
                      <strong>{money(effectivePrice(p))}</strong>
                      {p.promo > 0 && p.promo < p.price && (
                        <s className="cellprod__old">{money(p.price)}</s>
                      )}
                    </td>
                    <td className="ta-right">
                      <span className={`tag ${p.stock === 0 ? 'tag--red' : low ? 'tag--orange' : 'tag--gray'}`}>
                        {p.stock}
                      </span>
                    </td>
                    <td>
                      <label className="switch switch--bare" title={p.active ? 'Ativo' : 'Inativo'}>
                        <input
                          type="checkbox"
                          checked={p.active}
                          onChange={() =>
                            toggleProduct(p.id).catch((err) => toast(err.message, 'err'))
                          }
                        />
                        <span className="switch__track" />
                      </label>
                    </td>
                    <td className="ta-right nowrap">
                      <button
                        className="icon-btn"
                        onClick={() => setEditing({ ...p, specs: p.specs ?? [] })}
                        aria-label={`Editar ${p.name}`}
                      >
                        <Icon name="edit" size={17} />
                      </button>
                      <button
                        className="icon-btn icon-btn--danger"
                        onClick={() => setRemoving(p)}
                        aria-label={`Excluir ${p.name}`}
                      >
                        <Icon name="trash" size={17} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {list.length === 0 && (
          <div className="empty">
            <Icon name="box" size={40} strokeWidth={1.2} />
            <h3>Nenhum produto encontrado</h3>
            <p>Ajuste a busca ou cadastre um item novo.</p>
          </div>
        )}
      </section>

      {editing && (
        <ProductForm
          value={editing}
          categories={categories}
          onClose={() => setEditing(null)}
          onSave={async (data) => {
            try {
              await saveProduct(data)
              setEditing(null)
              toast(data.id ? 'Produto atualizado.' : 'Produto cadastrado.')
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
            await deleteProduct(removing.id)
            toast('Produto excluído.')
          } catch (err) {
            toast(err.message, 'err')
          }
        }}
        title="Excluir produto"
        message={`“${removing?.name}” será removido do catálogo. Pedidos já feitos não são afetados. Esta ação não pode ser desfeita.`}
      />
    </>
  )
}

/* -------------------------------------------------------------------------- */
/* Formulário                                                                  */
/* -------------------------------------------------------------------------- */

function ProductForm({ value, categories, onClose, onSave }) {
  const [f, setF] = useState({
    ...value,
    price: value.price === '' ? '' : String(value.price),
    promo: value.promo ? String(value.promo) : '',
    stock: value.stock === '' ? '' : String(value.stock),
  })
  const [errors, setErrors] = useState({})
  const [specDraft, setSpecDraft] = useState('')
  const fileRef = useRef(null)

  const set = (key, v) => {
    setF((old) => ({ ...old, [key]: v }))
    setErrors((e) => ({ ...e, [key]: undefined }))
  }

  const onImage = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 900_000) {
      setErrors((x) => ({ ...x, image: 'Imagem muito grande. Use até 900 KB.' }))
      return
    }
    const reader = new FileReader()
    reader.onload = () => set('image', String(reader.result))
    reader.readAsDataURL(file)
  }

  const addSpec = () => {
    const s = specDraft.trim()
    if (!s) return
    set('specs', [...(f.specs ?? []), s])
    setSpecDraft('')
  }

  const submit = (e) => {
    e.preventDefault()
    const err = {}
    const price = Number(String(f.price).replace(',', '.'))
    const promo = f.promo === '' ? 0 : Number(String(f.promo).replace(',', '.'))
    const stock = Number(f.stock)

    if (f.name.trim().length < 3) err.name = 'Informe o nome do produto.'
    if (!f.categoryId) err.categoryId = 'Escolha uma categoria.'
    if (!(price > 0)) err.price = 'Preço deve ser maior que zero.'
    if (promo < 0) err.promo = 'Valor inválido.'
    if (promo > 0 && promo >= price) err.promo = 'A promoção deve ser menor que o preço.'
    if (!Number.isFinite(stock) || stock < 0) err.stock = 'Estoque inválido.'

    setErrors(err)
    if (Object.keys(err).length) return

    onSave({
      ...f,
      id: f.id || uid('p'),
      name: f.name.trim(),
      sku: (
        f.sku ||
        slugify(f.name).slice(0, 14).replace(/-+$/, '').toUpperCase()
      ).trim(),
      price,
      promo,
      stock,
      description: f.description.trim(),
      specs: f.specs ?? [],
    })
  }

  const preview = {
    ...f,
    price: Number(String(f.price).replace(',', '.')) || 0,
    promo: Number(String(f.promo).replace(',', '.')) || 0,
  }

  return (
    <Modal
      open
      onClose={onClose}
      wide
      title={f.id ? 'Editar produto' : 'Novo produto'}
      footer={
        <>
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="button" className="btn btn--primary" onClick={submit}>
            {f.id ? 'Salvar alterações' : 'Cadastrar produto'}
          </button>
        </>
      }
    >
      <form onSubmit={submit} noValidate className="pform">
        {/* ------------------------------------------------------- Imagem */}
        <div className="pform__media">
          <div className="pform__preview">
            <ProductArt product={preview} />
          </div>

          <div className="pform__media-actions">
            <button
              type="button"
              className="btn btn--outline btn--sm btn--block"
              onClick={() => fileRef.current?.click()}
            >
              <Icon name="image" size={15} /> {f.image ? 'Trocar foto' : 'Enviar foto'}
            </button>
            {f.image && (
              <button
                type="button"
                className="btn btn--ghost btn--sm btn--block"
                onClick={() => set('image', '')}
              >
                Usar ilustração
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={onImage}
              hidden
            />
            {errors.image && <span className="err">{errors.image}</span>}
            <p className="hint">PNG ou JPG quadrado, até 900 KB.</p>
          </div>
        </div>

        {/* -------------------------------------------------------- Campos */}
        <div className="pform__fields">
          <div className={`field${errors.name ? ' has-error' : ''}`}>
            <label htmlFor="pf-name">Nome *</label>
            <input
              id="pf-name"
              className="input"
              value={f.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="Papel Sulfite A4 75g — Resma 500 folhas"
            />
            {errors.name && <span className="err">{errors.name}</span>}
          </div>

          <div className="form-grid">
            <div className={`field${errors.categoryId ? ' has-error' : ''}`}>
              <label htmlFor="pf-cat">Categoria *</label>
              <select
                id="pf-cat"
                className="select"
                value={f.categoryId}
                onChange={(e) => set('categoryId', e.target.value)}
              >
                <option value="">Selecione…</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {errors.categoryId && <span className="err">{errors.categoryId}</span>}
            </div>

            <div className="field">
              <label htmlFor="pf-sku">SKU</label>
              <input
                id="pf-sku"
                className="input"
                value={f.sku}
                onChange={(e) => set('sku', e.target.value.toUpperCase())}
                placeholder="Gerado automaticamente"
              />
            </div>

            <div className={`field${errors.price ? ' has-error' : ''}`}>
              <label htmlFor="pf-price">Preço (R$) *</label>
              <input
                id="pf-price"
                className="input"
                inputMode="decimal"
                value={f.price}
                onChange={(e) => set('price', e.target.value)}
                placeholder="32,90"
              />
              {errors.price && <span className="err">{errors.price}</span>}
            </div>

            <div className={`field${errors.promo ? ' has-error' : ''}`}>
              <label htmlFor="pf-promo">Preço promocional</label>
              <input
                id="pf-promo"
                className="input"
                inputMode="decimal"
                value={f.promo}
                onChange={(e) => set('promo', e.target.value)}
                placeholder="Deixe vazio se não houver"
              />
              {errors.promo && <span className="err">{errors.promo}</span>}
            </div>

            <div className={`field${errors.stock ? ' has-error' : ''}`}>
              <label htmlFor="pf-stock">Estoque *</label>
              <input
                id="pf-stock"
                className="input"
                inputMode="numeric"
                value={f.stock}
                onChange={(e) => set('stock', e.target.value.replace(/\D/g, ''))}
                placeholder="120"
              />
              {errors.stock && <span className="err">{errors.stock}</span>}
            </div>

            <div className="field">
              <label htmlFor="pf-unit">Unidade de venda</label>
              <input
                id="pf-unit"
                className="input"
                value={f.unit}
                onChange={(e) => set('unit', e.target.value)}
                placeholder="resma, folha, caixa…"
              />
            </div>
          </div>

          <div className="field">
            <label htmlFor="pf-desc">Descrição</label>
            <textarea
              id="pf-desc"
              className="textarea"
              value={f.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="Detalhe material, gramatura, dimensões e uso."
            />
          </div>

          {/* Especificações */}
          <div className="field">
            <span className="label">Especificações</span>
            {f.specs?.length > 0 && (
              <ul className="speclist">
                {f.specs.map((s, i) => (
                  <li key={`${s}-${i}`}>
                    <Icon name="check" size={14} />
                    <span>{s}</span>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => set('specs', f.specs.filter((_, j) => j !== i))}
                      aria-label={`Remover ${s}`}
                    >
                      <Icon name="close" size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="row gap-2">
              <input
                className="input"
                value={specDraft}
                onChange={(e) => setSpecDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    addSpec()
                  }
                }}
                placeholder="Ex.: Gramatura 75 g/m²"
              />
              <button type="button" className="btn btn--secondary" onClick={addSpec}>
                Adicionar
              </button>
            </div>
          </div>

          {/* Ilustração */}
          {!f.image && (
            <>
              <div className="field">
                <span className="label">Ilustração</span>
                <div className="artpicker">
                  {ART_KINDS.map((k) => (
                    <button
                      key={k}
                      type="button"
                      className={`artpicker__item${f.art === k ? ' is-on' : ''}`}
                      onClick={() => set('art', k)}
                      title={ART_LABELS[k]}
                    >
                      <ProductArt product={{ art: k, tint: f.tint }} />
                    </button>
                  ))}
                </div>
              </div>

              <div className="field">
                <span className="label">Cor</span>
                <div className="tintpicker">
                  {TINTS.map((t) => (
                    <button
                      key={t}
                      type="button"
                      className={`tintpicker__item${f.tint === t ? ' is-on' : ''}`}
                      style={{ '--c': t }}
                      onClick={() => set('tint', t)}
                      aria-label={`Cor ${t}`}
                    />
                  ))}
                </div>
              </div>
            </>
          )}

          <div className="pform__toggles">
            <label className="switch">
              <input
                type="checkbox"
                checked={f.active}
                onChange={(e) => set('active', e.target.checked)}
              />
              <span className="switch__track" />
              Visível na loja
            </label>

            <label className="switch">
              <input
                type="checkbox"
                checked={f.featured}
                onChange={(e) => set('featured', e.target.checked)}
              />
              <span className="switch__track" />
              Destacar na página inicial
            </label>
          </div>
        </div>
      </form>
    </Modal>
  )
}
