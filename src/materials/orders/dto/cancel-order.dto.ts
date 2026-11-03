import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import { MaxLengthIfString } from '../../../common/validation/max-length-if-string.decorator';

/**
 * DTO for POST /materials/orders/:folio/cancel
 * REQ-ORD-010, SC-08, SC-09
 */
export class CancelOrderDto {
  @ApiProperty({
    type: String,
    maxLength: 500,
    description: 'Reason for cancellation. Required. Retained for audit.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLengthIfString(500)
  declare cancel_reason: string;
}
