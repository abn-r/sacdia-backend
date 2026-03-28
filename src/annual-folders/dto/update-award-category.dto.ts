import { PartialType } from '@nestjs/swagger';
import { CreateAwardCategoryDto } from './create-award-category.dto';

export class UpdateAwardCategoryDto extends PartialType(
  CreateAwardCategoryDto,
) {}
