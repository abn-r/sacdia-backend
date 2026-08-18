import { Module } from '@nestjs/common';
import { ResourcesAppController } from './resources-app.controller';
import { ResourcesController } from './resources.controller';
import { ResourceCategoriesController } from './resource-categories.controller';
import { ResourcesService } from './resources.service';
import { ResourceCategoriesService } from './resource-categories.service';
import { CatalogsModule } from '../catalogs/catalogs.module';

/**
 * Módulo de recursos digitales (documentos, audios, imágenes, links de video, texto).
 *
 * Dependencias de infraestructura:
 * - PrismaService — provisto globalmente por PrismaModule (@Global)
 * - FILE_STORAGE_SERVICE — provisto globalmente por CommonModule (@Global)
 *
 * Orden de controllers: ResourcesAppController DEBE ir antes de ResourcesController
 * para que las rutas `/resources/me` no sean capturadas por el param `:id`.
 */
@Module({
  imports: [CatalogsModule],
  controllers: [
    ResourcesAppController,
    ResourcesController,
    ResourceCategoriesController,
  ],
  providers: [ResourcesService, ResourceCategoriesService],
})
export class ResourcesModule {}
