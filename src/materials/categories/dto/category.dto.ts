import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Admin response shape. Differs slightly from the public catalog DTO in that
 * it includes `active` (catalog only returns active) and `product_count` to
 * surface usage when deciding whether to deactivate a category.
 */
export class CategoryAdminDto {
  @ApiProperty() declare id: string;
  @ApiProperty() declare local_field_id: number;
  @ApiProperty() declare slug: string;
  @ApiProperty() declare label: string;
  @ApiPropertyOptional({ nullable: true })
  icon?: string | null;
  @ApiProperty() declare sort_order: number;
  @ApiProperty() declare active: boolean;
  @ApiProperty({
    description: 'Number of products currently using this category',
  })
  declare product_count: number;
  @ApiProperty() declare created_at: Date;
  @ApiProperty() declare updated_at: Date;
}
