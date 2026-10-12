import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import {
  InstructorNameField,
  InstructorUserIdField,
} from '../../instructors/instructor-fields';

export const PROPOSAL_REASON_MIN = 3;
export const PROPOSAL_REASON_MAX = 500;

/** Estados que la cola del admin puede filtrar (WITHDRAWN no le interesa al revisor). */
export enum HonorInstructorProposalQueueStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

/**
 * Exactamente uno de los dos (`HONOR_INSTRUCTOR_REQUIRED` si faltan,
 * `HONOR_INSTRUCTOR_AMBIGUOUS` si llegan ambos: lo decide el servicio). En una
 * propuesta `null` equivale a omitido.
 */
export class ProposeHonorInstructorDto {
  @InstructorUserIdField()
  instructorUserId?: string | null;

  @InstructorNameField()
  instructorName?: string | null;
}

export class RejectHonorInstructorProposalDto {
  @ApiProperty({
    description: 'Motivo visible para el miembro',
    minLength: PROPOSAL_REASON_MIN,
    maxLength: PROPOSAL_REASON_MAX,
    example: 'La persona propuesta no firmó el certificado.',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(PROPOSAL_REASON_MIN)
  @MaxLength(PROPOSAL_REASON_MAX)
  declare reason: string;
}

export class ListHonorInstructorProposalsDto extends PaginationDto {
  @ApiPropertyOptional({
    enum: HonorInstructorProposalQueueStatus,
    default: HonorInstructorProposalQueueStatus.PENDING,
  })
  @IsOptional()
  @IsEnum(HonorInstructorProposalQueueStatus)
  status?: HonorInstructorProposalQueueStatus;
}
