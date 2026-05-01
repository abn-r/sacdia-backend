import { IsObject, IsString, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class EmitEventDto {
  @ApiProperty({ description: 'UUID del usuario al que pertenece el evento' })
  @IsUUID()
  userId: string;

  @ApiProperty({
    description: 'Tipo de evento (e.g. honor.completed, activity.attended)',
  })
  @IsString()
  eventType: string;

  @ApiProperty({
    description: 'Payload del evento con datos específicos del tipo',
    type: Object,
  })
  @IsObject()
  payload: Record<string, unknown>;
}
