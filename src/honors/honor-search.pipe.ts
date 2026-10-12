import { BadRequestException, PipeTransform } from '@nestjs/common';

export const HONOR_SEARCH_MIN = 2;
export const HONOR_SEARCH_MAX = 60;

/**
 * `search` de `GET /honors`: opcional, se recorta y debe medir de 2 a 60
 * caracteres. Vacío o ausente equivale a no filtrar.
 */
export class HonorSearchPipe implements PipeTransform<
  unknown,
  string | undefined
> {
  transform(value: unknown): string | undefined {
    if (value === undefined || value === null) return undefined;
    const text = Array.isArray(value) ? value[0] : value;
    if (typeof text !== 'string') {
      throw new BadRequestException('search must be a string');
    }
    const trimmed = text.trim().replace(/\s+/g, ' ');
    if (trimmed.length === 0) return undefined;
    if (
      trimmed.length < HONOR_SEARCH_MIN ||
      trimmed.length > HONOR_SEARCH_MAX
    ) {
      throw new BadRequestException(
        `search must be between ${HONOR_SEARCH_MIN} and ${HONOR_SEARCH_MAX} characters`,
      );
    }
    return trimmed;
  }
}
