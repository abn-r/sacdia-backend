import { Module } from '@nestjs/common';
import {
  AnnualFoldersController,
  AnnualFolderTemplatesController,
} from './annual-folders.controller';
import { AnnualFoldersService } from './annual-folders.service';
import { PrismaModule } from '../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [AnnualFolderTemplatesController, AnnualFoldersController],
  providers: [AnnualFoldersService],
  exports: [AnnualFoldersService],
})
export class AnnualFoldersModule {}
