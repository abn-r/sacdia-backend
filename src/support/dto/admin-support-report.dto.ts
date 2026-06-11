import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SupportCategory } from './create-support-report.dto';
import { SupportReportStatus } from './query-support-reports.dto';

export class AdminSupportReportUserDto {
  @ApiProperty({ example: '104a2549-2056-4b9b-aaeb-51d8fd43191d' })
  userId!: string;

  @ApiProperty({ example: 'abner@example.com' })
  email!: string;

  @ApiPropertyOptional({ example: 'Abner Reyes Ramírez' })
  name!: string | null;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/avatar.png' })
  imageUrl!: string | null;
}

export class AdminSupportReportDto {
  @ApiProperty({ example: 'a3f1c2d4-5e6f-7a8b-9c0d-1e2f3a4b5c6d' })
  id!: string;

  @ApiProperty({ enum: SupportCategory })
  category!: string;

  @ApiProperty({ example: 'No puedo iniciar sesión con Google' })
  title!: string;

  @ApiProperty({ example: 'La app se queda cargando después de tocar Google.' })
  description!: string;

  @ApiProperty({ enum: SupportReportStatus })
  status!: string;

  @ApiProperty({ type: AdminSupportReportUserDto })
  user!: AdminSupportReportUserDto;

  @ApiProperty({ type: 'object', additionalProperties: true })
  deviceInfo!: unknown;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  userContext!: unknown;

  @ApiProperty({ example: '2026-04-23T18:30:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-04-23T18:30:00.000Z' })
  updatedAt!: string;
}

export class AdminSupportReportsPageDto {
  @ApiProperty({ example: 15 })
  total!: number;

  @ApiProperty({ example: 1 })
  page!: number;

  @ApiProperty({ example: 20 })
  limit!: number;

  @ApiProperty({ type: [AdminSupportReportDto] })
  items!: AdminSupportReportDto[];
}
