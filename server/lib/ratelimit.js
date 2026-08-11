/**
 * Limite de requisições por IP.
 *
 * O teste de carga mostrou que a loja não precisa de mil pessoas para cair:
 * uma só, com um script, satura o servidor. Isto põe um teto por origem.
 *
 * É memória do próprio processo, não Redis. Serve porque a loja roda em uma
 * instância só; se um dia rodar em várias, cada uma passa a contar o seu
 * pedaço e os limites afrouxam na mesma proporção — a hora de trocar por um
 * contador compartilhado é essa.
 */

/** Uma janela por balde: { ate: timestamp, contagem: number }. */
const baldes = new Map()

/* Sem faxina o mapa cresce para sempre — o próprio limitador viraria o
   vazamento de memória que ele deveria evitar. */
const FAXINA_MS = 60_000
setInterval(() => {
  const agora = Date.now()
  for (const [chave, janela] of baldes) {
    if (janela.ate <= agora) baldes.delete(chave)
  }
}, FAXINA_MS).unref()

/**
 * Teto de segurança do próprio mapa: mesmo com faxina, uma enxurrada de IPs
 * forjados poderia enchê-lo entre uma limpeza e outra.
 */
const MAX_CHAVES = 50_000

/**
 * @param {object} opcoes
 * @param {number} opcoes.janelaMs   Tamanho da janela.
 * @param {number} opcoes.maximo     Requisições permitidas por janela.
 * @param {string} opcoes.nome       Prefixo do balde, para limites independentes.
 * @param {(req) => boolean} [opcoes.pular]  Quando não contar a requisição.
 */
export function limitar({ janelaMs, maximo, nome, pular }) {
  return function limitador(req, res, next) {
    if (pular?.(req)) return next()

    // `trust proxy` está ligado, então req.ip já é o IP real do cliente e não
    // o do roteador do Railway.
    const chave = `${nome}:${req.ip}`
    const agora = Date.now()

    let janela = baldes.get(chave)
    if (!janela || janela.ate <= agora) {
      if (baldes.size >= MAX_CHAVES && !janela) {
        // Mapa cheio: deixa passar em vez de derrubar quem é legítimo. O
        // limite é uma proteção, não pode virar a própria negação de serviço.
        return next()
      }
      janela = { ate: agora + janelaMs, contagem: 0 }
      baldes.set(chave, janela)
    }

    janela.contagem++

    const restante = Math.max(0, maximo - janela.contagem)
    res.setHeader('RateLimit-Limit', maximo)
    res.setHeader('RateLimit-Remaining', restante)
    res.setHeader('RateLimit-Reset', Math.ceil((janela.ate - agora) / 1000))

    if (janela.contagem > maximo) {
      res.setHeader('Retry-After', Math.ceil((janela.ate - agora) / 1000))
      return res.status(429).json({
        error: 'Muitas tentativas. Espere um pouco e tente de novo.',
      })
    }

    next()
  }
}

/* ---------------------------------------------------------------- Presets */

/** Teto geral da API. Alto o bastante para ninguém legítimo esbarrar. */
export const limiteGeral = limitar({ nome: 'geral', janelaMs: 60_000, maximo: 300 })

/**
 * Login e cadastro. Sem isto, testar senha por força bruta é só uma questão de
 * tempo — bcrypt encarece cada tentativa, mas não impede um milhão delas.
 */
export const limiteLogin = limitar({ nome: 'login', janelaMs: 15 * 60_000, maximo: 10 })

/** Criação de pedido: barra o robô que enche o banco e trava o estoque. */
export const limitePedido = limitar({ nome: 'pedido', janelaMs: 60_000, maximo: 12 })

/**
 * Rotas que fazem o servidor chamar a processadora. Cada chamada dessas custa
 * uma requisição externa, então o limite é mais apertado que o dos pedidos.
 */
export const limiteExterno = limitar({ nome: 'externo', janelaMs: 60_000, maximo: 20 })

/** Só para os testes: zera a contagem entre casos. */
export const _zerar = () => baldes.clear()
