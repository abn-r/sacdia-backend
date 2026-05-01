import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MemberRankingResponseDto } from './member-ranking-response.dto';

export class ClassBreakdownDto {
  @ApiProperty({ description: 'Number of class sections completed' })
  completed_sections!: number;

  @ApiProperty({ description: 'Total required sections for the class' })
  required_sections!: number;

  @ApiPropertyOptional({
    description: 'Submission status of the annual folder',
    nullable: true,
  })
  folder_status!: string | null;
}

export class InvestitureBreakdownDto {
  @ApiPropertyOptional({
    description: 'Investiture status for this enrollment',
    nullable: true,
  })
  status!: string | null;
}

export class CamporeeBreakdownDto {
  @ApiProperty({
    description: 'Whether the member participated in a camporee this year',
  })
  participated!: boolean;

  @ApiPropertyOptional({
    description: 'Number of camporees linked to the member club this year',
    nullable: true,
  })
  total_camporees!: number | null;
}

export class WeightsBreakdownDto {
  @ApiProperty()
  class_pct!: number;

  @ApiProperty()
  investiture_pct!: number;

  @ApiProperty()
  camporee_pct!: number;

  @ApiProperty()
  source!: string;
}

export class MemberBreakdownDto extends MemberRankingResponseDto {
  @ApiProperty({ type: ClassBreakdownDto })
  class_breakdown!: ClassBreakdownDto;

  @ApiProperty({ type: InvestitureBreakdownDto })
  investiture_breakdown!: InvestitureBreakdownDto;

  @ApiProperty({ type: CamporeeBreakdownDto })
  camporee_breakdown!: CamporeeBreakdownDto;

  @ApiProperty({ type: WeightsBreakdownDto })
  weights!: WeightsBreakdownDto;
}
