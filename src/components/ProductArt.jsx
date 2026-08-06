/**
 * Ilustrações vetoriais dos produtos.
 *
 * Enquanto não houver fotos reais, cada produto exibe um desenho plano tingido
 * com a sua cor. Assim o catálogo fica coerente e nada depende de imagens
 * externas. Quando o admin envia uma foto, ela substitui o desenho.
 */

const ART = {
  /* Resma de papel */
  ream: (c) => (
    <>
      <rect x="38" y="66" width="124" height="76" rx="8" fill={c} opacity=".16" />
      <rect x="46" y="56" width="108" height="76" rx="7" fill="#fff" stroke={c} strokeWidth="3" />
      <rect x="46" y="56" width="108" height="20" rx="7" fill={c} />
      <path d="M62 92h76M62 104h76M62 116h50" stroke={c} strokeWidth="4" strokeLinecap="round" opacity=".45" />
    </>
  ),
  /* Folha avulsa */
  sheet: (c) => (
    <>
      <path d="M62 40h56l24 24v96H62z" fill="#fff" stroke={c} strokeWidth="3" strokeLinejoin="round" />
      <path d="M118 40v24h24" fill={c} opacity=".3" />
      <path d="M78 92h64M78 106h64M78 120h44" stroke={c} strokeWidth="4" strokeLinecap="round" opacity=".45" />
    </>
  ),
  /* Cartolinas coloridas empilhadas */
  colorset: (c) => (
    <>
      <rect x="34" y="62" width="104" height="80" rx="6" fill={c} opacity=".35" transform="rotate(-8 86 102)" />
      <rect x="48" y="58" width="104" height="80" rx="6" fill={c} opacity=".6" transform="rotate(-2 100 98)" />
      <rect x="56" y="54" width="104" height="80" rx="6" fill={c} />
      <path d="M72 78h72M72 94h72M72 110h44" stroke="#fff" strokeWidth="4" strokeLinecap="round" opacity=".6" />
    </>
  ),
  /* Rolo de papel crepom */
  roll: (c) => (
    <>
      <rect x="70" y="42" width="60" height="116" rx="14" fill={c} />
      <ellipse cx="100" cy="42" rx="30" ry="12" fill="#fff" opacity=".85" />
      <ellipse cx="100" cy="42" rx="12" ry="5" fill={c} opacity=".5" />
      <path d="M82 70v70M100 66v76M118 70v70" stroke="#fff" strokeWidth="3" opacity=".35" strokeLinecap="round" />
    </>
  ),
  /* Caderno espiral */
  notebook: (c) => (
    <>
      <rect x="52" y="38" width="98" height="124" rx="10" fill={c} />
      <rect x="72" y="38" width="78" height="124" rx="8" fill="#fff" opacity=".93" />
      <path d="M88 70h46M88 86h46M88 102h46M88 118h30" stroke={c} strokeWidth="4" strokeLinecap="round" opacity=".4" />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <rect key={i} x="46" y={52 + i * 19} width="24" height="7" rx="3.5" fill={c} opacity=".7" />
      ))}
    </>
  ),
  /* Fichário */
  binder: (c) => (
    <>
      <rect x="44" y="40" width="112" height="120" rx="10" fill={c} />
      <rect x="66" y="52" width="80" height="96" rx="5" fill="#fff" opacity=".93" />
      {[0, 1, 2, 3].map((i) => (
        <circle key={i} cx="58" cy={64 + i * 24} r="6" fill="none" stroke="#fff" strokeWidth="3.5" />
      ))}
      <path d="M82 78h48M82 94h48M82 110h32" stroke={c} strokeWidth="4" strokeLinecap="round" opacity=".35" />
    </>
  ),
  /* Caneta */
  pen: (c) => (
    <>
      <path d="M96 30h18a6 6 0 0 1 6 6v92l-15 42-15-42V36a6 6 0 0 1 6-6Z" fill={c} />
      <path d="M90 128h40" stroke="#fff" strokeWidth="4" opacity=".6" />
      <rect x="120" y="44" width="9" height="52" rx="4.5" fill={c} opacity=".55" />
      <path d="M105 158v18" stroke={c} strokeWidth="5" strokeLinecap="round" />
    </>
  ),
  /* Lápis */
  pencil: (c) => (
    <>
      <path d="M88 42h30v96H88z" fill={c} />
      <path d="M88 138h30l-15 32z" fill="#f5d7a8" />
      <path d="M96 160h14l-7 10z" fill="#3a3a3c" />
      <rect x="88" y="30" width="30" height="14" rx="4" fill="#ff8fa3" />
      <path d="M103 46v88" stroke="#fff" strokeWidth="3" opacity=".35" />
    </>
  ),
  /* Borracha */
  eraser: (c) => (
    <>
      <rect x="46" y="76" width="108" height="52" rx="10" fill="#fff" stroke={c} strokeWidth="3" />
      <path d="M46 104h108" stroke={c} strokeWidth="3" opacity=".4" />
      <rect x="46" y="76" width="42" height="52" rx="10" fill={c} opacity=".9" />
    </>
  ),
  /* Apontador */
  sharpener: (c) => (
    <>
      <rect x="52" y="66" width="96" height="70" rx="12" fill={c} />
      <path d="M76 66v70" stroke="#fff" strokeWidth="3" opacity=".4" />
      <path d="M96 82h44l-10 18h-34z" fill="#fff" opacity=".9" />
      <circle cx="120" cy="118" r="7" fill="#fff" opacity=".55" />
    </>
  ),
  /* Marca-texto */
  marker: (c) => (
    <>
      <rect x="60" y="34" width="34" height="88" rx="8" fill={c} />
      <path d="M60 122h34l-8 26H68z" fill={c} opacity=".65" />
      <path d="M68 148h18v14H68z" fill={c} opacity=".35" />
      <rect x="106" y="34" width="34" height="88" rx="8" fill={c} opacity=".5" />
      <path d="M106 122h34l-8 26h-18z" fill={c} opacity=".35" />
    </>
  ),
  /* Lápis de cor */
  colorpencils: () => {
    const cores = ['#ff453a', '#ff9f0a', '#ffd60a', '#30d158', '#0a84ff', '#bf5af2']
    return (
      <>
        {cores.map((cc, i) => (
          <g key={cc} transform={`translate(${40 + i * 21} ${46 + (i % 2) * 6})`}>
            <rect width="14" height="76" rx="3" fill={cc} />
            <path d="M0 76h14l-7 18z" fill="#f5d7a8" />
            <path d="M3.5 88h7l-3.5 6z" fill="#3a3a3c" />
          </g>
        ))}
      </>
    )
  },
  /* Giz de cera */
  crayon: (c) => (
    <>
      <rect x="66" y="52" width="30" height="100" rx="8" fill={c} />
      <path d="M66 52h30l-15-20z" fill={c} opacity=".6" />
      <rect x="70" y="76" width="22" height="46" rx="4" fill="#fff" opacity=".35" />
      <rect x="106" y="66" width="30" height="86" rx="8" fill={c} opacity=".55" />
      <path d="M106 66h30l-15-18z" fill={c} opacity=".35" />
    </>
  ),
  /* Tinta guache */
  paint: (c) => (
    <>
      <rect x="40" y="86" width="34" height="56" rx="8" fill="#ff453a" />
      <rect x="83" y="86" width="34" height="56" rx="8" fill="#ffd60a" />
      <rect x="126" y="86" width="34" height="56" rx="8" fill={c} />
      <path d="M40 100h120" stroke="#fff" strokeWidth="4" opacity=".5" />
      <rect x="46" y="70" width="22" height="18" rx="5" fill="#fff" opacity=".8" />
      <rect x="89" y="70" width="22" height="18" rx="5" fill="#fff" opacity=".8" />
      <rect x="132" y="70" width="22" height="18" rx="5" fill="#fff" opacity=".8" />
    </>
  ),
  /* Massinha */
  clay: (c) => (
    <>
      <ellipse cx="100" cy="128" rx="60" ry="22" fill={c} opacity=".25" />
      <rect x="48" y="72" width="104" height="46" rx="10" fill={c} />
      <path d="M48 92h104" stroke="#fff" strokeWidth="4" opacity=".5" />
      <ellipse cx="100" cy="72" rx="52" ry="13" fill={c} opacity=".7" />
      <ellipse cx="100" cy="70" rx="30" ry="7" fill="#fff" opacity=".45" />
    </>
  ),
  /* Pincel */
  brush: (c) => (
    <>
      <rect x="92" y="30" width="18" height="82" rx="6" fill="#c98a3f" />
      <rect x="88" y="106" width="26" height="22" rx="4" fill="#b0b0b5" />
      <path d="M88 128h26l-6 40h-14z" fill={c} />
      <path d="M101 30v78" stroke="#fff" strokeWidth="2.5" opacity=".3" />
    </>
  ),
  /* Cola branca */
  glue: (c) => (
    <>
      <path d="M84 62h32v82a8 8 0 0 1-8 8H92a8 8 0 0 1-8-8z" fill="#fff" stroke={c} strokeWidth="3" />
      <path d="M92 34h16v28H92z" fill={c} />
      <path d="M94 24h12l-6-12z" fill={c} opacity=".6" />
      <rect x="84" y="94" width="32" height="30" rx="3" fill={c} opacity=".22" />
      <path d="M92 104h16" stroke={c} strokeWidth="4" strokeLinecap="round" opacity=".6" />
    </>
  ),
  /* Cola bastão */
  gluestick: (c) => (
    <>
      <rect x="76" y="60" width="48" height="94" rx="10" fill={c} />
      <rect x="76" y="88" width="48" height="26" rx="4" fill="#fff" opacity=".85" />
      <rect x="80" y="34" width="40" height="28" rx="8" fill={c} opacity=".55" />
      <circle cx="100" cy="128" r="10" fill="#fff" opacity=".4" />
    </>
  ),
  /* Tesoura */
  scissors: (c) => (
    <>
      <path d="M62 44 138 132M138 44 62 132" stroke={c} strokeWidth="9" strokeLinecap="round" />
      <circle cx="66" cy="146" r="15" fill="none" stroke={c} strokeWidth="8" />
      <circle cx="134" cy="146" r="15" fill="none" stroke={c} strokeWidth="8" />
      <circle cx="100" cy="88" r="7" fill="#fff" stroke={c} strokeWidth="4" />
    </>
  ),
  /* Régua */
  ruler: (c) => (
    <>
      <rect x="26" y="80" width="148" height="40" rx="8" fill={c} opacity=".2" stroke={c} strokeWidth="3" />
      {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
        <path
          key={i}
          d={`M${44 + i * 18} 80v${i % 2 === 0 ? 20 : 12}`}
          stroke={c}
          strokeWidth="3.5"
          strokeLinecap="round"
        />
      ))}
    </>
  ),
  /* Pasta */
  folder: (c) => (
    <>
      <path d="M34 62h48l12 14h72a8 8 0 0 1 8 8v62a8 8 0 0 1-8 8H34a8 8 0 0 1-8-8V70a8 8 0 0 1 8-8Z" fill={c} />
      <path d="M26 92h148v54a8 8 0 0 1-8 8H34a8 8 0 0 1-8-8z" fill="#fff" opacity=".2" />
      <path d="M100 62v-8" stroke={c} strokeWidth="5" strokeLinecap="round" opacity=".5" />
    </>
  ),
  /* Grampeador */
  stapler: (c) => (
    <>
      <path d="M38 118h124a10 10 0 0 1 0 20H38a10 10 0 0 1 0-20Z" fill={c} opacity=".35" />
      <path d="M46 84h108a12 12 0 0 1 12 12v14H46a12 12 0 0 1-12-12v-2a12 12 0 0 1 12-12Z" fill={c} />
      <path d="M60 96h72" stroke="#fff" strokeWidth="5" strokeLinecap="round" opacity=".55" />
    </>
  ),
  /* Mochila */
  backpack: (c) => (
    <>
      <path d="M60 66a40 40 0 0 1 80 0v88a10 10 0 0 1-10 10H70a10 10 0 0 1-10-10z" fill={c} />
      <path d="M74 40a26 26 0 0 1 52 0" fill="none" stroke={c} strokeWidth="8" strokeLinecap="round" />
      <rect x="76" y="104" width="48" height="42" rx="8" fill="#fff" opacity=".9" />
      <path d="M60 92h80" stroke="#fff" strokeWidth="5" opacity=".45" />
      <path d="M88 122h24" stroke={c} strokeWidth="5" strokeLinecap="round" opacity=".5" />
    </>
  ),
  /* Estojo */
  case: (c) => (
    <>
      <rect x="32" y="72" width="136" height="66" rx="20" fill={c} />
      <path d="M32 100h136" stroke="#fff" strokeWidth="5" opacity=".55" />
      <circle cx="150" cy="100" r="9" fill="#fff" opacity=".9" />
      <path d="M150 100v18" stroke="#fff" strokeWidth="4" strokeLinecap="round" opacity=".8" />
    </>
  ),
}

