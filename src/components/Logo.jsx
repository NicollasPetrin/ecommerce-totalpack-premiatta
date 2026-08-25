/**
 * Logo da loja.
 *
 * Dois arquivos, cada um no lugar onde é bom:
 *
 * - `logo.webp` (256 px, 32 KB) é o que a tela carrega. Vem de um PNG de
 *   1,3 MB, que a marca de 30 px do cabeçalho não tem como aproveitar.
 * - `logo.png` (192 px, 71 KB) é só para favicon e ícone de atalho, onde o
 *   navegador ainda quer PNG.
 *
 * Trocar a arte é substituir os dois arquivos; nenhum componente muda.
 *
 * A arte é quadrada e transparente, então largura e altura podem ser as duas
 * definidas sem distorcer — e reservar o quadrado evita a página pular quando
 * a imagem termina de carregar.
 */
export default function Logo({ size = 32, className = '', ...rest }) {
  return (
    <img
      src="/logo.webp"
      alt="TotalPack"
      className={`brand-logo${className ? ` ${className}` : ''}`}
      width={size}
      height={size}
      style={{ height: size, width: size }}
      draggable="false"
      {...rest}
    />
  )
}
