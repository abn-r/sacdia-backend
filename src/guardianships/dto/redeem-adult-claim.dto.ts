import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { IsNewPassword } from '../../auth/password-policy';

const trimAndLowercase = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/** Body of `POST /auth/adult-claim/redeem` (public). */
export class RedeemAdultClaimDto {
  @ApiProperty({
    example: '7KQ4-M9TX',
    description: 'Access code from a former guardian or a club director',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  declare code: string;

  @ApiProperty({ example: 'ana@example.com', maxLength: 255 })
  @Transform(trimAndLowercase)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @IsEmail()
  declare email: string;

  @IsNewPassword({ example: 'Password123!' })
  declare password: string;
}
