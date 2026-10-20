import {
  Prisma,
  StockItemType,
  StockMovement,
  StockMovementType,
} from '@prisma/client';
import { HttpError } from './errors';

export interface RecordMovementInput {
  itemType: StockItemType;
  movementType: StockMovementType;
  rawMaterialId?: number;
  batteryTypeId?: number;
  quantityChange: Prisma.Decimal;
  reason?: string;
  referenceType?: string;
  referenceId?: number;
  allowNegativeBalance?: boolean;
}

interface MovementCtx {
  companyId: number;
  userId: number;
}

export async function recordStockMovement(
  tx: Prisma.TransactionClient,
  ctx: MovementCtx,
  input: RecordMovementInput,
): Promise<StockMovement> {
  if (input.itemType === 'RAW_MATERIAL') {
    return recordMaterialMovement(tx, ctx, input);
  }
  return recordBatteryMovement(tx, ctx, input);
}

async function recordMaterialMovement(
  tx: Prisma.TransactionClient,
  ctx: MovementCtx,
  input: RecordMovementInput,
): Promise<StockMovement> {
  if (!input.rawMaterialId) throw new HttpError(400, 'rawMaterialId is required');
  if (input.batteryTypeId) throw new HttpError(400, 'batteryTypeId must be omitted for materials');

  // NOTE: Prisma columns are camelCase (quoted). "currentStock" AS current_stock keeps
  // the TS row type clean while matching the actual DB schema.
  const rows = await tx.$queryRaw<{ id: number; current_stock: string }[]>`
    SELECT id, "currentStock" AS current_stock
    FROM raw_materials
    WHERE id = ${input.rawMaterialId} AND "companyId" = ${ctx.companyId}
    FOR UPDATE
  `;
  if (rows.length === 0) throw new HttpError(404, 'Raw material not found');

  const current = new Prisma.Decimal(rows[0].current_stock);
  const newBalance = current.add(input.quantityChange);

  if (newBalance.lessThan(0) && !input.allowNegativeBalance) {
    throw new HttpError(
      400,
      `Insufficient stock: have ${current.toString()}, requested change ${input.quantityChange.toString()}`,
      'INSUFFICIENT_STOCK',
    );
  }

  const movement = await tx.stockMovement.create({
    data: {
      companyId: ctx.companyId,
      itemType: 'RAW_MATERIAL',
      movementType: input.movementType,
      rawMaterialId: input.rawMaterialId,
      quantityChange: input.quantityChange,
      resultingBalance: newBalance,
      reason: input.reason,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      userId: ctx.userId,
    },
  });

  await tx.rawMaterial.update({
    where: { id: input.rawMaterialId },
    data: { currentStock: newBalance },
  });

  return movement;
}

async function recordBatteryMovement(
  tx: Prisma.TransactionClient,
  ctx: MovementCtx,
  input: RecordMovementInput,
): Promise<StockMovement> {
  if (!input.batteryTypeId) throw new HttpError(400, 'batteryTypeId is required');
  if (input.rawMaterialId) throw new HttpError(400, 'rawMaterialId must be omitted for battery types');
  if (!input.quantityChange.isInteger()) {
    throw new HttpError(400, 'Battery quantity change must be a whole number');
  }

  const rows = await tx.$queryRaw<{ id: number; current_stock: number }[]>`
    SELECT id, "currentStock" AS current_stock
    FROM battery_types
    WHERE id = ${input.batteryTypeId} AND "companyId" = ${ctx.companyId}
    FOR UPDATE
  `;
  if (rows.length === 0) throw new HttpError(404, 'Battery type not found');

  const current = new Prisma.Decimal(rows[0].current_stock);
  const newBalance = current.add(input.quantityChange);

  if (newBalance.lessThan(0) && !input.allowNegativeBalance) {
    throw new HttpError(
      400,
      `Insufficient stock: have ${current.toString()}, requested change ${input.quantityChange.toString()}`,
      'INSUFFICIENT_STOCK',
    );
  }

  if (!newBalance.isInteger()) {
    throw new HttpError(400, 'Resulting battery balance must be a whole number');
  }

  const movement = await tx.stockMovement.create({
    data: {
      companyId: ctx.companyId,
      itemType: 'FINISHED_BATTERY',
      movementType: input.movementType,
      batteryTypeId: input.batteryTypeId,
      quantityChange: input.quantityChange,
      resultingBalance: newBalance,
      reason: input.reason,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      userId: ctx.userId,
    },
  });

  await tx.batteryType.update({
    where: { id: input.batteryTypeId },
    data: { currentStock: newBalance.toNumber() },
  });

  return movement;
}

export function movementToDto(m: StockMovement) {
  return {
    id: m.id,
    itemType: m.itemType,
    movementType: m.movementType,
    rawMaterialId: m.rawMaterialId,
    batteryTypeId: m.batteryTypeId,
    quantityChange: m.quantityChange.toString(),
    resultingBalance: m.resultingBalance.toString(),
    reason: m.reason,
    referenceType: m.referenceType,
    referenceId: m.referenceId,
    userId: m.userId,
    createdAt: m.createdAt.toISOString(),
  };
}
