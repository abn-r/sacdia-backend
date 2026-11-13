import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

const trimAndLowercase = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/** Body of `POST /users/me/release/email` (a released adult adds their email). */
export class SetReleaseEmailDto {
  @ApiProperty({ example: 'ana@example.com', maxLength: 255 })
  @Transform(trimAndLowercase)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @IsEmail()
  declare email: string;
}
