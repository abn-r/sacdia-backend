import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ScanResponseDto } from './scan-qr.dto';

export class QrEmergencyContactDto {
  @ApiProperty()
  name!: string;

  @ApiProperty()
  phone!: string;

  @ApiProperty()
  relationship!: string;
}

export class QrMemberViewDto {
  @ApiProperty()
  user_id!: string;

  @ApiProperty()
  full_name!: string;

  @ApiPropertyOptional({ nullable: true })
  avatar!: string | null;

  @ApiPropertyOptional({ nullable: true })
  club_name!: string | null;

  @ApiPropertyOptional({ nullable: true })
  section_name!: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Most recent active class enrollment name' })
  current_class?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'Blood type string (e.g. "O+", "A-")' })
  blood_type?: string | null;

  @ApiPropertyOptional({ nullable: true, type: QrEmergencyContactDto })
  emergency_contact?: QrEmergencyContactDto | null;
}

export class QrMeResponseDto {
  @ApiProperty()
  token!: string;

  @ApiProperty()
  expires_at!: string;

  @ApiProperty()
  expires_in!: number;

  @ApiProperty({ type: QrMemberViewDto })
  member!: QrMemberViewDto;

  @ApiProperty({
    description: 'Canonical authorization snapshot resolved by backend.',
    type: 'object',
    additionalProperties: true,
  })
  authorization!: unknown;
}

export class QrCardVisualDto {
  @ApiProperty()
  title!: string;

  @ApiProperty()
  subtitle!: string;

  @ApiProperty()
  primary_line!: string;

  @ApiProperty()
  secondary_line!: string;

  @ApiPropertyOptional({ nullable: true })
  club_name!: string | null;

  @ApiPropertyOptional({ nullable: true })
  section_name!: string | null;
}

export class QrCardResponseDto {
  @ApiProperty()
  token!: string;

  @ApiProperty()
  expires_at!: string;

  @ApiProperty()
  expires_in!: number;

  @ApiProperty({ type: QrMemberViewDto })
  member!: QrMemberViewDto;

  @ApiProperty({ type: QrCardVisualDto })
  visual!: QrCardVisualDto;
}

export class QrValidationResponseDto {
  @ApiProperty({ example: true })
  valid!: true;

  @ApiProperty({ type: QrMemberViewDto })
  member!: QrMemberViewDto;

  @ApiPropertyOptional({
    type: 'object',
    nullable: true,
    additionalProperties: true,
  })
  attendance!: ScanResponseDto['attendance'];

  @ApiProperty()
  scanned_at!: string;
}
