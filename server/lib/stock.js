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

  const { rowCount } = await client.query(
    `UPDATE products p
        SET stock = p.stock + i.qty
       FROM order_items i
      WHERE i.order_id = $1 AND i.product_id = p.id`,
    [orderId],
  )

  return { restored: true, items: rowCount }
}
