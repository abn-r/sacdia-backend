import { Module } from '@nestjs/common';
import { CatalogController } from './catalog/catalog.controller';
import { CatalogService } from './catalog/catalog.service';
import { CategoriesController } from './categories/categories.controller';
import { CategoriesService } from './categories/categories.service';
import { ConfigController } from './config/config.controller';
import { ConfigService } from './config/config.service';
import { OrdersController } from './orders/orders.controller';
import { OrdersService } from './orders/orders.service';
import { FolioService } from './orders/folio.service';
import { StockService } from './orders/stock.service';
import { ReceiptsController } from './receipts/receipts.controller';
import { ReceiptsService } from './receipts/receipts.service';
import { InventoryController } from './inventory/inventory.controller';
import { InventoryService } from './inventory/inventory.service';
import { EventsPublisher } from './shared/events.publisher';

/**
 * MaterialsModule — Pedidos de materiales SACDIA
 *
 * Sub-modules (PR2):
 *   - catalog/      → product browsing (GET /api/v1/materials/catalog, /categories, /programs, /:id)
 *   - config/       → singleton bank + delivery config (GET + PATCH /api/v1/materials/config)
 *
 * Sub-modules (PR3a):
 *   - orders/       → order create + list + detail (POST, GET, GET /history, GET /:folio)
 *
 * Sub-modules (PR3b-β — this slice):
 *   - orders/folio.service.ts   → FolioService (allocate folio with FOR UPDATE counter)
 *   - orders/stock.service.ts   → StockService (decrement/restore stock in tx)
 *   - orders/       → approve() + POST :folio/approve route
 *
 * Sub-modules (PR4):
 *   - receipts/  → payment receipt upload + approve + reject (POST, GET, POST /approve, POST /reject)
 *
 * Sub-modules (PR5):
 *   - inventory/    → product CRUD (GET, POST, PATCH, DELETE, PATCH /:id/variants/:variantId)
 *
 * Infrastructure dependencies:
 *   - PrismaService  — provided globally by PrismaModule (@Global)
 *   - CommonModule   — provided globally (@Global); supplies FILE_STORAGE_SERVICE for PR4
 */
@Module({
  controllers: [
    CatalogController,
    CategoriesController,
    ConfigController,
    OrdersController,
    ReceiptsController,
    InventoryController,
  ],
  providers: [
    CatalogService,
    CategoriesService,
    ConfigService,
    OrdersService,
    FolioService,
    StockService,
    ReceiptsService,
    InventoryService,
    EventsPublisher,
  ],
  exports: [EventsPublisher],
})
export class MaterialsModule {}
