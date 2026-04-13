import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class SystemConfigService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.system_config.findMany({
      orderBy: { config_key: 'asc' },
    });
  }

  async findByKey(key: string) {
    const config = await this.prisma.system_config.findUnique({
      where: { config_key: key },
    });

    if (!config) {
      throw new NotFoundException(
        `Configuracion con clave '${key}' no encontrada`,
      );
    }

    return config;
  }

  async updateByKey(key: string, configValue: string) {
    const existing = await this.prisma.system_config.findUnique({
      where: { config_key: key },
    });

    if (!existing) {
      throw new NotFoundException(
        `Configuracion con clave '${key}' no encontrada`,
      );
    }

    return this.prisma.system_config.update({
      where: { config_key: key },
      data: {
        config_value: configValue,
      },
    });
  }
}
