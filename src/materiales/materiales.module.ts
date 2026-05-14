import { Module } from '@nestjs/common';
import { CatalogoController } from './catalogo/catalogo.controller';
import { CatalogoService } from './catalogo/catalogo.service';
import { ConfiguracionController } from './configuracion/configuracion.controller';
import { ConfiguracionService } from './configuracion/configuracion.service';
import { OrdenesController } from './ordenes/ordenes.controller';
import { OrdenesService } from './ordenes/ordenes.service';
import { FolioService } from './ordenes/folio.service';
import { StockService } from './ordenes/stock.service';
import { EventsPublisher } from './shared/events.publisher';

/**
 * MaterialesModule — Pedidos de materiales SACDIA
 *
 * Sub-modules (PR2):
 *   - catalogo/      → product browsing (GET /api/v1/materiales/catalogo, /categorias, /programas, /:id)
 *   - configuracion/ → singleton bank + delivery config (GET + PATCH /api/v1/materiales/configuracion)
 *
 * Sub-modules (PR3a):
 *   - ordenes/       → order create + list + detail (POST, GET, GET /historial, GET /:folio)
 *
 * Sub-modules (PR3b-β — this slice):
 *   - ordenes/folio.service.ts   → FolioService (allocate folio with FOR UPDATE counter)
 *   - ordenes/stock.service.ts   → StockService (decrement/restore stock in tx)
 *   - ordenes/       → approve() + POST :folio/aprobar route
 *
 * Sub-modules (future PRs):
 *   - ordenes/       → cancel + deliver (PR3b-γ)
 *   - comprobantes/  → payment receipt uploads (PR4)
 *   - inventario/    → product CRUD (PR5)
 *
 * Infrastructure dependencies:
 *   - PrismaService  — provided globally by PrismaModule (@Global)
 *   - CommonModule   — provided globally (@Global); supplies FILE_STORAGE_SERVICE for PR4
 */
@Module({
  controllers: [CatalogoController, ConfiguracionController, OrdenesController],
  providers: [
    CatalogoService,
    ConfiguracionService,
    OrdenesService,
    FolioService,
    StockService,
    EventsPublisher,
  ],
  exports: [EventsPublisher],
})
export class MaterialesModule {}
