import { writeAudit } from './audit.service.js';
import { lockInventory } from './order.service.js';

export async function releaseExpiredReservations(db) {
  const candidates = await db.reservation.findMany({
    where: { status: 'PENDING', expiresAt: { lte: new Date() } },
    select: { id: true },
    orderBy: { expiresAt: 'asc' },
  });
  let releasedCount = 0;

  for (const candidate of candidates) {
    try {
      const released = await db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Reservation" WHERE id = ${candidate.id}::uuid FOR UPDATE`;
        const reservation = await tx.reservation.findUnique({
          where: { id: candidate.id },
          include: { items: true },
        });
        if (!reservation || reservation.status !== 'PENDING' || reservation.expiresAt > new Date()) return false;

        for (const item of [...reservation.items].sort((left, right) => left.inventoryId.localeCompare(right.inventoryId))) {
          const current = await lockInventory(tx, item.inventoryId);
          if (!current || current.reservedQuantity < item.quantity) throw new Error('Reservation state is inconsistent.');
          const updated = await tx.inventory.update({ where: { id: current.id }, data: { reservedQuantity: { decrement: item.quantity } } });
          await tx.inventoryMovement.create({
            data: {
              inventoryId: current.id,
              warehouseId: current.warehouseId,
              variantId: item.variantId,
              type: 'RELEASE',
              quantity: item.quantity,
              onHandBefore: current.onHandQuantity,
              onHandAfter: current.onHandQuantity,
              reservedBefore: current.reservedQuantity,
              reservedAfter: updated.reservedQuantity,
              referenceType: 'RESERVATION_EXPIRY',
              referenceId: reservation.orderId,
              metadata: { reservationId: reservation.id },
            },
          });
        }
        await tx.reservation.update({ where: { id: reservation.id }, data: { status: 'EXPIRED', releasedAt: new Date() } });
        const order = await tx.order.findUnique({ where: { id: reservation.orderId }, select: { status: true } });
        if (order?.status === 'PENDING_PAYMENT') {
          await tx.order.update({ where: { id: reservation.orderId }, data: { status: 'CANCELLED', statusHistory: { create: { status: 'CANCELLED', note: 'Reservation expired.' } } } });
        }
        return true;
      });
      if (released) {
        releasedCount += 1;
        await writeAudit(db, { action: 'RESERVATION_EXPIRED', resourceType: 'RESERVATION', resourceId: candidate.id, metadata: { source: 'local-expiry-worker' } });
      }
    } catch (error) {
      console.error('reservation expiry failed', { reservationId: candidate.id, error });
    }
  }
  return releasedCount;
}
