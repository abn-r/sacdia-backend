import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  Min,
  registerDecorator,
  ValidationArguments,
  type ValidationOptions,
} from 'class-validator';

function MutuallyExclusive(
  otherProperty: string,
  validationOptions?: ValidationOptions,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'mutuallyExclusive',
      target: object.constructor,
      propertyName,
      constraints: [otherProperty],
      options: validationOptions,
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          if (value === undefined || value === null) {
            return true;
          }
          const related = (args.object as Record<string, unknown>)[
            args.constraints[0] as string
          ];
          return related === undefined || related === null;
        },
        defaultMessage(args: ValidationArguments) {
          return `${args.property} cannot be combined with ${String(args.constraints[0])}`;
        },
      },
    });
  };
}

export class ListPaymentObligationsQueryDto {
  @ApiPropertyOptional({ description: 'Filtra por camporee local' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @MutuallyExclusive('union_camporee_id')
  camporee_id?: number;

  @ApiPropertyOptional({ description: 'Filtra por camporee de unión' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @MutuallyExclusive('camporee_id')
  union_camporee_id?: number;
}
