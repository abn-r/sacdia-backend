import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * StockService — handles stock movements for order approval and cancellation.
 *
 * Design rules (locked by spec REQ-INV-004, REQ-INV-005, SC-07):
 *   - Stock decrement happens INSIDE the approval transaction (must receive tx).
 *   - Uses SELECT … FOR UPDATE to serialize concurrent approvals on the same product.
 *   - Shortage → throws ConflictException 409 with code `insufficient_stock`.
 *   - Lines with qty_disponible <= 0 (agotado) are skipped — no stock movement.
 *   - restoreForCancel: symmetric increment; symmetric FOR UPDATE included for consistency.
 */
@Injectable()
export class StockService {
  private readonly logger = new Logger(StockService.name);

  /**
   * Decrements product (and variant option) stock for each approved line.
   * Locks all referenced product rows before reading stock to serialize concurrency.
   *
   * @param tx    - Prisma interactive transaction client.
   * @param lines - Order lines to decrement.
   * @throws ConflictException 409 `insufficient_stock` if any line cannot be fulfilled.
   */
  async decrementForApproval(
    tx: Prisma.TransactionClient,
    lines: Array<{
      id: string;
      product_id: string;
      variant_option_id: string | null;
      qty_disponible: number | null;
    }>,
  ): Promise<void> {
    // Filter out agotado lines (qty_disponible = 0 or null) — no stock movement needed
    const activeLines = lines.filter(
      (l) => l.qty_disponible !== null && l.qty_disponible > 0,
    );

    if (activeLines.length === 0) {
      return;
    }

    // Collect unique product IDs across active lines
    const uniqueProductIds = [...new Set(activeLines.map((l) => l.product_id))];

    // Lock all referenced product rows concurrently to prevent over-sell (SC-07)
    const lockedProducts = await tx.$queryRawUnsafe<
      Array<{ id: string; stock: number }>
    >(
      `SELECT id, stock FROM material_products WHERE id = ANY($1::uuid[]) FOR UPDATE`,
      uniqueProductIds,
    );

    // Build stock map from locked snapshot
    const stockMap = new Map<string, number>(
      lockedProducts.map((p) => [p.id, p.stock]),
    );

    // Validate all lines against locked stock — collect shortages before touching DB
    const shortages: Array<{
      product_id: string;
      required: number;
      available: number;
    }> = [];

    for (const line of activeLines) {
      const available = stockMap.get(line.product_id) ?? 0;
      const required = line.qty_disponible!;
      if (available < required) {
        shortages.push({ product_id: line.product_id, required, available });
      }
    }

    if (shortages.length > 0) {
      throw new ConflictException({
        code: 'insufficient_stock',
        message: 'One or more products have insufficient stock',
        details: shortages,
      });
    }

    // Apply decrements — all validations passed
    for (const line of activeLines) {
      await tx.materialProduct.update({
        where: { id: line.product_id },
        data: { stock: { decrement: line.qty_disponible! } },
      });

      // If line targets a variant option, decrement its stock too (REQ-INV-004)
      if (line.variant_option_id) {
        await tx.materialVariantOption.update({
          where: { id: line.variant_option_id },
          data: { stock: { decrement: line.qty_disponible! } },
        });
      }
    }

    this.logger.log({
      event: 'stock.decremented',
      line_count: activeLines.length,
    });
  }

  /**
   * Restores product (and variant option) stock for a cancelled order
   * that had previously been approved (REQ-INV-005).
   *
   * @param tx    - Prisma interactive transaction client.
   * @param lines - Order lines to restore (same shape as decrementForApproval).
   */
  async restoreForCancel(
    tx: Prisma.TransactionClient,
    lines: Array<{
      product_id: string;
      variant_option_id: string | null;
      qty_disponible: number | null;
    }>,
  ): Promise<void> {
    // Filter out lines that had no stock decrement (agotado or not set)
    const activeLines = lines.filter(
      (l) => l.qty_disponible !== null && l.qty_disponible > 0,
    );

    if (activeLines.length === 0) {
      return;
    }

    // Lock product rows for symmetry (prevents races against concurrent approvals)
    const uniqueProductIds = [...new Set(activeLines.map((l) => l.product_id))];
    await tx.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM material_products WHERE id = ANY($1::uuid[]) FOR UPDATE`,
      uniqueProductIds,
    );

    // Apply increments
    for (const line of activeLines) {
      await tx.materialProduct.update({
        where: { id: line.product_id },
        data: { stock: { increment: line.qty_disponible! } },
      });

      if (line.variant_option_id) {
        await tx.materialVariantOption.update({
          where: { id: line.variant_option_id },
          data: { stock: { increment: line.qty_disponible! } },
        });
      }
    }

    this.logger.log({
      event: 'stock.restored',
      line_count: activeLines.length,
    });
  }
}
