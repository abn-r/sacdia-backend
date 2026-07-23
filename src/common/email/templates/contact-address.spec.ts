import * as React from 'react';
import type { SupportedEmailLocale } from '../email.queue';
import { AccountDeletionConfirmedEmail } from './account-deletion-confirmed';
import { PasswordResetEmail } from './password-reset';

const locales: SupportedEmailLocale[] = ['es', 'en', 'fr', 'pt-BR'];

function extractText(node: React.ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(extractText).join(' ');
  }
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) {
    return extractText(node.props.children);
  }
  return '';
}

describe('email template contact address', () => {
  it.each(locales)(
    'uses contacto@sacdia.com in password reset copy for %s',
    (lang) => {
      const text = extractText(
        PasswordResetEmail({
          resetUrl: 'https://example.com/reset',
          lang,
        }),
      );

      expect(text).toContain('contacto@sacdia.com');
      expect(text).not.toContain('hola@sacdia.app');
    },
  );

  it.each(locales)(
    'uses contacto@sacdia.com in account deletion copy for %s',
    (lang) => {
      const text = extractText(AccountDeletionConfirmedEmail({ lang }));

      expect(text).toContain('contacto@sacdia.com');
      expect(text).not.toContain('hola@sacdia.app');
    },
  );
});
