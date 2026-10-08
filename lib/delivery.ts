import "server-only";
import { sql } from "./db";
import { GraphError } from "./graph";

export class UncertainDeliveryError extends Error {}

// Não existe idempotency key documentada para o Send API. Reservamos cada
// efeito antes de enviá-lo e nunca repetimos um envio com resultado incerto.
export async function deliverOnce(key: string, send: () => Promise<unknown>): Promise<void> {
  const reserved = await sql().query(
    `insert into outbound_deliveries (delivery_key, status) values ($1, 'started')
     on conflict (delivery_key) do update set status = 'started', updated_at = now()
     where outbound_deliveries.status = 'rejected' returning delivery_key`, [key]
  ) as unknown[];
  if (!reserved.length) {
    const rows = await sql().query(`select status from outbound_deliveries where delivery_key = $1`, [key]) as { status: string }[];
    if (rows[0]?.status === "sent") return;
    throw new UncertainDeliveryError("Envio anterior sem confirmação. Não será repetido automaticamente; confira a conversa na Meta.");
  }
  try {
    await send();
  } catch (err) {
    if (err instanceof GraphError && err.rejected) {
      await sql().query(`update outbound_deliveries set status = 'rejected', updated_at = now() where delivery_key = $1`, [key]);
      throw err;
    }
    throw new UncertainDeliveryError("A Meta pode ter recebido o envio, mas não houve confirmação. Confira a conversa antes de qualquer nova tentativa.");
  }
  // Uma falha nesta gravação deixa 'started': a próxima execução não reenvia.
  await sql().query(`update outbound_deliveries set status = 'sent', updated_at = now() where delivery_key = $1`, [key]);
}
