import { ApiProperty } from '@nestjs/swagger';

export class DirectorSummaryDto {
  @ApiProperty()
  declare nombre: string;

  @ApiProperty()
  declare club: string;
}

export class OrdenSummaryDto {
  @ApiProperty()
  declare id: string;

  @ApiProperty({ nullable: true })
  declare folio_referencia: string | null;

  @ApiProperty({
    enum: ['en_revision', 'aprobada', 'pagada', 'entregada', 'cancelada'],
  })
  declare estado: string;

  @ApiProperty()
  declare created_at: Date;

  @ApiProperty({ type: DirectorSummaryDto })
  declare director: DirectorSummaryDto;

  @ApiProperty()
  declare subtotal_centavos: number;

  @ApiProperty()
  declare total_centavos: number;
}

export class PaginatedOrdenesDto {
  @ApiProperty({ type: [OrdenSummaryDto] })
  declare data: OrdenSummaryDto[];

  @ApiProperty()
  declare total: number;

  @ApiProperty()
  declare page: number;

  @ApiProperty()
  declare pageSize: number;
}
