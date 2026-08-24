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
