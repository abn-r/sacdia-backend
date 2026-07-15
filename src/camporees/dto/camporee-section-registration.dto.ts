import { ApiProperty } from '@nestjs/swagger';

export type SectionRegistrationStatus =
  | 'not_enrolled'
  | 'registered'
  | 'pending_approval'
  | 'approved'
  | 'rejected'
  | 'cancelled';

export type SectionRegistrationDisposition =
  | 'not_open_yet'
  | 'open'
  | 'late_approval_required'
  | 'manually_frozen';

export class SectionRegistrationActorDto {
  @ApiProperty({ description: 'ID del usuario que realizó la inscripción' })
  declare userId: string;

  @ApiProperty({ description: 'Nombre visible del usuario' })
  declare displayName: string;
}

export class CamporeeSectionRegistrationDto {
  @ApiProperty({ description: 'ID del camporee', example: 7 })
  declare camporeeId: number;

  @ApiProperty({ description: 'ID del club activo', example: 11 })
  declare clubId: number;

  @ApiProperty({ description: 'Nombre del club activo' })
  declare clubName: string;

  @ApiProperty({ description: 'ID de la sección activa del club', example: 22 })
  declare clubSectionId: number;

  @ApiProperty({ description: 'Nombre de la sección activa' })
  declare sectionName: string;

  @ApiProperty({ description: 'ID del tipo de club', example: 2 })
  declare clubTypeId: number;

  @ApiProperty({ description: 'Nombre del tipo de club' })
  declare clubTypeName: string;

  @ApiProperty({
    description: 'Estado contextual de la inscripción de la sección',
    enum: [
      'not_enrolled',
      'registered',
      'pending_approval',
      'approved',
      'rejected',
      'cancelled',
    ],
  })
  declare status: SectionRegistrationStatus;

  @ApiProperty({
    description: 'Disposición actual de la inscripción de clubes',
    enum: ['not_open_yet', 'open', 'late_approval_required', 'manually_frozen'],
  })
  declare disposition: SectionRegistrationDisposition;

  @ApiProperty({
    description: 'Indica si la sección activa puede inscribirse ahora',
  })
  declare canEnroll: boolean;

  @ApiProperty({
    description: 'Motivo que bloquea la inscripción, cuando aplica',
    nullable: true,
    type: String,
  })
  declare blockingReason: string | null;

  @ApiProperty({
    description: 'ID de la inscripción existente, cuando aplica',
    nullable: true,
    type: Number,
  })
  declare enrollmentId: number | null;

  @ApiProperty({
    description: 'Fecha de registro de la sección',
    nullable: true,
    type: Date,
  })
  declare registeredAt: Date | null;

  @ApiProperty({
    description: 'Usuario que registró la sección',
    nullable: true,
    type: SectionRegistrationActorDto,
  })
  declare registeredBy: SectionRegistrationActorDto | null;
}
