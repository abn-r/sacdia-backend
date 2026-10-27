import * as React from 'react';
import { Layout } from './_layout';
import {
  EmailButton,
  EmailHeading,
  EmailLinkFallback,
  EmailNote,
  EmailText,
} from './_ui';
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
  link_fallback: string;
  footer: string;
  preview: string;
}

const LABELS: Record<SupportedEmailLocale, Labels> = {
  es: {
    preview: 'Verifica tu dirección de correo para activar tu cuenta SACDIA.',
    title: 'Verifica tu correo electrónico',
    body: (greeting) =>
      `${greeting}. Para activar tu cuenta SACDIA, haz clic en el botón de abajo. Este enlace es válido por 24 horas.`,
    greeting_with_name: (name) => `Hola, ${name}`,
    greeting_anonymous: 'Hola',
    button: 'Verificar mi correo',
    link_fallback:
      '¿El botón no funciona? Copia y pega este enlace en tu navegador:',
    footer:
      'Si no creaste una cuenta en SACDIA, ignora este correo. No se realizará ningún cambio en tu cuenta.',
  },
  en: {
    preview: 'Verify your email address to activate your SACDIA account.',
    title: 'Verify your email address',
    body: (greeting) =>
      `${greeting}. To activate your SACDIA account, click the button below. This link is valid for 24 hours.`,
    greeting_with_name: (name) => `Hello, ${name}`,
    greeting_anonymous: 'Hello',
    button: 'Verify my email',
    link_fallback:
      'Button not working? Copy and paste this link into your browser:',
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
    link_fallback:
      'Le bouton ne fonctionne pas ? Copiez et collez ce lien dans votre navigateur :',
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
    link_fallback:
      'O botão não funciona? Copie e cole este link no seu navegador:',
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
  const greeting = userName
    ? L.greeting_with_name(userName)
    : L.greeting_anonymous;

  return (
    <Layout preview={L.preview} lang={lang}>
      <EmailHeading>{L.title}</EmailHeading>
      <EmailText last>{L.body(greeting)}</EmailText>
      <EmailButton href={verificationUrl}>{L.button}</EmailButton>
      <EmailLinkFallback label={L.link_fallback} href={verificationUrl} />
      <EmailNote>{L.footer}</EmailNote>
    </Layout>
  );
}

export default EmailVerificationEmail;
