import {
  Injectable,
  NotFoundException,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SupabaseService } from '../common/supabase.service';
import { UpdateUserDto } from './dto/update-user.dto';
import {
  UpdateUserAllergiesDto,
  UpdateUserDiseasesDto,
} from './dto/update-user-medical.dto';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private prisma: PrismaService,
    private supabase: SupabaseService,
  ) {}

  private async ensureUserExists(userId: string) {
    const user = await this.prisma.users.findUnique({
      where: { user_id: userId },
    });

    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    return user;
  }

  private async validateGeographyReferences(
    updateUserDto: UpdateUserDto,
    currentUser: {
      country_id: number | null;
      union_id: number | null;
      local_field_id: number | null;
    },
  ) {
    let selectedUnion:
      | {
          union_id: number;
          country_id: number;
        }
      | null = null;

    if (updateUserDto.country_id !== undefined) {
      const country = await this.prisma.countries.findFirst({
        where: { country_id: updateUserDto.country_id, active: true },
        select: { country_id: true },
      });
      if (!country) {
        throw new BadRequestException('País no válido o inactivo');
      }
    }

    if (updateUserDto.union_id !== undefined) {
      selectedUnion = await this.prisma.unions.findFirst({
        where: { union_id: updateUserDto.union_id, active: true },
        select: { union_id: true, country_id: true },
      });
      if (!selectedUnion) {
        throw new BadRequestException('Unión no válida o inactiva');
      }
    }

    if (updateUserDto.local_field_id !== undefined) {
      const localField = await this.prisma.local_fields.findFirst({
        where: { local_field_id: updateUserDto.local_field_id, active: true },
        select: { local_field_id: true },
      });
      if (!localField) {
        throw new BadRequestException('Campo local no válido o inactivo');
      }
    }

    const targetCountryId = updateUserDto.country_id ?? currentUser.country_id;
    const targetUnionId = updateUserDto.union_id ?? currentUser.union_id;

    if (targetCountryId !== null && targetUnionId !== null) {
      if (!selectedUnion || selectedUnion.union_id !== targetUnionId) {
        selectedUnion = await this.prisma.unions.findUnique({
          where: { union_id: targetUnionId },
          select: { union_id: true, country_id: true },
        });
      }

      if (!selectedUnion || selectedUnion.country_id !== targetCountryId) {
        throw new BadRequestException(
          'La unión seleccionada no pertenece al país seleccionado',
        );
      }
    }

    const targetLocalFieldId =
      updateUserDto.local_field_id ?? currentUser.local_field_id;

    if (targetLocalFieldId !== null && targetUnionId !== null) {
      const localField = await this.prisma.local_fields.findUnique({
        where: { local_field_id: targetLocalFieldId },
        select: { local_field_id: true, union_id: true },
      });

      if (!localField || localField.union_id !== targetUnionId) {
        throw new BadRequestException(
          'El campo local seleccionado no pertenece a la unión seleccionada',
        );
      }
    }
  }

  private async validateAllergiesExist(allergyIds: number[]) {
    if (!allergyIds.length) return;

    const rows = await this.prisma.allergies.findMany({
      where: {
        allergy_id: { in: allergyIds },
        active: true,
      },
      select: { allergy_id: true },
    });

    const found = new Set(rows.map((row) => row.allergy_id));
    const invalid = allergyIds.filter((id) => !found.has(id));

    if (invalid.length > 0) {
      throw new BadRequestException(
        `Alergias inválidas o inactivas: ${invalid.join(', ')}`,
      );
    }
  }

  private async validateDiseasesExist(diseaseIds: number[]) {
    if (!diseaseIds.length) return;

    const rows = await this.prisma.diseases.findMany({
      where: {
        disease_id: { in: diseaseIds },
        active: true,
      },
      select: { disease_id: true },
    });

    const found = new Set(rows.map((row) => row.disease_id));
    const invalid = diseaseIds.filter((id) => !found.has(id));

    if (invalid.length > 0) {
      throw new BadRequestException(
        `Enfermedades inválidas o inactivas: ${invalid.join(', ')}`,
      );
    }
  }

  async findOne(userId: string) {
    const user = await this.prisma.users.findUnique({
      where: { user_id: userId },
      select: {
        user_id: true,
        email: true,
        name: true,
        paternal_last_name: true,
        maternal_last_name: true,
        gender: true,
        birthday: true,
        baptism: true,
        baptism_date: true,
        blood: true,
        user_image: true,
        country_id: true,
        union_id: true,
        local_field_id: true,
        access_app: true,
        access_panel: true,
        created_at: true,
        modified_at: true,
      },
    });

    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    return { status: 'success', data: user };
  }

  async update(userId: string, updateUserDto: UpdateUserDto) {
    // Validar que el usuario existe
    const existingUser = await this.ensureUserExists(userId);

    // Validar baptism_date solo si baptism es true
    if (updateUserDto.baptism === false && updateUserDto.baptism_date) {
      throw new BadRequestException(
        'No se puede especificar fecha de bautismo si no está bautizado',
      );
    }

    await this.validateGeographyReferences(updateUserDto, existingUser);

    const updatedUser = await this.prisma.users.update({
      where: { user_id: userId },
      data: updateUserDto,
      select: {
        user_id: true,
        email: true,
        name: true,
        paternal_last_name: true,
        maternal_last_name: true,
        gender: true,
        birthday: true,
        baptism: true,
        baptism_date: true,
        blood: true,
        country_id: true,
        union_id: true,
        local_field_id: true,
        modified_at: true,
      },
    });

    this.logger.log(`User updated: ${userId}`);

    return {
      status: 'success',
      data: updatedUser,
      message: 'Usuario actualizado exitosamente',
    };
  }

  async updateAllergies(userId: string, dto: UpdateUserAllergiesDto) {
    await this.ensureUserExists(userId);

    const allergyIds = [...new Set(dto.allergy_ids)];
    await this.validateAllergiesExist(allergyIds);

    const data = await this.prisma.$transaction(async (tx) => {
      const now = new Date();

      await tx.users_allergies.updateMany({
        where: {
          user_id: userId,
          active: true,
          ...(allergyIds.length > 0 ? { allergy_id: { notIn: allergyIds } } : {}),
        },
        data: {
          active: false,
          modified_at: now,
        },
      });

      for (const allergyId of allergyIds) {
        const existing = await tx.users_allergies.findFirst({
          where: {
            user_id: userId,
            allergy_id: allergyId,
          },
          select: { user_allergies_id: true },
        });

        if (existing) {
          await tx.users_allergies.update({
            where: { user_allergies_id: existing.user_allergies_id },
            data: {
              active: true,
              modified_at: now,
            },
          });
        } else {
          await tx.users_allergies.create({
            data: {
              user_id: userId,
              allergy_id: allergyId,
              active: true,
            },
          });
        }
      }

      return tx.users_allergies.findMany({
        where: {
          user_id: userId,
          active: true,
        },
        select: {
          allergy_id: true,
          allergies: {
            select: {
              name: true,
              description: true,
            },
          },
        },
        orderBy: { allergy_id: 'asc' },
      });
    });

    this.logger.log(`User allergies updated: ${userId}`);

    return {
      status: 'success',
      data,
      message: 'Alergias actualizadas exitosamente',
    };
  }

  async updateDiseases(userId: string, dto: UpdateUserDiseasesDto) {
    await this.ensureUserExists(userId);

    const diseaseIds = [...new Set(dto.disease_ids)];
    await this.validateDiseasesExist(diseaseIds);

    const data = await this.prisma.$transaction(async (tx) => {
      const now = new Date();

      await tx.users_diseases.updateMany({
        where: {
          user_id: userId,
          active: true,
          ...(diseaseIds.length > 0 ? { disease_id: { notIn: diseaseIds } } : {}),
        },
        data: {
          active: false,
          modified_at: now,
        },
      });

      for (const diseaseId of diseaseIds) {
        const existing = await tx.users_diseases.findFirst({
          where: {
            user_id: userId,
            disease_id: diseaseId,
          },
          select: { user_disease_id: true },
        });

        if (existing) {
          await tx.users_diseases.update({
            where: { user_disease_id: existing.user_disease_id },
            data: {
              active: true,
              modified_at: now,
            },
          });
        } else {
          await tx.users_diseases.create({
            data: {
              user_id: userId,
              disease_id: diseaseId,
              active: true,
            },
          });
        }
      }

      return tx.users_diseases.findMany({
        where: {
          user_id: userId,
          active: true,
        },
        select: {
          disease_id: true,
          diseases: {
            select: {
              name: true,
              description: true,
            },
          },
        },
        orderBy: { disease_id: 'asc' },
      });
    });

    this.logger.log(`User diseases updated: ${userId}`);

    return {
      status: 'success',
      data,
      message: 'Enfermedades actualizadas exitosamente',
    };
  }

  async removeAllergy(userId: string, allergyId: number) {
    await this.ensureUserExists(userId);

    const now = new Date();
    const result = await this.prisma.users_allergies.updateMany({
      where: {
        user_id: userId,
        allergy_id: allergyId,
        active: true,
      },
      data: {
        active: false,
        modified_at: now,
      },
    });

    if (result.count === 0) {
      throw new NotFoundException(
        'Alergia no encontrada en el perfil del usuario',
      );
    }

    this.logger.log(`User allergy removed: ${userId} -> ${allergyId}`);

    return {
      status: 'success',
      data: {
        allergy_id: allergyId,
        active: false,
      },
      message: 'Alergia eliminada exitosamente',
    };
  }

  async removeDisease(userId: string, diseaseId: number) {
    await this.ensureUserExists(userId);

    const now = new Date();
    const result = await this.prisma.users_diseases.updateMany({
      where: {
        user_id: userId,
        disease_id: diseaseId,
        active: true,
      },
      data: {
        active: false,
        modified_at: now,
      },
    });

    if (result.count === 0) {
      throw new NotFoundException(
        'Enfermedad no encontrada en el perfil del usuario',
      );
    }

    this.logger.log(`User disease removed: ${userId} -> ${diseaseId}`);

    return {
      status: 'success',
      data: {
        disease_id: diseaseId,
        active: false,
      },
      message: 'Enfermedad eliminada exitosamente',
    };
  }

  async uploadProfilePicture(userId: string, file: Express.Multer.File) {
    // Validar formato
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException(
        'Formato no válido. Solo se permiten JPG, PNG, WEBP',
      );
    }

    // Validar tamaño (max 5MB)
    const maxSize = 5 * 1024 * 1024; // 5MB
    if (file.size > maxSize) {
      throw new BadRequestException('Archivo muy grande. Tamaño máximo: 5MB');
    }

    // Determinar extensión
    const extension = file.mimetype.split('/')[1];
    const fileName = `photo-${userId}.${extension}`;

    // Upload a Supabase Storage
    const { error: uploadError } = await this.supabase.admin.storage
      .from('profile-pictures')
      .upload(fileName, file.buffer, {
        contentType: file.mimetype,
        upsert: true, // Sobrescribir si existe
      });

    if (uploadError) {
      this.logger.error('Supabase upload error:', uploadError);
      throw new InternalServerErrorException('Error al subir la imagen');
    }

    // Obtener URL pública
    const {
      data: { publicUrl },
    } = this.supabase.admin.storage
      .from('profile-pictures')
      .getPublicUrl(fileName);

    // Actualizar en BD
    await this.prisma.users.update({
      where: { user_id: userId },
      data: { user_image: publicUrl },
    });

    this.logger.log(`Profile picture uploaded for user: ${userId}`);

    return {
      status: 'success',
      data: {
        url: publicUrl,
        fileName,
      },
      message: 'Foto de perfil actualizada exitosamente',
    };
  }

  async deleteProfilePicture(userId: string) {
    const user = await this.prisma.users.findUnique({
      where: { user_id: userId },
      select: { user_image: true },
    });

    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }

    if (!user.user_image) {
      throw new BadRequestException('El usuario no tiene foto de perfil');
    }

    // Extraer nombre de archivo de la URL
    const fileName = user.user_image.split('/').pop();

    // Eliminar de Supabase Storage
    const { error } = await this.supabase.admin.storage
      .from('profile-pictures')
      .remove([fileName!]);

    if (error) {
      this.logger.error('Supabase delete error:', error);
      throw new InternalServerErrorException('Error al eliminar la imagen');
    }

    // Actualizar en BD
    await this.prisma.users.update({
      where: { user_id: userId },
      data: { user_image: null },
    });

    this.logger.log(`Profile picture deleted for user: ${userId}`);

    return {
      status: 'success',
      message: 'Foto de perfil eliminada exitosamente',
    };
  }

  async calculateAge(userId: string): Promise<number | null> {
    const user = await this.prisma.users.findUnique({
      where: { user_id: userId },
      select: { birthday: true },
    });

    if (!user || !user.birthday) {
      return null;
    }

    const today = new Date();
    const birthDate = new Date(user.birthday);
    let age = today.getFullYear() - birthDate.getFullYear();
    const monthDiff = today.getMonth() - birthDate.getMonth();

    if (
      monthDiff < 0 ||
      (monthDiff === 0 && today.getDate() < birthDate.getDate())
    ) {
      age--;
    }

    return age;
  }

  async requiresLegalRepresentative(userId: string): Promise<boolean> {
    const age = await this.calculateAge(userId);
    return age !== null && age < 18;
  }
}
