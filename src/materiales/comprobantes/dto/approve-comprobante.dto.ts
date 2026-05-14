import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

export class ApproveComprobanteDto {
  /**
   * UUID of the comprobante to approve.
   * Must belong to the order identified by the :folio path param.
   */
  @ApiProperty({
    description: 'UUID of the comprobante to approve',
    example: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
  })
  @IsUUID()
  comprobante_id: string;
}
