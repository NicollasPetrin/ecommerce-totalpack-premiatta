import { useMemo, useRef, useState } from 'react'
import { useStore } from '../../store/StoreContext'
import { effectivePrice, money, norm, slugify } from '../../lib/format'
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
  // Medidas do pacote, exigidas pela transportadora para emitir a etiqueta.
  weightG: '',
  lengthCm: '',
  widthCm: '',
  heightCm: '',
  variantAxes: [],
  variants: [],
})

const uid = () => Math.random().toString(36).slice(2)

/* Espelham os limites do servidor, para o erro aparecer antes de enviar. */
const MAX_EIXOS = 3
const MAX_OPCOES = 60
const MAX_COMBINACOES = 300

/** Rótulo pronto de uma combinação: { Cor:'Azul', Tam:'P' } → "Azul / P". */
const rotulo = (eixos, opcoes) =>
  eixos.map((a) => opcoes[a.name]).filter(Boolean).join(' / ')

/**
 * Produto cartesiano dos eixos — é o que os ERPs chamam de "gerar grade".
 *
 * Devolve uma combinação por cruzamento: dois eixos de 3 e 4 opções geram 12
 * linhas. Eixo sem opção nenhuma é ignorado, senão zeraria o produto inteiro.
 */
function gerarGrade(eixos) {
  const validos = eixos.filter((a) => a.name.trim() && a.options.length > 0)
  if (!validos.length) return []

  return validos.reduce(
    (acc, eixo) =>
      acc.flatMap((parcial) => eixo.options.map((o) => ({ ...parcial, [eixo.name.trim()]: o }))),
    [{}],
  )
}

