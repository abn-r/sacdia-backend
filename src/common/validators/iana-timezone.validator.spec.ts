import { classifyLocalFieldTimezone } from './iana-timezone.validator';

describe('classifyLocalFieldTimezone', () => {
  it.each([
    ['America/Argentina/Buenos_Aires', true, undefined],
    ['', false, 'MISSING'],
    ['-06:00', false, 'DISALLOWED_NAMESPACE'],
    ['CST', false, 'DISALLOWED_NAMESPACE'],
    ['America/Not_A_Zone', false, 'UNKNOWN'],
  ])('classifies %s deterministically', (value, ok, reason) => {
    const result = classifyLocalFieldTimezone(value);

    expect(result.ok).toBe(ok);
    if (!result.ok) expect(result.reason).toBe(reason);
  });
});
