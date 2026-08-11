/**
 * Devolução de estoque.
 *
 * Quando um pedido é cancelado ou estornado, os itens voltam para a prateleira
 * — senão a loja para de vender o que na verdade tem.
 *
 * A trava está no banco, não no código que chama: a coluna `stock_restored` só
 * deixa a devolução acontecer uma vez. Um pedido cancelado e depois estornado
 * pela processadora passaria por aqui duas vezes, e sem a trava a loja
 * passaria a vender o que não existe.
 */
export async function restoreStock(client, orderId) {
  // Marca primeiro. Se outra transação já tiver marcado, esta não altera
  // nenhuma linha e a devolução não acontece de novo.
  const { rows } = await client.query(
    `UPDATE orders SET stock_restored = true
      WHERE id = $1 AND stock_restored = false
      RETURNING id`,
    [orderId],
  )

  if (!rows.length) return { restored: false, reason: 'estoque já devolvido' }

  // Item com variação baixou o estoque da variação, não o do produto: a
  // devolução precisa seguir o mesmo caminho, senão o saldo desencontra.
  const { rowCount: devolvidosAoProduto } = await client.query(
    `UPDATE products p
        SET stock = p.stock + i.qty
       FROM order_items i
      WHERE i.order_id = $1 AND i.product_id = p.id AND i.variant_id IS NULL`,
    [orderId],
  )

  const { rowCount: devolvidosAVariacao } = await client.query(
    `UPDATE product_variants v
        SET stock = v.stock + i.qty
       FROM order_items i
      WHERE i.order_id = $1 AND i.variant_id = v.id`,
    [orderId],
  )

  return { restored: true, items: devolvidosAoProduto + devolvidosAVariacao }
}
