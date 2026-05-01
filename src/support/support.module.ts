import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { CommonModule } from '../common/common.module';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';

/**
 * SupportModule — endpoints de Soporte/Ayuda para la app móvil.
 *
 * Expone `POST /api/v1/support/reports` para que los usuarios reporten
 * bugs, sugerencias y problemas de cuenta desde la app. Los FAQs y canales
 * de contacto (email/WhatsApp) viven en el cliente (assets/support/faq.json
 * y url_launcher).
 */
@Module({
  imports: [PrismaModule, CommonModule],
  controllers: [SupportController],
  providers: [SupportService],
  exports: [SupportService],
})
export class SupportModule {}
