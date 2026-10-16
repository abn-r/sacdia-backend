import type { ValidationPipeOptions } from '@nestjs/common';

/**
 * Options for the global I18nValidationPipe. `validationError` keeps the
 * rejected request body (`target`) and field values (`value`) out of the
 * ValidationError tree, so a 400 never echoes input such as passwords, even
 * when detailed errors are exposed.
 */
export const GLOBAL_VALIDATION_PIPE_OPTIONS: ValidationPipeOptions = {
  whitelist: true,
  transform: true,
  forbidNonWhitelisted: true,
  validationError: { target: false, value: false },
};

/**
 * nestjs-i18n defaults detailedErrors to true and echoes the class-validator
 * tree (property names, constraint keys, nested DTO shape). That is useful
 * in local/test; production 400s should flatten to translated strings.
 */
export function shouldExposeI18nValidationDetails(
  nodeEnv: string | undefined = process.env.NODE_ENV,
): boolean {
  return nodeEnv !== 'production';
}
