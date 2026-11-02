import '../src/config/env.js';
import { createHash } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function stableId(value) {
  const bytes = createHash('sha256').update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function midnightUtc(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

async function createManyInBatches(rows, size = 1000) {
  let inserted = 0;
  for (let offset = 0; offset < rows.length; offset += size) {
    const result = await prisma.inventoryMovement.createMany({ data: rows.slice(offset, offset + size), skipDuplicates: true });
    inserted += result.count;
  }
  return inserted;
}

async function main() {
  const today = midnightUtc(new Date());
  const rangeStart = new Date(today);
  rangeStart.setUTCDate(rangeStart.getUTCDate() - 27);
  const endExclusive = new Date(today);
  endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
  const warehouses = await prisma.warehouse.findMany({ where: { isActive: true }, orderBy: { code: 'asc' }, select: { id: true, code: true } });
  const variants = await prisma.productVariant.findMany({
    where: { isActive: true, sku: { startsWith: 'SS-CUR-' }, product: { isActive: true } },
    orderBy: { sku: 'asc' },
    take: 50,
    select: { id: true, sku: true },
  });
  if (!warehouses.length || !variants.length) throw new Error('Seed warehouses and active catalog SKUs before adding demo sales history.');

  const existingMovements = await prisma.inventoryMovement.findMany({
    where: { warehouseId: { in: warehouses.map(({ id }) => id) }, variantId: { in: variants.map(({ id }) => id) }, type: { in: ['SALE', 'RETURN'] }, createdAt: { gte: rangeStart, lt: endExclusive } },
    select: { warehouseId: true, variantId: true },
  });
  const pairsWithSales = new Set(existingMovements.map(({ warehouseId, variantId }) => `${warehouseId}:${variantId}`));
  const rows = [];
  let skippedPairs = 0;

  for (const [warehouseIndex, warehouse] of warehouses.entries()) {
    const inventories = await prisma.inventory.findMany({
      where: { warehouseId: warehouse.id, variantId: { in: variants.map(({ id }) => id) } },
      select: { id: true, variantId: true, onHandQuantity: true, reservedQuantity: true },
    });
    const inventoryByVariant = new Map(inventories.map((inventory) => [inventory.variantId, inventory]));

    for (const [variantIndex, variant] of variants.entries()) {
      const pairKey = `${warehouse.id}:${variant.id}`;
      if (pairsWithSales.has(pairKey)) {
        skippedPairs += 1;
        continue;
      }
      const inventory = inventoryByVariant.get(variant.id);
      if (!inventory) continue;

      const sales = [];
      for (let dayOffset = -27; dayOffset <= 0; dayOffset += 1) {
        if ((dayOffset + variantIndex) % 2 !== 0) continue;
        const date = new Date(today);
        date.setUTCDate(date.getUTCDate() + dayOffset);
        const quantity = 1 + ((variantIndex + warehouseIndex + Math.abs(dayOffset)) % 5 === 0 ? 1 : 0);
        sales.push({ date, quantity });
      }
      let onHand = inventory.onHandQuantity + sales.reduce((total, sale) => total + sale.quantity, 0);
      for (const sale of sales) {
        const onHandBefore = onHand;
        onHand -= sale.quantity;
        const businessDate = sale.date.toISOString().slice(0, 10);
        rows.push({
          id: stableId(`demo-demand-history:${warehouse.id}:${variant.id}:${businessDate}`),
          inventoryId: inventory.id,
          warehouseId: warehouse.id,
          variantId: variant.id,
          type: 'SALE',
          quantity: sale.quantity,
          onHandBefore,
          onHandAfter: onHand,
          reservedBefore: inventory.reservedQuantity,
          reservedAfter: inventory.reservedQuantity,
          referenceType: 'DEMO_DEMAND_HISTORY',
          metadata: { demo: true, source: 'SupplySense sample sales history', businessDate, warehouseCode: warehouse.code },
          createdAt: new Date(`${businessDate}T12:00:00.000Z`),
        });
      }
    }
  }

  const inserted = await createManyInBatches(rows);
  console.log(JSON.stringify({ activeWarehouses: warehouses.length, skuCount: variants.length, insertedDemoSales: inserted, warehousesWithSeededSales: warehouses.length, skippedExistingSalesPairs: skippedPairs, historyDaysPerSeededSku: 14 }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
