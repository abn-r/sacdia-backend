import { Module } from '@nestjs/common';
import { CatalogsController } from './catalogs.controller';
import { CatalogsService } from './catalogs.service';
import { CatalogCacheService } from './catalog-cache.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  // CACHE_MANAGER is provided globally by CommonModule — no need to import CacheModule here.
  imports: [PrismaModule],
  controllers: [CatalogsController],
  providers: [CatalogsService, CatalogCacheService],
  exports: [CatalogsService, CatalogCacheService],
})
export class CatalogsModule {}
