import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { UpdateConfigDto } from './dto/update-config.dto';
import type { ConfigDto } from './dto/config.dto';

const CONFIG_SELECT = {
  local_field_id: true,
  bank_name: true,
  bank_account_clabe: true,
  account_holder: true,
  envio_centavos_default: true,
  pickup_address: true,
  delivery_options: true,
  updated_at: true,
} as const;

@Injectable()
export class ConfigService {
  private readonly logger = new Logger(ConfigService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------------------------
  // GET — REQ-CFG-001
  // Returns the materials config row for a specific local_field. If no row
  // exists yet (campo hasn't been configured), returns zero-defaults so the
  // admin form can render with empty fields.
  // ---------------------------------------------------------------------------

  async get(localFieldId: number): Promise<ConfigDto> {
    const row = await this.prisma.materialConfig.findUnique({
      where: { local_field_id: localFieldId },
      select: CONFIG_SELECT,
    });

    if (row) {
      return row;
    }

    // No row yet — return a placeholder so the UI can render an empty form.
    // The first PATCH will upsert.
    return {
      local_field_id: localFieldId,
      bank_name: null,
      bank_account_clabe: null,
      account_holder: null,
      envio_centavos_default: 0,
      pickup_address: null,
      delivery_options: [],
      updated_at: null,
    };
  }

  // ---------------------------------------------------------------------------
  // LIST — for unscoped admin/super-admin to see configs across all LFs.
  // ---------------------------------------------------------------------------

  async listAll(): Promise<ConfigDto[]> {
    return this.prisma.materialConfig.findMany({
      select: CONFIG_SELECT,
      orderBy: { local_field_id: 'asc' },
    });
  }

  // ---------------------------------------------------------------------------
  // UPSERT — REQ-CFG-002
  // Per-LF row. We upsert so callers can create the row implicitly on first
  // PATCH (matches the empty-form placeholder behaviour of get()).
  // ---------------------------------------------------------------------------

  async upsert(
    localFieldId: number,
    dto: UpdateConfigDto,
    userId: string,
  ): Promise<ConfigDto> {
    // Verify the local_field exists. Without this an arbitrary integer would
    // produce a foreign key violation deep in the upsert.
    const lf = await this.prisma.local_fields.findUnique({
      where: { local_field_id: localFieldId },
      select: { local_field_id: true },
    });
    if (!lf) {
      throw new NotFoundException({
        code: 'local_field_not_found',
        message: `Local field ${localFieldId} not found`,
      });
    }

    const updateData: Prisma.MaterialConfigUncheckedUpdateInput = {
      updated_by: userId,
    };

    if (dto.bank_name !== undefined) updateData.bank_name = dto.bank_name;
    if (dto.bank_account_clabe !== undefined)
      updateData.bank_account_clabe = dto.bank_account_clabe;
    if (dto.account_holder !== undefined)
      updateData.account_holder = dto.account_holder;
    if (dto.envio_centavos_default !== undefined)
      updateData.envio_centavos_default = dto.envio_centavos_default;
    if (dto.pickup_address !== undefined)
      updateData.pickup_address = dto.pickup_address;
    if (dto.delivery_options !== undefined)
      updateData.delivery_options =
        dto.delivery_options as Prisma.InputJsonValue;

    const updated = await this.prisma.materialConfig.upsert({
      where: { local_field_id: localFieldId },
      update: updateData,
      create: {
        local_field_id: localFieldId,
        bank_name: dto.bank_name ?? null,
        bank_account_clabe: dto.bank_account_clabe ?? null,
        account_holder: dto.account_holder ?? null,
        envio_centavos_default: dto.envio_centavos_default ?? 0,
        pickup_address: dto.pickup_address ?? null,
        delivery_options:
          dto.delivery_options !== undefined
            ? (dto.delivery_options as Prisma.InputJsonValue)
            : [],
        updated_by: userId,
      },
      select: CONFIG_SELECT,
    });

    this.logger.log({
      event: 'config.upserted',
      local_field_id: localFieldId,
      updated_by: userId,
    });

    return updated;
  }
}
