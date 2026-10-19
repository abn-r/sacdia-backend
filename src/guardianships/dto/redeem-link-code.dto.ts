import { ApiProperty } from '@nestjs/swagger';
import {
  Equals,
  IsBoolean,
  IsNotEmpty,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

export class RedeemLinkCodeDto {
  @ApiProperty({
    example: '7KQ4-M9TX',
    description: 'Any case, dashes optional',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  declare code: string;

  @ApiProperty({
    description:
      'relationship_types.relationship_type_id. Must be one of GET /guardianships/relationship-types, otherwise 400 GUARDIANSHIP_RELATIONSHIP_TYPE_NOT_ALLOWED',
  })
  @IsUUID()
  declare relationship_type_id: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  @Equals(true, { message: 'sworn_declaration must be true' })
  declare sworn_declaration: boolean;
}
