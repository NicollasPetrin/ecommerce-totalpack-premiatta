/**
 * Logo da loja.
 *
 * O arquivo é `public/logo.png`. Para trocar a arte, basta substituir esse
 * arquivo — nenhum componente precisa mudar.
 *
 * A imagem não é quadrada (95 × 108), então definimos só a altura e deixamos
 * a largura acompanhar; forçar os dois lados distorceria o desenho.
 */
export default function Logo({ size = 32, className = '', ...rest }) {
  return (
    <img
      src="/logo.png"
      alt="TotalPack"
      className={`brand-logo${className ? ` ${className}` : ''}`}
      style={{ height: size }}
      draggable="false"
      {...rest}
    />
  )
}
