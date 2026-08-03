const API_MODEL_PROPERTIES = 'swagger/apiModelProperties';
import { CreateLocalFieldDto } from './geography.dto';

describe('CreateLocalFieldDto', () => {
  it('documents timezone as optional only when active is false', () => {
    const metadata = Reflect.getMetadata(
      API_MODEL_PROPERTIES,
      CreateLocalFieldDto.prototype,
      'timezone',
    );

    expect(metadata).toMatchObject({
      required: false,
      description:
        'IANA timezone. Required when active is omitted or true; may be omitted only when active is false.',
    });
  });
});
