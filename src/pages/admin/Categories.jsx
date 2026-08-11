import { useState } from 'react'
import { useStore } from '../../store/StoreContext'
import { slugify } from '../../lib/format'
import Modal, { ConfirmDialog } from '../../components/Modal'
import Icon from '../../components/Icon'

const blank = () => ({ id: '', name: '', slug: '', description: '', order: 99 })

export default function AdminCategories() {
  const { categories, products, saveCategory, deleteCategory, toast } = useStore()
  const [editing, setEditing] = useState(null)
  const [removing, setRemoving] = useState(null)

  const ordered = [...categories].sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
  const countOf = (id) => products.filter((p) => p.categoryId === id).length

  const move = async (cat, dir) => {
    const idx = ordered.findIndex((c) => c.id === cat.id)
    const swap = ordered[idx + dir]
    if (!swap) return
    try {
      // Em sequência, não em paralelo: são duas escritas na mesma tabela.
      await saveCategory({ ...cat, order: swap.order ?? idx + 1 + dir })
      await saveCategory({ ...swap, order: cat.order ?? idx + 1 })
    } catch (err) {
      toast(err.message, 'err')
    }
  }

  return (
    <>
      <header className="apage__head">
        <div>
          <h1>Categorias</h1>
          <p>Organize como os produtos aparecem no menu e na página inicial.</p>
        </div>
        <button className="btn btn--primary" onClick={() => setEditing(blank())}>
          <Icon name="plus" size={16} /> Nova categoria
        </button>
      </header>

      <section className="acard acard--flush">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 76 }}>Ordem</th>
                <th>Categoria</th>
                <th className="hide-sm">Endereço</th>
                <th className="ta-right">Produtos</th>
                <th className="ta-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {ordered.map((c, i) => (
                <tr key={c.id}>
                  <td>
                    <div className="orderbtns">
                      <button
                        className="icon-btn"
                        onClick={() => move(c, -1)}
                        disabled={i === 0}
                        aria-label="Mover para cima"
                      >
                        <Icon name="chevronDown" size={15} style={{ transform: 'rotate(180deg)' }} />
                      </button>
                      <button
                        className="icon-btn"
                        onClick={() => move(c, 1)}
                        disabled={i === ordered.length - 1}
                        aria-label="Mover para baixo"
                      >
                        <Icon name="chevronDown" size={15} />
                      </button>
                    </div>
                  </td>
                  <td>
                    <strong>{c.name}</strong>
                    <div className="cellsub">{c.description || '—'}</div>
                  </td>
                  <td className="mono nowrap hide-sm">/catalogo?cat={c.slug}</td>
                  <td className="ta-right">
                    <span className="tag tag--gray">{countOf(c.id)}</span>
                  </td>
                  <td className="ta-right nowrap">
                    <button
                      className="icon-btn"
                      onClick={() => setEditing(c)}
                      aria-label={`Editar ${c.name}`}
                    >
                      <Icon name="edit" size={17} />
                    </button>
                    <button
                      className="icon-btn icon-btn--danger"
                      onClick={() => setRemoving(c)}
                      aria-label={`Excluir ${c.name}`}
                    >
                      <Icon name="trash" size={17} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {ordered.length === 0 && (
          <div className="empty">
            <Icon name="tags" size={40} strokeWidth={1.2} />
            <h3>Nenhuma categoria</h3>
            <p>Crie a primeira para organizar o catálogo.</p>
          </div>
        )}
      </section>

      {editing && (
        <CategoryForm
          value={editing}
          onClose={() => setEditing(null)}
          onSave={async (data) => {
            try {
              await saveCategory(data)
              setEditing(null)
              toast(data.id ? 'Categoria atualizada.' : 'Categoria criada.')
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
            await deleteCategory(removing.id)
            toast('Categoria excluída.')
          } catch (err) {
            toast(err.message, 'err')
          }
        }}
        title="Excluir categoria"
        message={
          countOf(removing?.id) > 0
            ? `“${removing?.name}” tem ${countOf(removing?.id)} produto(s). Eles continuarão existindo, mas ficarão sem categoria até serem reclassificados.`
            : `“${removing?.name}” será removida. Esta ação não pode ser desfeita.`
        }
      />
    </>
  )
}

function CategoryForm({ value, onClose, onSave }) {
  const [f, setF] = useState({ ...value })
  const [errors, setErrors] = useState({})

  const submit = (e) => {
    e.preventDefault()
    const err = {}
    if (f.name.trim().length < 2) err.name = 'Informe o nome.'
    setErrors(err)
    if (Object.keys(err).length) return

    onSave({
      ...f,
      // Sem id em categoria nova: quem gera é o banco.
      id: f.id || null,
      name: f.name.trim(),
      slug: slugify(f.slug || f.name),
      description: f.description.trim(),
      order: Number(f.order) || 99,
    })
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={f.id ? 'Editar categoria' : 'Nova categoria'}
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
          <label htmlFor="cf-name">Nome *</label>
          <input
            id="cf-name"
            className="input"
            value={f.name}
            onChange={(e) => setF({ ...f, name: e.target.value })}
            placeholder="Colorset & Cartolinas"
          />
          {errors.name && <span className="err">{errors.name}</span>}
        </div>

        <div className="field">
          <label htmlFor="cf-slug">Endereço na URL</label>
          <input
            id="cf-slug"
            className="input"
            value={f.slug}
            onChange={(e) => setF({ ...f, slug: e.target.value })}
            placeholder={slugify(f.name) || 'colorset'}
          />
          <span className="hint">
            Fica assim: /catalogo?cat=<strong>{slugify(f.slug || f.name) || '…'}</strong>
          </span>
        </div>

        <div className="field">
          <label htmlFor="cf-desc">Descrição</label>
          <textarea
            id="cf-desc"
            className="textarea"
            value={f.description}
            onChange={(e) => setF({ ...f, description: e.target.value })}
            placeholder="Aparece no topo da categoria e nos cards da home."
          />
        </div>

        <div className="field" style={{ maxWidth: 160 }}>
          <label htmlFor="cf-order">Posição no menu</label>
          <input
            id="cf-order"
            className="input"
            inputMode="numeric"
            value={f.order}
            onChange={(e) => setF({ ...f, order: e.target.value.replace(/\D/g, '') })}
          />
        </div>
      </form>
    </Modal>
  )
}
