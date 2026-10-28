import type { Request } from 'express';
import {
  I18nContext,
  I18nValidationExceptionFilter,
  type I18nValidationException,
} from 'nestjs-i18n';
import { shouldExposeI18nValidationDetails } from '../../config/i18n-validation-details';
import {
  buildValidationErrorBody,
  type ValidationErrorNode,
  type ValidationTranslate,
} from './validation-error-body';

/**
 * Global filter for I18nValidationException (thrown by the global
 * I18nValidationPipe). Every class-validator failure, including the
 * `forbidNonWhitelisted` "property X should not exist" case and query DTO
 * failures, is answered with one localized shape:
 *
 *   { status: 'error', statusCode: 400, code: 'VALIDATION_FAILED',
 *     message: string[], errors: [{ field, message }], timestamp, path }
 *
 * Registered with `app.useGlobalFilters` in main.ts: it needs no injected
 * services, it reads I18nService/lang from the nestjs-i18n CLS context.
 */
export function createValidationExceptionFilter(): I18nValidationExceptionFilter {
  return new I18nValidationExceptionFilter({
    // Keep the raw tree; the body formatter flattens and localizes it.
    errorFormatter: (errors) => errors,
    responseBodyFormatter: (
      host,
      exc: I18nValidationException,
      formattedErrors,
    ) => {
      const i18n = I18nContext.current(host) ?? I18nContext.current();
      const translate: ValidationTranslate = (key, args) =>
        i18n
          ? String(
              i18n.service.translate(key, {
                lang: i18n.lang,
                args: args as Record<string, unknown>,
              }),
            )
          : key;
      const request = host.switchToHttp().getRequest<Request>();
      return {
        ...buildValidationErrorBody({
          errors: formattedErrors as ValidationErrorNode[],
          translate,
          path: request?.url ?? '',
          statusCode: exc.getStatus(),
          exposeConstraints: shouldExposeI18nValidationDetails(),
        }),
      };
    },
  });
}
