import {
  IsString,
  IsUUID,
  IsBoolean,
  IsOptional,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateEmergencyContactDto {
  @ApiProperty({ example: 'María García López' })
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiProperty({
    example: '11111111-1111-1111-1111-111111111111',
    description: 'UUID del tipo de relación',
  })
  @IsUUID()
  relationship_type_id: string;

  @ApiProperty({ example: '+52 55 1234 5678' })
  @IsString()
  @MaxLength(20)
  phone: string;

  @ApiPropertyOptional({
    example: true,
    description: 'Si es el contacto principal',
  })
  @IsOptional()
  @IsBoolean()
  primary?: boolean;
}
