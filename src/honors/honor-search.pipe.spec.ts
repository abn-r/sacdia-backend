import { BadRequestException } from '@nestjs/common';
import { HonorSearchPipe } from './honor-search.pipe';

describe('HonorSearchPipe', () => {
  const pipe = new HonorSearchPipe();

  it.each([undefined, null, '', '   '])('treats %j as no filter', (value) => {
    expect(pipe.transform(value)).toBeUndefined();
  });

  it('trims and collapses whitespace', () => {
    expect(pipe.transform('  primeros   auxilios ')).toBe('primeros auxilios');
  });

  it('accepts the 2 and 60 character boundaries', () => {
    expect(pipe.transform('ab')).toBe('ab');
    expect(pipe.transform('a'.repeat(60))).toHaveLength(60);
  });

  it('rejects 1 and 61 characters with 400', () => {
    expect(() => pipe.transform('a')).toThrow(BadRequestException);
    expect(() => pipe.transform(' a ')).toThrow(BadRequestException);
    expect(() => pipe.transform('a'.repeat(61))).toThrow(BadRequestException);
  });

  it('takes the first value of a repeated parameter and rejects non strings', () => {
    expect(pipe.transform(['nudos', 'otro'])).toBe('nudos');
    expect(() => pipe.transform({ a: 1 })).toThrow(BadRequestException);
  });
});
