import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { ResendEmailProvider } from './resend.provider';

const mockSend = jest.fn();

jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({
    emails: {
      send: mockSend,
    },
  })),
}));

function createProvider(config: Record<string, string> = {}) {
  const configService = {
    get: jest.fn((key: string) => config[key]),
  } as unknown as ConfigService;

  return new ResendEmailProvider(configService);
}

const payload = {
  to: 'recipient@example.com',
  subject: 'Test subject',
  html: '<p>Test</p>',
  text: 'Test',
};

describe('ResendEmailProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSend.mockResolvedValue({
      data: { id: 'resend-message-id' },
      error: null,
    });
  });

  it('uses the canonical SACDIA sender and configured Reply-To', async () => {
    const provider = createProvider({
      RESEND_API_KEY: 're_test_backend_key',
      RESEND_REPLY_TO: 'contacto@sacdia.com',
    });

    await provider.send(payload);

    expect(Resend).toHaveBeenCalledWith('re_test_backend_key');
    expect(mockSend).toHaveBeenCalledWith({
      from: 'SACDIA <contacto@sacdia.com>',
      to: 'recipient@example.com',
      reply_to: 'contacto@sacdia.com',
      subject: 'Test subject',
      html: '<p>Test</p>',
      text: 'Test',
    });
  });

  it('honors sender and Reply-To overrides from the payload', async () => {
    const provider = createProvider({
      RESEND_FROM_EMAIL: 'SACDIA <contacto@sacdia.com>',
      RESEND_REPLY_TO: 'contacto@sacdia.com',
    });

    await provider.send({
      ...payload,
      from: 'Soporte SACDIA <soporte@sacdia.com>',
      replyTo: 'ayuda@sacdia.com',
    });

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'Soporte SACDIA <soporte@sacdia.com>',
        reply_to: 'ayuda@sacdia.com',
      }),
    );
  });

  it('returns the message id assigned by Resend', async () => {
    const provider = createProvider({
      RESEND_FROM_EMAIL: 'SACDIA <contacto@sacdia.com>',
    });

    await expect(provider.send(payload)).resolves.toEqual({
      messageId: 'resend-message-id',
    });
  });

  it('does not expose API keys or recipient addresses in provider errors', async () => {
    mockSend.mockResolvedValueOnce({
      data: null,
      error: {
        message:
          'request failed for recipient@example.com using re_secret_api_key',
      },
    });
    const provider = createProvider({
      RESEND_API_KEY: 're_secret_api_key',
      RESEND_FROM_EMAIL: 'SACDIA <contacto@sacdia.com>',
    });

    let thrown: Error | undefined;
    try {
      await provider.send(payload);
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown?.message).toContain('Resend send failed');
    expect(thrown?.message).not.toContain('recipient@example.com');
    expect(thrown?.message).not.toContain('re_secret_api_key');
  });

  it('sanitizes errors thrown by the Resend client', async () => {
    mockSend.mockRejectedValueOnce(
      new Error(
        'network failure for recipient@example.com using re_secret_api_key',
      ),
    );
    const provider = createProvider({
      RESEND_API_KEY: 're_secret_api_key',
      RESEND_FROM_EMAIL: 'SACDIA <contacto@sacdia.com>',
    });

    let thrown: Error | undefined;
    try {
      await provider.send(payload);
    } catch (error) {
      thrown = error as Error;
    }

    expect(thrown?.message).toBe('Resend send failed');
    expect(thrown?.message).not.toContain('recipient@example.com');
    expect(thrown?.message).not.toContain('re_secret_api_key');
  });
});