/** Linha nova da grade. */
const variacaoVazia = (opcoes = {}, eixos = []) => ({
  id: null,
  // Chave só do formulário: a variação ainda não tem id do banco, e usar o
  // índice faria o React embaralhar os campos ao remover uma linha do meio.
  uid: uid(),
  options: opcoes,
  name: rotulo(eixos, opcoes),
  sku: '',
  gtin: '',
  price: '',
  promo: '',
  stock: '',
  active: true,
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
                <th className="hide-sm hide-md">Categoria</th>
                <th className="ta-right">Preço</th>
                <th className="ta-right">Estoque</th>
                <th className="hide-sm">Status</th>
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
                          <span className="tag tag--blue hide-sm hide-md" title="Aparece na home">
                            <Icon name="sparkles" size={12} /> Destaque
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="nowrap hide-sm hide-md">{categoryById[p.categoryId]?.name ?? '—'}</td>
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
                    <td className="hide-sm">
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
    weightG: value.weightG ? String(value.weightG) : '',
    lengthCm: value.lengthCm ? String(value.lengthCm) : '',
    widthCm: value.widthCm ? String(value.widthCm) : '',
    heightCm: value.heightCm ? String(value.heightCm) : '',
    variantAxes: (value.variantAxes ?? []).map((a) => ({ ...a, uid: uid() })),
    variants: (value.variants ?? []).map((v) => ({
      ...v,
      uid: v.id ?? uid(),
      options: v.options ?? {},
      gtin: v.gtin ?? '',
      price: v.price === '' ? '' : String(v.price),
      promo: v.promo ? String(v.promo) : '',
      stock: v.stock === '' ? '' : String(v.stock),
    })),
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

  /* ---- Eixos da grade ---- */
  const setEixo = (u, campo, v) => {
    setF((old) => ({
      ...old,
      variantAxes: old.variantAxes.map((a) => (a.uid === u ? { ...a, [campo]: v } : a)),
    }))
    setErrors((e) => ({ ...e, variantAxes: undefined }))
  }

  const addEixo = () =>
    setF((old) => ({ ...old, variantAxes: [...old.variantAxes, { uid: uid(), name: '', options: [] }] }))

  const removeEixo = (u) =>
    setF((old) => ({ ...old, variantAxes: old.variantAxes.filter((a) => a.uid !== u) }))

  /**
   * Gera a grade preservando o que já existe.
   *
   * Combinação que já tinha preço e estoque é mantida pelo id — regerar do
   * zero apagaria o estoque digitado e quebraria o vínculo com os pedidos.
   * O que sumiu da grade sai; o que é novo entra em branco.
   */
  const gerar = () => {
    setF((old) => {
      const eixos = old.variantAxes
      const pontos = gerarGrade(eixos)
      if (!pontos.length) return old

      const antigas = new Map(old.variants.map((v) => [rotulo(eixos, v.options ?? {}), v]))

      return {
        ...old,
        variants: pontos.map((opcoes) => {
          const chave = rotulo(eixos, opcoes)
          const existente = antigas.get(chave)
          return existente
            ? { ...existente, options: opcoes, name: chave }
            : variacaoVazia(opcoes, eixos)
        }),
      }
    })
    setErrors((e) => ({ ...e, variants: undefined }))
  }

  /* ---- Linhas da grade ---- */
  const setVariacao = (u, campo, v) => {
    setF((old) => ({
      ...old,
      variants: old.variants.map((x) => (x.uid === u ? { ...x, [campo]: v } : x)),
    }))
    setErrors((e) => ({ ...e, variants: undefined }))
  }

  const removeVariacao = (u) =>
    setF((old) => ({ ...old, variants: old.variants.filter((x) => x.uid !== u) }))

  /** Preenche a coluna inteira a partir da primeira linha — atalho de ERP. */
  const replicar = (campo) =>
    setF((old) => {
      const valor = old.variants[0]?.[campo] ?? ''
      return { ...old, variants: old.variants.map((v) => ({ ...v, [campo]: valor })) }
    })

  const combinacoesPrevistas = gerarGrade(f.variantAxes).length

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

    const eixos = f.variantAxes
      .map((a) => ({ name: a.name.trim(), options: a.options.filter((o) => o.trim()) }))
      .filter((a) => a.name && a.options.length > 0)

    const variacoes = f.variants.map((v) => ({
      id: v.id || null,
      name: rotulo(eixos, v.options ?? {}) || v.name.trim(),
      options: v.options ?? {},
      sku: v.sku.trim(),
      gtin: v.gtin.trim(),
      price: Number(String(v.price).replace(',', '.')),
      promo: v.promo === '' ? 0 : Number(String(v.promo).replace(',', '.')),
      stock: Number(v.stock),
      active: v.active !== false,
    }))

    if (variacoes.length > 0) {
      const nomesEixo = eixos.map((a) => a.name.toLowerCase())
      if (eixos.length === 0) {
        err.variantAxes = 'Defina ao menos um eixo com opções (ex.: Cor: Azul, Vermelho).'
      } else if (new Set(nomesEixo).size !== nomesEixo.length) {
        err.variantAxes = 'Há eixos com o mesmo nome.'
      } else if (
        eixos.some((a) => {
          const o = a.options.map((x) => x.toLowerCase())
          return new Set(o).size !== o.length
        })
      ) {
        err.variantAxes = 'Há opções repetidas dentro de um eixo.'
      } else if (eixos.length > MAX_EIXOS) {
        err.variantAxes = `Máximo de ${MAX_EIXOS} eixos de variação.`
      } else if (eixos.some((a) => a.options.length > MAX_OPCOES)) {
        err.variantAxes = `Máximo de ${MAX_OPCOES} opções por eixo.`
      } else if (variacoes.length > MAX_COMBINACOES) {
        err.variants = `Máximo de ${MAX_COMBINACOES} combinações por produto. Esta grade tem ${variacoes.length}.`
      } else if (
        variacoes.some((v) => !eixos.every((a) => a.options.includes(v.options?.[a.name])))
      ) {
        err.variants = 'A grade está desatualizada. Toque em “Gerar grade”.'
      }

      if (err.variantAxes || err.variants) {
        // já há erro estrutural: não vale checar preço linha a linha
      } else if (variacoes.some((v) => !v.name)) err.variants = 'Toda variação precisa de nome.'
      else if (variacoes.some((v) => !(v.price > 0))) {
        err.variants = 'Toda variação precisa de preço maior que zero.'
      } else if (variacoes.some((v) => v.promo > 0 && v.promo >= v.price)) {
        err.variants = 'A promoção de uma variação está maior que o preço dela.'
      } else if (variacoes.some((v) => !Number.isFinite(v.stock) || v.stock < 0)) {
        err.variants = 'Há variação com estoque inválido.'
      } else {
        const nomes = variacoes.map((v) => v.name.toLowerCase())
        if (new Set(nomes).size !== nomes.length) err.variants = 'Há variações com o mesmo nome.'
      }
    }

    setErrors(err)
    if (Object.keys(err).length) return

    const medida = (v) => (v === '' ? 0 : Number(String(v).replace(',', '.')))

    onSave({
      ...f,
      // Sem id em produto novo: quem gera é o banco. Preencher aqui faria o
      // contexto tratar o cadastro como edição de algo que não existe.
      id: f.id || null,
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
      weightG: f.weightG === '' ? 0 : Number(f.weightG),
      lengthCm: medida(f.lengthCm),
      widthCm: medida(f.widthCm),
      heightCm: medida(f.heightCm),
      variantAxes: eixos,
      variants: variacoes,
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

          {/* Medidas do pacote — o que a transportadora exige na etiqueta */}
          <div className="field">
            <span className="label">Peso e medidas do pacote</span>
            <p className="hint">
              Usados para calcular o frete e emitir a etiqueta. Pode deixar em branco
              agora: o produto vende normalmente, só não gera etiqueta.
            </p>
            <div className="form-grid form-grid--4">
              <div className="field">
                <label htmlFor="pf-weight">Peso (g)</label>
                <input
                  id="pf-weight"
                  className="input"
                  inputMode="numeric"
                  value={f.weightG}
                  onChange={(e) => set('weightG', e.target.value.replace(/\D/g, ''))}
                  placeholder="500"
                />
              </div>
              <div className="field">
                <label htmlFor="pf-len">Comprimento (cm)</label>
                <input
                  id="pf-len"
                  className="input"
                  inputMode="decimal"
                  value={f.lengthCm}
                  onChange={(e) => set('lengthCm', e.target.value.replace(/[^\d,.]/g, ''))}
                  placeholder="30"
                />
              </div>
              <div className="field">
                <label htmlFor="pf-wid">Largura (cm)</label>
                <input
                  id="pf-wid"
                  className="input"
                  inputMode="decimal"
                  value={f.widthCm}
                  onChange={(e) => set('widthCm', e.target.value.replace(/[^\d,.]/g, ''))}
                  placeholder="21"
                />
              </div>
              <div className="field">
                <label htmlFor="pf-hei">Altura (cm)</label>
                <input
                  id="pf-hei"
                  className="input"
                  inputMode="decimal"
                  value={f.heightCm}
                  onChange={(e) => set('heightCm', e.target.value.replace(/[^\d,.]/g, ''))}
                  placeholder="5"
                />
              </div>
            </div>
          </div>

          {/* Grade de variações */}
          <div className={`field${errors.variantAxes ? ' has-error' : ''}`}>
            <span className="label">Variações</span>
            <p className="hint">
              Defina os eixos e as opções de cada um; a grade cruza tudo e cria uma
              linha por combinação, com código, preço e estoque próprios. Sem eixo
              nenhum, o produto usa o preço e o estoque preenchidos acima.
            </p>

            {f.variantAxes.map((a) => (
              <div className="axis" key={a.uid}>
                <input
                  className="input axis__name"
                  value={a.name}
                  onChange={(e) => setEixo(a.uid, 'name', e.target.value)}
                  placeholder="Cor"
                  aria-label="Nome do eixo"
                />
                <input
                  className="input axis__opts"
                  value={a.options.join(', ')}
                  onChange={(e) =>
                    setEixo(
                      a.uid,
                      'options',
                      e.target.value.split(',').map((o) => o.trim()).filter(Boolean),
                    )
                  }
                  placeholder="Azul, Vermelho, Preto (separe por vírgula)"
                  aria-label={`Opções de ${a.name || 'eixo'}`}
                />
                <span className="axis__count">{a.options.length}</span>
                <button
                  type="button"
                  className="icon-btn"
                  onClick={() => removeEixo(a.uid)}
                  aria-label={`Remover eixo ${a.name || 'sem nome'}`}
                >
                  <Icon name="trash" size={15} />
                </button>
              </div>
            ))}

            {errors.variantAxes && <span className="err">{errors.variantAxes}</span>}

            <div className="axis__actions">
              <button type="button" className="btn btn--outline btn--sm" onClick={addEixo}>
                <Icon name="plus" size={15} /> Adicionar eixo
              </button>
              {combinacoesPrevistas > 0 && (
                <button
                  type="button"
                  className="btn btn--primary btn--sm"
                  onClick={gerar}
                  disabled={combinacoesPrevistas > MAX_COMBINACOES}
                >
                  <Icon name="grid" size={15} /> Gerar grade ({combinacoesPrevistas})
                </button>
              )}
            </div>

            {combinacoesPrevistas > MAX_COMBINACOES && (
              <span className="err">
                Esta grade daria {combinacoesPrevistas} combinações, acima do limite de{' '}
                {MAX_COMBINACOES}. Reduza as opções de algum eixo.
              </span>
            )}
          </div>

          {f.variants.length > 0 && (
            <div className={`field${errors.variants ? ' has-error' : ''}`}>
              <span className="label">
                Grade — {f.variants.length}{' '}
                {f.variants.length === 1 ? 'combinação' : 'combinações'}
              </span>
              <p className="hint">
                Preencha a primeira linha e use “repetir” para copiar o valor nas
                demais.
              </p>

              <div className="vhead">
                <span>Combinação</span>
                <span>Código</span>
                <span>Cód. barras</span>
                <span>
                  Preço{' '}
                  <button type="button" className="linkish" onClick={() => replicar('price')}>
                    repetir
                  </button>
                </span>
                <span>
                  Promo{' '}
                  <button type="button" className="linkish" onClick={() => replicar('promo')}>
                    repetir
                  </button>
                </span>
                <span>
                  Estoque{' '}
                  <button type="button" className="linkish" onClick={() => replicar('stock')}>
                    repetir
                  </button>
                </span>
                <span />
                <span />
              </div>

              <ul className="vlist">
                {f.variants.map((v) => (
                  <li key={v.uid} className="vrow">
                    <strong className="vrow__combo">{v.name || '—'}</strong>
                    <input
                      className="input vrow__sku"
                      value={v.sku}
                      onChange={(e) => setVariacao(v.uid, 'sku', e.target.value)}
                      placeholder="Código"
                      aria-label={`Código de ${v.name}`}
                    />
                    <input
                      className="input vrow__sku"
                      value={v.gtin}
                      onChange={(e) => setVariacao(v.uid, 'gtin', e.target.value.replace(/\D/g, ''))}
                      placeholder="EAN"
                      aria-label={`Código de barras de ${v.name}`}
                    />
                    <input
                      className="input vrow__num"
                      inputMode="decimal"
                      value={v.price}
                      onChange={(e) =>
                        setVariacao(v.uid, 'price', e.target.value.replace(/[^\d,.]/g, ''))
                      }
                      placeholder="Preço"
                      aria-label={`Preço de ${v.name}`}
                    />
                    <input
                      className="input vrow__num"
                      inputMode="decimal"
                      value={v.promo}
                      onChange={(e) =>
                        setVariacao(v.uid, 'promo', e.target.value.replace(/[^\d,.]/g, ''))
                      }
                      placeholder="Promo"
                      aria-label={`Promoção de ${v.name}`}
                    />
                    <input
                      className="input vrow__num"
                      inputMode="numeric"
                      value={v.stock}
                      onChange={(e) => setVariacao(v.uid, 'stock', e.target.value.replace(/\D/g, ''))}
                      placeholder="Estoque"
                      aria-label={`Estoque de ${v.name}`}
                    />
                    <label className="vrow__on" title="Disponível na loja">
                      <input
                        type="checkbox"
                        checked={v.active !== false}
                        onChange={(e) => setVariacao(v.uid, 'active', e.target.checked)}
                      />
                      <span>Ativa</span>
                    </label>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => removeVariacao(v.uid)}
                      aria-label={`Remover ${v.name || 'combinação'}`}
                    >
                      <Icon name="trash" size={15} />
                    </button>
                  </li>
                ))}
              </ul>

              {errors.variants && <span className="err">{errors.variants}</span>}
            </div>
          )}

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
