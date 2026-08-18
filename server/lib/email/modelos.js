/**
 * Corpo dos e-mails.
 *
 * HTML propositalmente simples: tabela, estilo embutido, sem imagem externa.
 * Cliente de e-mail não é navegador — Gmail, Outlook e Apple Mail cortam CSS
 * moderno, e imagem remota fica bloqueada por padrão na maioria deles.
 */

const dinheiro = (v) =>
  Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

/** Impede que nome ou observação do cliente quebrem o HTML da mensagem. */
const escapar = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const COR = '#d32a1f'

const moldura = ({ titulo, corpo, rodape }) => `
<div style="background:#f7f3ee;padding:24px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e8e0d6">
    <tr>
      <td style="background:${COR};padding:18px 26px">
        <span style="color:#fff;font-size:17px;font-weight:700;letter-spacing:-.02em">TotalPack</span>
      </td>
    </tr>
    <tr>
      <td style="padding:26px">
        <h1 style="margin:0 0 14px;font-size:19px;line-height:1.3;color:#1c1917">${titulo}</h1>
        ${corpo}
      </td>
    </tr>
    <tr>
      <td style="padding:16px 26px;background:#faf7f3;border-top:1px solid #e8e0d6;font-size:12px;color:#78716c;line-height:1.6">
        ${rodape}
      </td>
    </tr>
  </table>
</div>`

/** Lista de itens, usada em mais de um modelo. */
const tabelaItens = (pedido) => `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;font-size:14px;color:#44403c">
  ${(pedido.items ?? [])
    .map(
      (i) => `<tr>
    <td style="padding:7px 0;border-bottom:1px solid #f0ebe4">
      ${escapar(i.name)}${i.variantName ? ` <span style="color:#78716c">(${escapar(i.variantName)})</span>` : ''}
      <span style="color:#78716c"> × ${i.qty}</span>
    </td>
    <td align="right" style="padding:7px 0;border-bottom:1px solid #f0ebe4;white-space:nowrap">${dinheiro(i.price * i.qty)}</td>
  </tr>`,
    )
    .join('')}
  <tr>
    <td style="padding:7px 0;color:#78716c">Frete — ${escapar(pedido.deliveryZone)}</td>
    <td align="right" style="padding:7px 0;white-space:nowrap">${dinheiro(pedido.shipping)}</td>
  </tr>
  <tr>
    <td style="padding:10px 0 0;font-weight:700;font-size:16px">Total</td>
    <td align="right" style="padding:10px 0 0;font-weight:700;font-size:16px;white-space:nowrap">${dinheiro(pedido.total)}</td>
  </tr>
</table>`

const codigo = (pedido) => `#${String(pedido.seq).padStart(4, '0')}`

const endereco = (p) => `
  ${escapar(p.customer.address)}, ${escapar(p.customer.number)}${
    p.customer.complement ? ` — ${escapar(p.customer.complement)}` : ''
  }<br>
  ${escapar(p.customer.district)} · ${escapar(p.customer.city)}/${escapar(p.customer.state)}<br>
  CEP ${escapar(p.customer.cep)}`

