import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class RejectComprobanteDto {
  /**
   * UUID of the comprobante to reject.
   * Must belong to the order identified by the :folio path param.
   */
  @ApiProperty({
    description: 'UUID of the comprobante to reject',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsUUID()
  declare comprobante_id: string;

  /**
   * Human-readable reason for rejection.
   * Required for audit purposes — reject_reason is kept permanently on the row.
   */
  @ApiProperty({
    description:
      'Reason for rejection (required, stored permanently for audit)',
    example: 'Amount does not match the order total',
    maxLength: 500,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  declare reject_reason: string;
}
