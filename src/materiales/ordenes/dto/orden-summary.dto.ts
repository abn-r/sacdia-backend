import { ApiProperty } from '@nestjs/swagger';

export class DirectorSummaryDto {
  @ApiProperty()
  nombre: string;

  @ApiProperty()
  club: string;
}

export class OrdenSummaryDto {
  @ApiProperty()
  id: string;

  @ApiProperty({ nullable: true })
  folio_referencia: string | null;

  @ApiProperty({
    enum: ['en_revision', 'aprobada', 'pagada', 'entregada', 'cancelada'],
  })
  estado: string;

  @ApiProperty()
  created_at: Date;

  @ApiProperty({ type: DirectorSummaryDto })
  director: DirectorSummaryDto;

  @ApiProperty()
  subtotal_centavos: number;

  @ApiProperty()
  total_centavos: number;
}

export class PaginatedOrdenesDto {
  @ApiProperty({ type: [OrdenSummaryDto] })
  data: OrdenSummaryDto[];

  @ApiProperty()
  total: number;

  @ApiProperty()
  page: number;

  @ApiProperty()
  pageSize: number;
}
