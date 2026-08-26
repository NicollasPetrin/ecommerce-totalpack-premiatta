/**
 * Consulta de endereço por CEP.
 *
 * Fica no servidor, e não no navegador, por dois motivos. O primeiro é a
 * política de segurança da página: `connect-src 'self'` não deixa o navegador
 * falar com outro domínio, e afrouxá-la para um serviço de CEP abriria a
 * porta para qualquer script injetado mandar dados para fora. O segundo é que
 * daqui dá para guardar o resultado — o mesmo CEP consultado por dez pessoas
 * custa uma consulta, não dez.
 *
 * Dois fornecedores, tentados em ordem. São gratuitos e sem chave, o que
 * significa que ninguém garante que estarão de pé: quando o primeiro falha, o
 * segundo responde, e o cliente não fica digitando endereço à mão porque um
 * serviço caiu.
 */

const TEMPO_LIMITE_MS = 3500

/* CEP não muda de endereço. O teto existe para a memória não crescer sem fim
   num processo de vida longa; ao encher, os mais antigos saem. */
const MAX_CACHE = 5000
const cache = new Map()

const guardar = (cep, valor) => {
  if (cache.size >= MAX_CACHE) {
    // Map preserva a ordem de inserção: o primeiro é o mais antigo.
    cache.delete(cache.keys().next().value)
  }
  cache.set(cep, valor)
}

/** Busca com prazo: um fornecedor lento não pode segurar o checkout. */
async function buscar(url, extrair) {
  const corte = AbortSignal.timeout(TEMPO_LIMITE_MS)
  const r = await fetch(url, { signal: corte, headers: { accept: 'application/json' } })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return extrair(await r.json())
}

const FORNECEDORES = [
  {
    nome: 'viacep',
    consultar: (cep) =>
      buscar(`https://viacep.com.br/ws/${cep}/json/`, (j) => {
        // A ViaCEP responde 200 com `{ erro: true }` para CEP inexistente.
        if (j?.erro) return null
        if (!j?.localidade) return null
        return {
          rua: j.logradouro ?? '',
          bairro: j.bairro ?? '',
          cidade: j.localidade,
          uf: (j.uf ?? '').toUpperCase(),
        }
      }),
  },
  {
    nome: 'brasilapi',
    consultar: (cep) =>
      buscar(`https://brasilapi.com.br/api/cep/v1/${cep}`, (j) => {
        if (!j?.city) return null
        return {
          rua: j.street ?? '',
          bairro: j.neighborhood ?? '',
          cidade: j.city,
          uf: (j.state ?? '').toUpperCase(),
        }
      }),
  },
]

/**
 * Endereço de um CEP, ou `null` quando não existe.
 *
 * Nunca lança: o preenchimento automático é uma conveniência, e falha nele
 * não pode impedir ninguém de comprar. Quando todos os fornecedores falham, a
 * resposta é a mesma de CEP inexistente — o cliente digita à mão, como fazia
 * antes de isto existir.
 *
 * Ausência também é guardada, para um CEP inválido digitado em sequência não
 * virar uma consulta a cada tecla.
 */
export async function enderecoDoCep(cepBruto) {
  const cep = String(cepBruto ?? '').replace(/\D/g, '')
  if (cep.length !== 8) return null

  if (cache.has(cep)) return cache.get(cep)

  for (const f of FORNECEDORES) {
    try {
      const achado = await f.consultar(cep)
      // `null` aqui é resposta boa: o fornecedor respondeu que não existe.
      guardar(cep, achado)
      return achado
    } catch (err) {
      console.warn(`[cep] ${f.nome} falhou para ${cep}: ${err.message}`)
    }
  }

  /* Todos fora do ar: não guardamos nada. Guardar a falha faria o CEP ficar
     "inexistente" na memória até o processo reiniciar, muito depois de o
     serviço ter voltado. */
  return null
}
