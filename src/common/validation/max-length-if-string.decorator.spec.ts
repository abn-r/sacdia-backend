import { plainToInstance } from 'class-transformer';
import { IsOptional, IsString, validate } from 'class-validator';
import { MaxLengthIfString } from './max-length-if-string.decorator';

class Sample {
  @IsString()
  @MaxLengthIfString(5)
  required!: string;

  @IsOptional()
  @IsString()
  @MaxLengthIfString(5)
  optional?: string;
}

const constraintsOf = async (plain: object) =>
  (await validate(plainToInstance(Sample, plain))).map((e) => ({
    property: e.property,
    constraints: Object.keys(e.constraints ?? {}).sort(),
    messages: Object.values(e.constraints ?? {}),
  }));

describe('MaxLengthIfString', () => {
  it('reports only isString when the value is missing', async () => {
    expect(await constraintsOf({})).toEqual([
      expect.objectContaining({
        property: 'required',
        constraints: ['isString'],
      }),
    ]);
  });

  it('reports only isString when the value is not a string', async () => {
    const errors = await constraintsOf({ required: 'ok', optional: 123 });
    expect(errors).toEqual([
      expect.objectContaining({
        property: 'optional',
        constraints: ['isString'],
      }),
    ]);
  });

  it('reports maxLength for a string that is too long', async () => {
    const errors = await constraintsOf({ required: 'abcdef' });
    expect(errors).toEqual([
      expect.objectContaining({
        property: 'required',
        constraints: ['maxLength'],
        messages: ['required must be shorter than or equal to 5 characters'],
      }),
    ]);
  });

  it('accepts a string within the limit', async () => {
    expect(await constraintsOf({ required: 'abcde' })).toEqual([]);
  });
});