export const modelos = {
  /** Ao fechar o pedido, antes de pagar. */
  pedidoRecebido: (pedido, cfg) => ({
    assunto: `Pedido ${codigo(pedido)} recebido — TotalPack`,
    html: moldura({
      titulo: `Recebemos seu pedido, ${escapar(pedido.customer.name.split(' ')[0])}!`,
      corpo: `
        <p style="margin:0 0 4px;font-size:14px;color:#44403c;line-height:1.6">
          Seu pedido <strong>${codigo(pedido)}</strong> está registrado. Assim que o
          pagamento for confirmado, começamos a preparar o envio.
        </p>
        ${tabelaItens(pedido)}
        <p style="margin:18px 0 4px;font-size:13px;color:#78716c">Entrega em</p>
        <p style="margin:0;font-size:14px;color:#44403c;line-height:1.6">${endereco(pedido)}</p>`,
      rodape: `Dúvidas? Responda este e-mail ou escreva para ${escapar(cfg.email)}.`,
    }),
  }),

  /** Para o dono: é o aviso que faltava para a venda não ficar invisível. */
  novoPedido: (pedido, cfg) => ({
    assunto: `Nova venda ${codigo(pedido)} — ${dinheiro(pedido.total)}`,
    html: moldura({
      titulo: `Nova venda: ${dinheiro(pedido.total)}`,
      corpo: `
        <p style="margin:0;font-size:14px;color:#44403c;line-height:1.6">
          <strong>${escapar(pedido.customer.name)}</strong><br>
          ${escapar(pedido.customer.phone)}${pedido.customer.email ? ` · ${escapar(pedido.customer.email)}` : ''}<br>
          Pagamento: ${escapar(pedido.payment)}
        </p>
        ${tabelaItens(pedido)}
        <p style="margin:18px 0 4px;font-size:13px;color:#78716c">Entregar em</p>
        <p style="margin:0;font-size:14px;color:#44403c;line-height:1.6">${endereco(pedido)}</p>
        ${
          pedido.note
            ? `<p style="margin:16px 0 0;padding:11px 13px;background:#faf7f3;border-radius:8px;font-size:13px;color:#44403c">Observação: ${escapar(pedido.note)}</p>`
            : ''
        }`,
      rodape: `Abra o painel para acompanhar: ${escapar(cfg.publicUrl)}/admin/pedidos`,
    }),
  }),

  pagamentoConfirmado: (pedido, cfg) => ({
    assunto: `Pagamento confirmado — pedido ${codigo(pedido)}`,
    html: moldura({
      titulo: 'Pagamento confirmado',
      corpo: `
        <p style="margin:0;font-size:14px;color:#44403c;line-height:1.6">
          Recebemos o pagamento do pedido <strong>${codigo(pedido)}</strong>, no valor de
          <strong>${dinheiro(pedido.total)}</strong>. Já estamos preparando seu envio —
          você recebe o código de rastreio assim que ele for postado.
        </p>`,
      rodape: `Qualquer dúvida, escreva para ${escapar(cfg.email)}.`,
    }),
  }),

  /** O mais esperado: leva o código de rastreio. */
  pedidoEnviado: (pedido, cfg, envio) => ({
    assunto: `Pedido ${codigo(pedido)} a caminho`,
    html: moldura({
      titulo: 'Seu pedido saiu para entrega',
      corpo: `
        <p style="margin:0 0 16px;font-size:14px;color:#44403c;line-height:1.6">
          O pedido <strong>${codigo(pedido)}</strong> foi despachado por
          <strong>${escapar(envio.carrier || pedido.deliveryZone)}</strong>.
        </p>
        ${
          envio.tracking
            ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px">
                 <tr><td style="padding:15px 17px;background:#faf7f3;border:1px solid #e8e0d6;border-radius:10px">
                   <div style="font-size:12px;color:#78716c;margin-bottom:5px">Código de rastreio</div>
                   <div style="font-size:19px;font-weight:700;letter-spacing:.04em;color:#1c1917;font-family:ui-monospace,Menlo,Consolas,monospace">${escapar(envio.tracking)}</div>
                 </td></tr>
               </table>
               <p style="margin:0 0 16px;font-size:13px;color:#78716c;line-height:1.6">
                 Acompanhe em
                 <a href="https://www.melhorrastreio.com.br/rastreio/${encodeURIComponent(envio.tracking)}" style="color:${COR}">melhorrastreio.com.br</a>.
                 O código pode levar algumas horas para aparecer no sistema da transportadora.
               </p>`
            : `<p style="margin:0 0 16px;font-size:13px;color:#78716c;line-height:1.6">
                 O código de rastreio ainda está sendo gerado pela transportadora.
                 Avisamos assim que sair.
               </p>`
        }
        <p style="margin:0 0 4px;font-size:13px;color:#78716c">Endereço de entrega</p>
        <p style="margin:0;font-size:14px;color:#44403c;line-height:1.6">${endereco(pedido)}</p>`,
      rodape: 'Se algo estiver errado no endereço, responda este e-mail o quanto antes.',
    }),
  }),
}
