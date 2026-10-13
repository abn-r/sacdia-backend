import type { FileStorageService } from '../../common/services/file-storage.service';

/**
 * @google-cloud/vision (+ gRPC) costs ~17 MiB RSS. It must not be loaded when
 * the OCR modules are imported, nor in OCR_MODE=remote, only when the direct
 * provider actually builds its client for the first OCR call.
 */
describe('Google Vision lazy loading', () => {
  const visionLoaded = jest.fn();
  const ImageAnnotatorClient = jest.fn();

  beforeEach(() => {
    jest.resetModules();
    visionLoaded.mockClear();
    ImageAnnotatorClient.mockClear();
    jest.doMock('@google-cloud/vision', () => {
      visionLoaded();
      return { ImageAnnotatorClient };
    });
  });

  afterEach(() => {
    jest.dontMock('@google-cloud/vision');
  });

  const storage = {} as FileStorageService;

  function loadModules() {
    const mode =
      require('./certificate-ocr-mode') as typeof import('./certificate-ocr-mode');
    const vision =
      require('./google-vision-certificate-ocr.provider') as typeof import('./google-vision-certificate-ocr.provider');
    return { mode, vision };
  }

  it('does not load the SDK when the OCR modules are imported', () => {
    loadModules();

    expect(visionLoaded).not.toHaveBeenCalled();
  });

  it('never loads the SDK in OCR_MODE=remote', () => {
    const { mode, vision } = loadModules();
    const values: Record<string, unknown> = {
      OCR_MODE: 'remote',
      OCR_PROXY_URL: 'https://ocr.example.test',
      OCR_PROXY_ENV: 'prod',
      OCR_PROXY_KID: 'k1',
      OCR_PROXY_SECRET: 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
    };

    const provider = mode.selectCertificateOcrProvider({
      config: { get: (key: string) => values[key] },
      storage,
      visionClientFactory: vision.googleVisionClientFactoryProvider.useValue,
    });

    expect(provider.constructor.name).toBe('CloudRunCertificateOcrProvider');
    expect(visionLoaded).not.toHaveBeenCalled();
  });

  it('does not load the SDK when the direct provider is only constructed', () => {
    const { mode, vision } = loadModules();

    const provider = mode.selectCertificateOcrProvider({
      config: { get: (key: string) => (key === 'OCR_MODE' ? 'direct' : null) },
      storage,
      visionClientFactory: vision.googleVisionClientFactoryProvider.useValue,
    });

    expect(provider).toBeInstanceOf(vision.GoogleVisionCertificateOcrProvider);
    expect(visionLoaded).not.toHaveBeenCalled();
  });

  it('loads the SDK on the first client creation and reuses it afterwards', () => {
    const { vision } = loadModules();
    const factory = vision.googleVisionClientFactoryProvider.useValue;

    factory({ fallback: false });
    factory({ fallback: false });

    expect(visionLoaded).toHaveBeenCalledTimes(1);
    expect(ImageAnnotatorClient).toHaveBeenCalledTimes(2);
    expect(ImageAnnotatorClient).toHaveBeenCalledWith({ fallback: false });
  });
});
