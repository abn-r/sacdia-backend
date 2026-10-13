import { EMAIL_JOB_PASSWORD_RESET } from './email.queue';

/**
 * React, @react-email/render, react-email and the .tsx templates
 * cost ~40 MiB RSS. They must not be loaded when EmailProcessor is imported
 * (application boot) and must be loaded when the first email is composed.
 */
describe('EmailProcessor lazy rendering', () => {
  const renderLoaded = jest.fn();
  const componentsLoaded = jest.fn();
  const originalEmailEnabled = process.env.EMAIL_ENABLED;

  beforeEach(() => {
    jest.resetModules();
    renderLoaded.mockClear();
    componentsLoaded.mockClear();
    process.env.EMAIL_ENABLED = 'true';
    jest.doMock('@react-email/render', () => {
      renderLoaded();
      // The real render() uses a dynamic import() that Jest's VM cannot run.
      return {
        render: jest.fn(
          async (_element: unknown, options?: { plainText?: boolean }) =>
            options?.plainText ? 'rendered-text' : 'rendered-html',
        ),
      };
    });
    jest.doMock('react-email', () => {
      componentsLoaded();
      return jest.requireActual('react-email');
    });
  });

  afterEach(() => {
    jest.dontMock('@react-email/render');
    jest.dontMock('react-email');
    if (originalEmailEnabled === undefined) delete process.env.EMAIL_ENABLED;
    else process.env.EMAIL_ENABLED = originalEmailEnabled;
  });

  function loadProcessor() {
    const { EmailProcessor } = require('./email.processor') as {
      EmailProcessor: new (...args: unknown[]) => any;
    };
    const provider = { send: jest.fn().mockResolvedValue(undefined) };
    const config = { get: jest.fn().mockReturnValue(undefined) };
    const i18n = { translate: jest.fn().mockReturnValue('Asunto') };
    const processor = new EmailProcessor(provider, config, i18n);
    return { processor, provider };
  }

  it('does not load React or React Email when the processor is imported or built', () => {
    loadProcessor();

    expect(renderLoaded).not.toHaveBeenCalled();
    expect(componentsLoaded).not.toHaveBeenCalled();
  });

  it('does not load them when email sending is disabled', async () => {
    process.env.EMAIL_ENABLED = 'false';
    const { processor, provider } = loadProcessor();

    await processor.process({ name: EMAIL_JOB_PASSWORD_RESET, data: {} });

    expect(provider.send).not.toHaveBeenCalled();
    expect(renderLoaded).not.toHaveBeenCalled();
    expect(componentsLoaded).not.toHaveBeenCalled();
  });

  it('loads them on the first rendered email and sends the rendered HTML and text', async () => {
    const { processor, provider } = loadProcessor();

    await processor.process({
      id: '1',
      attemptsMade: 0,
      name: EMAIL_JOB_PASSWORD_RESET,
      data: {
        to: 'user@example.test',
        resetUrl: 'https://x.test/reset',
        lang: 'es',
      },
    });

    expect(renderLoaded).toHaveBeenCalledTimes(1);
    expect(componentsLoaded).toHaveBeenCalledTimes(1);
    expect(provider.send).toHaveBeenCalledTimes(1);
    const sent = provider.send.mock.calls[0][0] as {
      to: string;
      subject: string;
      html: string;
      text: string;
    };
    expect(sent.to).toBe('user@example.test');
    expect(sent.subject).toBe('Asunto');
    expect(sent.html).toBe('rendered-html');
    expect(sent.text).toBe('rendered-text');

    await processor.process({
      id: '2',
      attemptsMade: 0,
      name: EMAIL_JOB_PASSWORD_RESET,
      data: {
        to: 'user@example.test',
        resetUrl: 'https://x.test/reset',
        lang: 'es',
      },
    });
    expect(renderLoaded).toHaveBeenCalledTimes(1);
  });
});
