import * as React from 'react';
import { Text, Button, Section } from '@react-email/components';
import { Layout } from './_layout';
import type { SupportedEmailLocale } from '../email.queue';

export interface PasswordResetEmailProps {
  resetUrl: string;
  lang?: SupportedEmailLocale;
}

interface Labels {
  preview: string;
  title: string;
  body: string;
  button: string;
  footer: string;
}

const LABELS: Record<SupportedEmailLocale, Labels> = {
  es: {
    preview: 'Recibiste una solicitud para restablecer tu contraseña SACDIA.',
    title: 'Restablecer contraseña',
    body: 'Recibimos una solicitud para restablecer la contraseña de tu cuenta SACDIA. Hacé clic en el botón de abajo para elegir una nueva contraseña. Este enlace es válido por 1 hora.',
    button: 'Restablecer contraseña',
    footer:
      'Si no solicitaste restablecer tu contraseña, ignorá este correo. Tu contraseña actual no cambiará. Si sospechás de actividad no autorizada, contactá soporte en contacto@sacdia.com.',
  },
  en: {
    preview: 'You received a request to reset your SACDIA password.',
    title: 'Reset your password',
    body: 'We received a request to reset the password for your SACDIA account. Click the button below to choose a new password. This link is valid for 1 hour.',
    button: 'Reset password',
    footer:
      'If you did not request a password reset, you can safely ignore this email. Your current password will not change. If you suspect unauthorized activity, contact support at contacto@sacdia.com.',
  },
  fr: {
    preview:
      'Vous avez reçu une demande de réinitialisation de votre mot de passe SACDIA.',
    title: 'Réinitialiser votre mot de passe',
    body: 'Nous avons reçu une demande de réinitialisation du mot de passe de votre compte SACDIA. Cliquez sur le bouton ci-dessous pour choisir un nouveau mot de passe. Ce lien est valable pendant 1 heure.',
    button: 'Réinitialiser le mot de passe',
    footer:
      "Si vous n'avez pas demandé de réinitialisation de mot de passe, vous pouvez ignorer cet e-mail. Votre mot de passe actuel ne changera pas. Si vous suspectez une activité non autorisée, contactez le support à contacto@sacdia.com.",
  },
  'pt-BR': {
    preview: 'Você recebeu uma solicitação para redefinir sua senha SACDIA.',
    title: 'Redefinir sua senha',
    body: 'Recebemos uma solicitação para redefinir a senha da sua conta SACDIA. Clique no botão abaixo para escolher uma nova senha. Este link é válido por 1 hora.',
    button: 'Redefinir senha',
    footer:
      'Se você não solicitou a redefinição de senha, pode ignorar este e-mail com segurança. Sua senha atual não será alterada. Se suspeitar de atividade não autorizada, entre em contato com o suporte em contacto@sacdia.com.',
  },
};

/**
 * Sent when a user requests a password reset.
 * Token is embedded in resetUrl — NEVER pass raw token in email templates.
 * Link expires in 1 hour (set at token creation in better-auth.service.ts).
 */
export function PasswordResetEmail({
  resetUrl,
  lang = 'es',
}: PasswordResetEmailProps) {
  const L = LABELS[lang] ?? LABELS['es'];

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
        {L.body}
      </Text>

      <Section style={{ textAlign: 'center' as const, margin: '0 0 24px' }}>
        <Button
          href={resetUrl}
          style={{
            backgroundColor: '#dc2626',
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
          backgroundColor: '#fef2f2',
          padding: '12px 16px',
          borderRadius: '6px',
          borderLeft: '3px solid #fca5a5',
        }}
      >
        {L.footer}
      </Text>
    </Layout>
  );
}

export default PasswordResetEmail;
