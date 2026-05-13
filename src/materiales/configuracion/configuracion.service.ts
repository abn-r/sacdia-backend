import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { UpdateConfigDto } from './dto/update-config.dto';
import type { ConfigDto } from './dto/config.dto';

/** ID of the single-row config record. Always 1 (seeded by migration). */
const CONFIG_ID = 1;

@Injectable()
export class ConfiguracionService {
  private readonly logger = new Logger(ConfiguracionService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // GET — REQ-CFG-001
  // ---------------------------------------------------------------------------

  async get(): Promise<ConfigDto> {
    const row = await this.prisma.materialConfig.findUnique({
      where: { id: CONFIG_ID },
      select: {
        bank_name: true,
        bank_account_clabe: true,
        account_holder: true,
        envio_centavos_default: true,
        pickup_address: true,
        delivery_options: true,
        updated_at: true,
      },
    });

    if (!row) {
      // Should never happen — migration seeds row id=1
      throw new NotFoundException('Material config not found');
    }

    return row;
  }

  // ---------------------------------------------------------------------------
  // UPDATE — REQ-CFG-002
  // ---------------------------------------------------------------------------

  async update(dto: UpdateConfigDto, userId: string): Promise<ConfigDto> {
    const data: Prisma.MaterialConfigUncheckedUpdateInput = {
      updated_by: userId,
    };

    if (dto.bank_name !== undefined) data.bank_name = dto.bank_name;
    if (dto.bank_account_clabe !== undefined) data.bank_account_clabe = dto.bank_account_clabe;
    if (dto.account_holder !== undefined) data.account_holder = dto.account_holder;
    if (dto.envio_centavos_default !== undefined) data.envio_centavos_default = dto.envio_centavos_default;
    if (dto.pickup_address !== undefined) data.pickup_address = dto.pickup_address;
    if (dto.delivery_options !== undefined) data.delivery_options = dto.delivery_options as Prisma.InputJsonValue;

    const updated = await this.prisma.materialConfig.update({
      where: { id: CONFIG_ID },
      data,
      select: {
        bank_name: true,
        bank_account_clabe: true,
        account_holder: true,
        envio_centavos_default: true,
        pickup_address: true,
        delivery_options: true,
        updated_at: true,
      },
    });

    this.logger.log({
      event: 'config.updated',
      updated_by: userId,
    });

    return updated;
  }
}
