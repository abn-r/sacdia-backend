import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsString,
  MaxLength,
  Validate,
  ValidateIf,
  ValidationArguments,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import { SOCIAL_PROVIDERS } from '../social-sign-in/social-sign-in.types';

/** A body must carry exactly one re-auth branch, never both. */
@ValidatorConstraint({ name: 'singleReauthBranch', async: false })
class SingleReauthBranchConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const o = args.object as DeleteAccountDto;
    return (
      o.password === undefined ||
      (o.provider === undefined &&
        o.idToken === undefined &&
        o.nonce === undefined)
    );
  }

  defaultMessage(): string {
    return 'Envía la contraseña o provider/idToken/nonce, no ambos';
  }
}

/**
 * Re-authentication before the destructive action: either the current
 * password, or a fresh id token from a provider linked to the account
 * (users who signed up with Google/Apple have no password).
 *
 * Exactly one branch is accepted. The password branch is validated whenever
 * `password` is present (or when no provider is given); the social branch
 * whenever `provider` is present or `password` is absent.
 */
export class DeleteAccountDto {
  @ApiPropertyOptional({
    description:
      'Contraseña actual. Requerida cuando no se envía provider/idToken.',
    example: 'MyPassword123!',
  })
  @ValidateIf((o: DeleteAccountDto) => o.password !== undefined || !o.provider)
  @IsString()
  @IsNotEmpty({
    message: 'La contraseña es requerida para confirmar la eliminación',
  })
  @Validate(SingleReauthBranchConstraint)
  password?: string;

  @ApiPropertyOptional({ enum: [...SOCIAL_PROVIDERS] })
  @ValidateIf(
    (o: DeleteAccountDto) =>
      o.provider !== undefined || o.password === undefined,
  )
  @IsIn([...SOCIAL_PROVIDERS])
  provider?: (typeof SOCIAL_PROVIDERS)[number];

  @ApiPropertyOptional({
    description: 'Id token recién emitido por el proveedor',
  })
  @ValidateIf(
    (o: DeleteAccountDto) =>
      o.provider !== undefined || o.password === undefined,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  idToken?: string;

  @ApiPropertyOptional({
    description: 'Nonce en claro usado para ese id token',
  })
  @ValidateIf(
    (o: DeleteAccountDto) =>
      o.provider !== undefined || o.password === undefined,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  nonce?: string;
}
