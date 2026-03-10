import {
  Injectable,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import { LegalRepresentativesService } from '../legal-representatives/legal-representatives.service';
import { CompleteClubSelectionDto } from './dto/complete-club-selection.dto';

export type PostRegistrationActorContext = {
  actorUserId: string;
  isOwner: boolean;
};

@Injectable()
export class PostRegistrationService {
  private readonly logger = new Logger(PostRegistrationService.name);

  constructor(
    private prisma: PrismaService,
    private usersService: UsersService,
    private legalRepService: LegalRepresentativesService,
  ) {}

  async getStatus(
    userId: string,
    actor: PostRegistrationActorContext = this.createOwnerContext(userId),
  ) {
    const userPr = await this.prisma.users_pr.findUnique({
      where: { user_id: userId },
    });

    if (!userPr) {
      throw new BadRequestException('Post-registro no iniciado');
    }

    let nextStep: string | null = null;
    if (!userPr.profile_picture_complete) {
      nextStep = 'profilePicture';
    } else if (!userPr.personal_info_complete) {
      nextStep = 'personalInfo';
    } else if (!userPr.club_selection_complete) {
      nextStep = 'clubSelection';
    }

    const response = {
      status: 'success',
      data: {
        complete: userPr.complete,
        steps: {
          profilePicture: userPr.profile_picture_complete,
          personalInfo: userPr.personal_info_complete,
          clubSelection: userPr.club_selection_complete,
        },
        nextStep,
        dateCompleted: userPr.date_completed,
      },
    };

    if (actor.isOwner) {
      return response;
    }

    return {
      status: 'success',
      data: {
        complete: response.data.complete,
        steps: response.data.steps,
        dateCompleted: response.data.dateCompleted,
      },
    };
  }

  async completeStep1(
    userId: string,
    actor: PostRegistrationActorContext = this.createOwnerContext(userId),
  ) {
    try {
      // Verificar que el usuario tenga foto
      const user = await this.prisma.users.findUnique({
        where: { user_id: userId },
        select: { user_image: true },
      });

      if (!user?.user_image) {
        throw new BadRequestException(
          'Debe subir una foto de perfil antes de completar este paso',
        );
      }

      await this.prisma.users_pr.update({
        where: { user_id: userId },
        data: { profile_picture_complete: true },
      });

      this.logger.log(`Step 1 (profile picture) completed for user ${userId}`);

      return actor.isOwner
        ? {
            status: 'success',
            message: 'Paso 1 completado: Foto de perfil',
          }
        : {
            status: 'success',
            message: 'Paso 1 completado',
          };
    } catch (error) {
      throw this.sanitizeAdministrativeValidationError(
        error,
        actor,
        'No se puede completar el paso 1 para este usuario',
      );
    }
  }

  async completeStep2(
    userId: string,
    actor: PostRegistrationActorContext = this.createOwnerContext(userId),
  ) {
    try {
      // Validar que tenga info personal completa
      const user = await this.prisma.users.findUnique({
        where: { user_id: userId },
        select: {
          gender: true,
          birthday: true,
          baptism: true,
        },
      });

      if (!user) {
        throw new BadRequestException('Usuario no encontrado');
      }

      if (!user.gender || !user.birthday || user.baptism === null) {
        throw new BadRequestException(
          'Debe completar información personal (género, cumpleaños, bautismo)',
        );
      }

      // Validar contactos de emergencia (al menos 1)
      const contactsCount = await this.prisma.emergency_contacts.count({
        where: {
          owner_id: userId,
          active: true,
        },
      });

      if (contactsCount === 0) {
        throw new BadRequestException(
          'Debe agregar al menos un contacto de emergencia',
        );
      }

      // Si es menor de 18, validar representante legal
      const requiresRep =
        await this.usersService.requiresLegalRepresentative(userId);

      if (requiresRep) {
        try {
          await this.legalRepService.findOne(userId);
        } catch {
          throw new BadRequestException(
            'Menores de 18 años deben registrar un representante legal',
          );
        }
      }

      await this.prisma.users_pr.update({
        where: { user_id: userId },
        data: { personal_info_complete: true },
      });

      this.logger.log(`Step 2 (personal info) completed for user ${userId}`);

      return actor.isOwner
        ? {
            status: 'success',
            message: 'Paso 2 completado: Información personal',
          }
        : {
            status: 'success',
            message: 'Paso 2 completado',
          };
    } catch (error) {
      throw this.sanitizeAdministrativeValidationError(
        error,
        actor,
        'No se puede completar el paso 2 para este usuario',
      );
    }
  }

  async completeStep3(
    userId: string,
    dto: CompleteClubSelectionDto,
    actor: PostRegistrationActorContext = this.createOwnerContext(userId),
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // 1. Actualizar país, unión, campo local
        await tx.users.update({
          where: { user_id: userId },
          data: {
            country_id: dto.country_id,
            union_id: dto.union_id,
            local_field_id: dto.local_field_id,
          },
        });

        // 2. Obtener año eclesiástico actual
        const currentYear = await tx.ecclesiastical_years.findFirst({
          where: {
            start_date: { lte: new Date() },
            end_date: { gte: new Date() },
          },
        });

        if (!currentYear) {
          throw new InternalServerErrorException(
            'No hay año eclesiástico activo configurado',
          );
        }

        // 3. Obtener rol "member" (CLUB)
        const memberRole = await tx.roles.findFirst({
          where: {
            role_name: 'member',
            role_category: 'CLUB',
          },
        });

        if (!memberRole) {
          throw new InternalServerErrorException(
            'Rol "member" no encontrado en el sistema',
          );
        }

        // 4. Determinar campo de instancia según tipo de club
        const clubInstanceField =
          dto.club_type === 'adventurers'
            ? 'club_adv_id'
            : dto.club_type === 'pathfinders'
              ? 'club_pathf_id'
              : 'club_mg_id';

        // 5. Verificar que el club existe
        const club =
          dto.club_type === 'adventurers'
            ? await tx.club_adventurers.findUnique({
                where: { club_adv_id: dto.club_instance_id },
              })
            : dto.club_type === 'pathfinders'
              ? await tx.club_pathfinders.findUnique({
                  where: { club_pathf_id: dto.club_instance_id },
                })
              : await tx.club_master_guilds.findUnique({
                  where: { club_mg_id: dto.club_instance_id },
                });

        if (!club) {
          throw new BadRequestException('Club no encontrado');
        }

        // 6. Validar que la clase exista antes de crear relaciones dependientes
        const selectedClass = await tx.classes.findUnique({
          where: { class_id: dto.class_id },
          select: {
            class_id: true,
            active: true,
          },
        });

        if (!selectedClass || !selectedClass.active) {
          throw new BadRequestException('Clase no encontrada');
        }

        // 7. Reutilizar asignación activa si el paso llega repetido con el mismo club
        const existingClubAssignment = await tx.club_role_assignments.findFirst(
          {
            where: {
              user_id: userId,
              role_id: memberRole.role_id,
              ecclesiastical_year_id: currentYear.year_id,
              active: true,
              [clubInstanceField]: dto.club_instance_id,
            },
          },
        );

        if (!existingClubAssignment) {
          await tx.club_role_assignments.create({
            data: {
              user_id: userId,
              role_id: memberRole.role_id,
              [clubInstanceField]: dto.club_instance_id,
              ecclesiastical_year_id: currentYear.year_id,
              start_date: new Date(),
              active: true,
              status: 'active',
            },
          });
        }

        // 8. Mantener una sola clase actual e idempotencia para reintentos del paso
        await tx.users_classes.updateMany({
          where: {
            user_id: userId,
            current_class: true,
            NOT: { class_id: dto.class_id },
          },
          data: {
            current_class: false,
          },
        });

        const existingUserClass = await tx.users_classes.findUnique({
          where: {
            user_id_class_id: {
              user_id: userId,
              class_id: dto.class_id,
            },
          },
          select: {
            user_class_id: true,
          },
        });

        if (existingUserClass) {
          await tx.users_classes.update({
            where: {
              user_class_id: existingUserClass.user_class_id,
            },
            data: {
              active: true,
              current_class: true,
            },
          });
        } else {
          await tx.users_classes.create({
            data: {
              user_id: userId,
              class_id: dto.class_id,
              current_class: true,
            },
          });
        }

        // 9. Marcar post-registro completo
        await tx.users_pr.update({
          where: { user_id: userId },
          data: {
            club_selection_complete: true,
            complete: true,
            date_completed: new Date(),
          },
        });

        this.logger.log(
          `Step 3 (club selection) completed for user ${userId} - Post-registration COMPLETE`,
        );

        const response = {
          status: 'success',
          message: 'Post-registro completado exitosamente',
          data: {
            clubType: dto.club_type,
            clubId: dto.club_instance_id,
            classId: dto.class_id,
            ecclesiasticalYear: currentYear.year_id,
          },
        };

        if (actor.isOwner) {
          return response;
        }

        return {
          status: 'success',
          message: 'Paso 3 completado',
        };
      });
    } catch (error) {
      throw this.sanitizeAdministrativeValidationError(
        error,
        actor,
        'No se puede completar el paso 3 para este usuario',
      );
    }
  }

  private createOwnerContext(userId: string): PostRegistrationActorContext {
    return {
      actorUserId: userId,
      isOwner: true,
    };
  }

  private sanitizeAdministrativeValidationError(
    error: unknown,
    actor: PostRegistrationActorContext,
    genericMessage: string,
  ): Error {
    if (actor.isOwner || !(error instanceof BadRequestException)) {
      return error as Error;
    }

    return new BadRequestException(genericMessage);
  }
}
