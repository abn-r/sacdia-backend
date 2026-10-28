import {
  buildValidationErrorBody,
  isDefaultValidationMessage,
} from './validation-error-body';

const translate = (key: string, args?: Record<string, unknown>) =>
  `T(${key.replace('errors.VALIDATION.constraint.', '')}:${JSON.stringify(args)})`;

describe('isDefaultValidationMessage', () => {
  it('detects class-validator stock messages', () => {
    expect(
      isDefaultValidationMessage('name', 'isString', 'name must be a string'),
    ).toBe(true);
    expect(
      isDefaultValidationMessage(
        'tags',
        'isString',
        'each value in tags must be a string',
      ),
    ).toBe(true);
    expect(
      isDefaultValidationMessage(
        'x',
        'whitelistValidation',
        'property x should not exist',
      ),
    ).toBe(true);
  });

  it('keeps DTO-authored messages, even when they start with the property', () => {
    expect(
      isDefaultValidationMessage('email', 'isEmail', 'email inválido'),
    ).toBe(false);
    expect(
      isDefaultValidationMessage('x', 'isString', 'El motivo es obligatorio'),
    ).toBe(false);
  });
});

describe('buildValidationErrorBody', () => {
  it('flattens nested errors with dotted paths and hides constraints by default', () => {
    const body = buildValidationErrorBody({
      errors: [
        {
          property: 'items',
          children: [
            {
              property: '0',
              children: [
                {
                  property: 'qty',
                  constraints: { min: 'qty must not be less than 1' },
                },
              ],
            },
          ],
        },
        { property: 'note', constraints: { isString: 'La nota es inválida' } },
      ],
      translate,
      path: '/x',
    });

    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.errors).toEqual([
      { field: 'items.0.qty', message: expect.stringContaining('T(min:') },
      { field: 'note', message: 'La nota es inválida' },
    ]);
    expect(body.errors[0].message).toContain('"min":"1"');
    expect(body.message).toHaveLength(2);
    expect(JSON.stringify(body)).not.toContain('constraint"');
  });

  it('adds constraint names only when asked, and falls back to the generic message', () => {
    const body = buildValidationErrorBody({
      errors: [
        { property: 'f', constraints: { isLatitude: 'f must be a latitude' } },
      ],
      translate,
      path: '/x',
      exposeConstraints: true,
    });
    expect(body.errors[0]).toEqual({
      field: 'f',
      message: expect.stringContaining('T(invalid:'),
      constraint: 'isLatitude',
    });
  });

  it('keeps the raw message when no translation exists', () => {
    const body = buildValidationErrorBody({
      errors: [
        { property: 'f', constraints: { isString: 'f must be a string' } },
      ],
      translate: (key) => key,
      path: '/x',
    });
    expect(body.errors[0].message).toBe('f must be a string');
  });
});
