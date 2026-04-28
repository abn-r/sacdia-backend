import { ApiProperty } from '@nestjs/swagger';

/**
 * Respuesta del endpoint `POST /support/reports`.
 * La app móvil usa `reportId` para mostrar confirmación al usuario.
 */
export class SupportReportResponseDto {
  @ApiProperty({
    description: 'UUID del reporte recién creado',
    example: 'a3f1c2d4-5e6f-7a8b-9c0d-1e2f3a4b5c6d',
  })
  reportId!: string;

  @ApiProperty({
    description: 'Timestamp ISO-8601 UTC de creación',
    example: '2026-04-23T18:30:00.000Z',
  })
  createdAt!: string;
}
