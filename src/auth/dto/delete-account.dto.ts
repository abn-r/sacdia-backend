import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsNotEmpty,
  IsString,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { SOCIAL_PROVIDERS } from '../social-sign-in/social-sign-in.types';

/**
 * Re-authentication before the destructive action: either the current
 * password, or a fresh id token from a provider linked to the account
 * (users who signed up with Google/Apple have no password).
 */
export class DeleteAccountDto {
  @ApiPropertyOptional({
    description:
      'Contraseña actual. Requerida cuando no se envía provider/idToken.',
    example: 'MyPassword123!',
  })
  @ValidateIf((o: DeleteAccountDto) => !o.provider)
  @IsString()
  @IsNotEmpty({
    message: 'La contraseña es requerida para confirmar la eliminación',
  })
  password?: string;

  @ApiPropertyOptional({ enum: [...SOCIAL_PROVIDERS] })
  @ValidateIf((o: DeleteAccountDto) => !o.password)
  @IsIn([...SOCIAL_PROVIDERS])
  provider?: (typeof SOCIAL_PROVIDERS)[number];

  @ApiPropertyOptional({
    description: 'Id token recién emitido por el proveedor',
  })
  @ValidateIf((o: DeleteAccountDto) => !o.password)
  @IsString()
  @IsNotEmpty()
  @MaxLength(4096)
  idToken?: string;

  @ApiPropertyOptional({
    description: 'Nonce en claro usado para ese id token',
  })
  @ValidateIf((o: DeleteAccountDto) => !o.password)
  @IsString()
  @IsNotEmpty()
  @MaxLength(256)
  nonce?: string;
}
