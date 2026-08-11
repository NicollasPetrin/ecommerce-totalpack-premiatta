/**
 * Garante que um destino de navegação é interno.
 *
 * O React Router 6 tem um aviso de redirecionamento aberto: `//evil.com` e
 * `/\evil.com` são tratados como caminho, mas o navegador os resolve como
 * outro site. Hoje os nossos destinos vêm do estado do roteador, não da URL,
 * então não há como um atacante injetá-los — este guarda existe para que isso
 * continue verdade se amanhã alguém ler o destino de um parâmetro.
 */
export function caminhoInterno(destino, padrao = '/') {
  if (typeof destino !== 'string' || !destino) return padrao

  // Precisa começar com uma barra só, seguida de algo que não seja outra
  // barra nem contrabarra — é assim que `//host` e `/\host` escapam.
  if (!/^\/($|[^/\\])/.test(destino)) return padrao

  // Caracteres de controle: alguns navegadores os ignoram ao resolver a URL,
  // o que quebraria a checagem acima.
  if (/[\u0000-\u001f\u007f]/.test(destino)) return padrao

  return destino
}
