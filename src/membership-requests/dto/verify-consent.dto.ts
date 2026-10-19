import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

export class VerifyConsentDto {
  @ApiProperty({
    description:
      'The director confirms having reviewed the signed paper form. false is rejected.',
    example: true,
  })
  @IsBoolean()
  confirm_paper_form_reviewed!: boolean;

  @ApiPropertyOptional({
    description:
      'Also approve the membership request once the consent is verified. Defaults to false.',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  approve?: boolean;
}
