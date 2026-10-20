import {
  IsString,
  Length,
  Validate,
  ValidatorConstraint,
  isEmail,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

/** Shape of a server-generated login handle (any letter case on input). */
const HANDLE_SHAPE = /^[a-z0-9][a-z0-9-]{5,39}$/i;

/**
 * An email, or something shaped like a login handle. A handle account has no
 * email, so a reset request that names one gets the same neutral answer as any
 * unknown email and queues nothing: the validation must not turn it into a 400
 * (which would reveal "this is not an email").
 */
@ValidatorConstraint({ name: 'emailOrHandleShape', async: false })
class EmailOrHandleShape implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    return value.includes('@') ? isEmail(value) : HANDLE_SHAPE.test(value);
  }

  defaultMessage(): string {
    return 'email must be an email';
  }
}

export class ResetPasswordRequestDto {
  @ApiProperty({
    example: 'juan.garcia@example.com',
    description:
      'Correo para recuperación. Un usuario (handle) recibe la misma respuesta neutra y no se envía ningún correo: su tutor restablece la contraseña.',
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @Length(3, 254)
  @Validate(EmailOrHandleShape)
  declare email: string;
}
