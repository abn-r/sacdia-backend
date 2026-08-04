import { CreateLocalFieldDto } from './geography.dto';

describe('CreateLocalFieldDto', () => {
  it('keeps timezone as a runtime-only optional field without OpenAPI optional metadata', () => {
    const metadata = Reflect.getMetadata(
      'swagger/apiModelProperties',
      CreateLocalFieldDto.prototype,
      'timezone',
    );

    // OpenAPI consumers must use the controller oneOf models, not this DTO.
    expect(metadata).toBeUndefined();
  });
});
