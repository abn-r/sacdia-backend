import * as React from 'react';
import { Text, Button, Section } from '@react-email/components';
import { Layout } from './_layout';
import type { SupportedEmailLocale } from '../email.queue';

export interface EmailVerificationProps {
  verificationUrl: string;
  userName?: string;
  lang?: SupportedEmailLocale;
}

interface Labels {
  title: string;
  body: (greeting: string) => string;
  greeting_with_name: (name: string) => string;
  greeting_anonymous: string;
  button: string;
  footer: string;
  preview: string;
}

const LABELS: Record<SupportedEmailLocale, Labels> = {
  es: {
    preview: 'Verificá tu dirección de correo para activar tu cuenta SACDIA.',
    title: 'Verificá tu correo electrónico',
    body: (greeting) =>
      `${greeting}. Para activar tu cuenta SACDIA, hacé clic en el botón de abajo. Este enlace es válido por 24 horas.`,
    greeting_with_name: (name) => `Hola, ${name}`,
    greeting_anonymous: 'Hola',
    button: 'Verificar mi correo',
    footer:
      'Si no creaste una cuenta en SACDIA, ignorá este correo. No se realizará ningún cambio en tu cuenta.',
  },
  en: {
    preview: 'Verify your email address to activate your SACDIA account.',
    title: 'Verify your email address',
    body: (greeting) =>
      `${greeting}. To activate your SACDIA account, click the button below. This link is valid for 24 hours.`,
    greeting_with_name: (name) => `Hello, ${name}`,
    greeting_anonymous: 'Hello',
    button: 'Verify my email',
    footer:
      'If you did not create a SACDIA account, you can safely ignore this email. No changes will be made to your account.',
  },
  fr: {
    preview: 'Vérifiez votre adresse e-mail pour activer votre compte SACDIA.',
    title: 'Vérifiez votre adresse e-mail',
    body: (greeting) =>
      `${greeting}. Pour activer votre compte SACDIA, cliquez sur le bouton ci-dessous. Ce lien est valable pendant 24 heures.`,
    greeting_with_name: (name) => `Bonjour, ${name}`,
    greeting_anonymous: 'Bonjour',
    button: 'Vérifier mon e-mail',
    footer:
      "Si vous n'avez pas créé de compte SACDIA, vous pouvez ignorer cet e-mail en toute sécurité. Aucune modification ne sera apportée à votre compte.",
  },
  'pt-BR': {
    preview: 'Verifique seu endereço de e-mail para ativar sua conta SACDIA.',
    title: 'Verifique seu endereço de e-mail',
    body: (greeting) =>
      `${greeting}. Para ativar sua conta SACDIA, clique no botão abaixo. Este link é válido por 24 horas.`,
    greeting_with_name: (name) => `Olá, ${name}`,
    greeting_anonymous: 'Olá',
    button: 'Verificar meu e-mail',
    footer:
      'Se você não criou uma conta SACDIA, pode ignorar este e-mail com segurança. Nenhuma alteração será feita em sua conta.',
  },
};

/**
 * Sent after registration to verify the user's email address.
 * Token is embedded in verificationUrl — NEVER pass raw token in email templates.
 * Link expires in 24 hours (set at token creation in auth.service.ts).
 */
export function EmailVerificationEmail({
  verificationUrl,
  userName,
  lang = 'es',
}: EmailVerificationProps) {
  const L = LABELS[lang] ?? LABELS['es'];
  const greeting = userName ? L.greeting_with_name(userName) : L.greeting_anonymous;

  return (
    <Layout preview={L.preview} lang={lang}>
      <Text
        style={{
          fontSize: '20px',
          fontWeight: '600',
          color: '#18181b',
          margin: '0 0 8px',
        }}
      >
        {L.title}
      </Text>
      <Text
        style={{
          color: '#52525b',
          fontSize: '15px',
          lineHeight: '24px',
          margin: '0 0 24px',
        }}
      >
        {L.body(greeting)}
      </Text>

      <Section style={{ textAlign: 'center' as const, margin: '0 0 24px' }}>
        <Button
          href={verificationUrl}
          style={{
            backgroundColor: '#16a34a',
            borderRadius: '6px',
            color: '#ffffff',
            fontSize: '15px',
            fontWeight: '600',
            padding: '12px 24px',
            textDecoration: 'none',
            display: 'inline-block',
          }}
        >
          {L.button}
        </Button>
      </Section>

      <Text
        style={{
          color: '#71717a',
          fontSize: '13px',
          lineHeight: '20px',
          margin: '0',
          backgroundColor: '#f4f4f5',
          padding: '12px 16px',
          borderRadius: '6px',
          borderLeft: '3px solid #a1a1aa',
        }}
      >
        {L.footer}
      </Text>
    </Layout>
  );
}

export default EmailVerificationEmail;