export const ART_KINDS = Object.keys(ART)

export const ART_LABELS = {
  ream: 'Resma',
  sheet: 'Folha',
  colorset: 'Colorset',
  roll: 'Rolo',
  notebook: 'Caderno',
  binder: 'Fichário',
  pen: 'Caneta',
  pencil: 'Lápis',
  eraser: 'Borracha',
  sharpener: 'Apontador',
  marker: 'Marcador',
  colorpencils: 'Lápis de cor',
  crayon: 'Giz de cera',
  paint: 'Tinta',
  clay: 'Massinha',
  brush: 'Pincel',
  glue: 'Cola',
  gluestick: 'Cola bastão',
  scissors: 'Tesoura',
  ruler: 'Régua',
  folder: 'Pasta',
  stapler: 'Grampeador',
  backpack: 'Mochila',
  case: 'Estojo',
}

export default function ProductArt({ product, className = '', ...rest }) {
  const { image, art = 'sheet', tint = '#0e8fa2', name } = product ?? {}

  if (image) {
    return <img src={image} alt={name ?? ''} className={className} loading="lazy" {...rest} />
  }

  const draw = ART[art] ?? ART.sheet

  return (
    <svg viewBox="0 0 200 200" className={className} role="img" aria-label={name ?? ''} {...rest}>
      <defs>
        <linearGradient id={`bg-${art}-${tint.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={tint} stopOpacity=".14" />
          <stop offset="100%" stopColor={tint} stopOpacity=".03" />
        </linearGradient>
      </defs>
      <rect width="200" height="200" fill={`url(#bg-${art}-${tint.replace('#', '')})`} />
      {draw(tint)}
    </svg>
  )
}
