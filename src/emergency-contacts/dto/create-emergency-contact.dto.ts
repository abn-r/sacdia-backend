import { IsString, IsUUID, IsBoolean, IsOptional } from 'class-validator';
import { MaxLengthIfString } from '../../common/validation/max-length-if-string.decorator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateEmergencyContactDto {
  @ApiProperty({ example: 'María García López' })
  @IsString()
  @MaxLengthIfString(100)
  declare name: string;

  @ApiProperty({
    example: '11111111-1111-1111-1111-111111111111',
    description: 'UUID del tipo de relación',
  })
  @IsUUID()
  declare relationship_type_id: string;

  @ApiProperty({ example: '+52 55 1234 5678' })
  @IsString()
  @MaxLengthIfString(20)
  declare phone: string;

  @ApiPropertyOptional({
    example: true,
    description: 'Si es el contacto principal',
  })
  @IsOptional()
  @IsBoolean()
  primary?: boolean;
}
