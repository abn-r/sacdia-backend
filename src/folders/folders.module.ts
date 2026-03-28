import { Module } from '@nestjs/common';
import { FoldersController, UserFoldersController } from './folders.controller';
import { FoldersService } from './folders.service';
import { PrismaModule } from '../prisma/prisma.module';
import { EvidenceFolderController } from './evidence-folder.controller';
import { EvidenceFolderService } from './evidence-folder.service';

@Module({
  imports: [PrismaModule],
  controllers: [
    FoldersController,
    UserFoldersController,
    EvidenceFolderController,
  ],
  providers: [FoldersService, EvidenceFolderService],
  exports: [FoldersService],
})
export class FoldersModule {}
