import {
  canonicalJson,
  canonicalSha256,
  type ReadinessManifestV1,
  ReadinessContractError,
  snapshotArtifact,
} from './readiness-artifact';

const code = (action: () => unknown) => {
  try {
    action();
  } catch (error) {
    return (error as ReadinessContractError).code;
  }
  return undefined;
};

describe('pilot readiness canonical artifacts', () => {
  it('allows a release version without requiring deployedAt', () => {
    const release: ReadinessManifestV1['release'] = {
      commit: 'abcdef0',
      version: '2026.08.03',
    };
    expect(release).toEqual({ commit: 'abcdef0', version: '2026.08.03' });
  });

  it('snapshots a plain artifact before canonicalizing it', () => {
    const source = { z: 1, a: { values: ['x', true] } };
    const snapshot = snapshotArtifact(source);
    source.a.values[0] = 'changed';
    expect(canonicalJson(snapshot)).toBe('{"a":{"values":["x",true]},"z":1}');
  });

  it('is injective for accepted plain artifacts', () => {
    expect(canonicalSha256({ a: 1, b: [true, 'x'] })).not.toBe(
      canonicalSha256({ a: 1, b: ['true', 'x'] }),
    );
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    expect(canonicalJson('😀')).toBe('"😀"');
  });

  it.each([
    ['sparse array', () => canonicalJson(new Array(1))],
    [
      'array expando',
      () => {
        const value = [1];
        Object.assign(value, { extra: 1 });
        return canonicalJson(value);
      },
    ],
    [
      'modified array prototype',
      () => {
        const value = [1];
        Object.setPrototypeOf(value, {});
        return canonicalJson(value);
      },
    ],
    [
      'accessor',
      () => {
        const value = {};
        Object.defineProperty(value, 'x', { get: () => 1, enumerable: true });
        return canonicalJson(value);
      },
    ],
    [
      'non-enumerable property',
      () => {
        const value = {};
        Object.defineProperty(value, 'x', { value: 1 });
        return canonicalJson(value);
      },
    ],
    ['lone surrogate', () => canonicalJson('\ud800')],
    ['nonfinite number', () => canonicalJson(Number.NaN)],
    ['negative zero', () => canonicalJson(-0)],
  ])('rejects %s', (_name, action) => {
    expect(code(action)).toBe('READINESS_ARTIFACT_UNSAFE');
  });
});
