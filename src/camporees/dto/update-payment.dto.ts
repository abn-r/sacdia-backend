import { PartialType } from '@nestjs/swagger';
import { CreatePaymentDto } from './create-payment.dto';

/**
 * DTO for updating an existing camporee payment
 * All fields are optional - inherits from CreatePaymentDto
 */
export class UpdatePaymentDto extends PartialType(CreatePaymentDto) {}
