import { Module } from '@nestjs/common';
import { CacheModule } from '@nestjs/cache-manager';
import { CatalogsController } from './catalogs.controller';
import { CatalogsService } from './catalogs.service';
import { CatalogCacheService } from './catalog-cache.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  // CacheModule is already registered globally in CommonModule.
  // Importing it here re-uses the same global store (Redis or in-memory)
  // without creating a second connection.
  imports: [PrismaModule, CacheModule],
  controllers: [CatalogsController],
  providers: [CatalogsService, CatalogCacheService],
  exports: [CatalogsService, CatalogCacheService],
})
export class CatalogsModule {}
