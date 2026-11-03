import {
  ValidationOptions,
  buildMessage,
  maxLength as isMaxLength,
  ValidateBy,
} from 'class-validator';

/**
 * `@MaxLength` that only judges strings. Stock `@MaxLength` also fails for a
 * missing or non-string value, so next to `@IsString()` the client got a second
 * "cannot exceed N characters" error for a field that is simply absent or has
 * the wrong type. Here the type error (`isString`) is the only one reported.
 *
 * It keeps the `maxLength` constraint name, so it reuses the same localized
 * message and `{max}` argument as `@MaxLength`.
 */
export function MaxLengthIfString(
  max: number,
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: 'maxLength',
      constraints: [max],
      validator: {
        validate: (value: unknown, args) =>
          typeof value !== 'string' ||
          isMaxLength(value, args?.constraints[0] as number),
        defaultMessage: buildMessage(
          (eachPrefix) =>
            `${eachPrefix}$property must be shorter than or equal to $constraint1 characters`,
          validationOptions,
        ),
      },
    },
    validationOptions,
  );
}
