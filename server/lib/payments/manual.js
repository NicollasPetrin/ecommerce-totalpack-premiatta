/**
 * Processadora "manual" — o que a loja usa até haver uma de verdade.
 *
 * Não conversa com ninguém: registra a cobrança como pendente e devolve sem
 * URL de pagamento. É exatamente o comportamento atual da loja — o cliente
 * escolhe PIX, cartão ou boleto e o acerto acontece fora do site.
 *
 * Serve como referência de implementação e mantém o resto do sistema
 * funcionando enquanto a integração real não chega: as tabelas de pagamento
 * são alimentadas do mesmo jeito, então quando a processadora entrar, o
 * histórico continua fazendo sentido.
 */
export const manual = {
  id: 'manual',

  async createCharge({ amount, method }) {
    return {
      providerRef: null,
      checkoutUrl: null,
      status: 'pendente',
      expiresAt: null,
      raw: {
        nota: 'Sem processadora configurada — cobrança acertada fora do site.',
        method,
        amount,
      },
    }
  },

  /**
   * Não existe webhook sem processadora. Recusar é o comportamento seguro:
   * se alguém descobrir a URL e mandar um evento, ele não vira pagamento.
   */
  verifySignature() {
    return false
  },

  parseEvent() {
    return null
  },
}
