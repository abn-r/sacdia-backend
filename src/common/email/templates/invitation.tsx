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

export interface InvitationEmailProps {
  invitationUrl: string;
  lang?: SupportedEmailLocale;
}

interface Labels {
  preview: string;
  title: string;
  body: string;
  button: string;
  link_fallback: string;
  footer: string;
}

const LABELS: Record<SupportedEmailLocale, Labels> = {
  es: {
    preview: 'Un administrador creó tu cuenta SACDIA. Crea tu contraseña.',
    title: 'Te damos la bienvenida a SACDIA',
    body: 'Un administrador creó una cuenta SACDIA para ti. Haz clic en el botón de abajo para crear tu contraseña y activar tu cuenta. Esta invitación es válida por 7 días.',
    button: 'Crear mi contraseña',
    link_fallback:
      '¿El botón no funciona? Copia y pega este enlace en tu navegador:',
    footer:
      'Si no esperabas esta invitación, ignora este correo: no se realizará ningún cambio. Si la invitación expira, pide a un administrador que te envíe una nueva. Para cualquier duda, contacta soporte en contacto@sacdia.com.',
  },
  en: {
    preview: 'An administrator created your SACDIA account. Create your password.',
    title: 'Welcome to SACDIA',
    body: 'An administrator created a SACDIA account for you. Click the button below to create your password and activate your account. This invitation is valid for 7 days.',
    button: 'Create my password',
    link_fallback:
      'Button not working? Copy and paste this link into your browser:',
    footer:
      'If you were not expecting this invitation, you can safely ignore this email: nothing will change. If the invitation expires, ask an administrator to send you a new one. For any question, contact support at contacto@sacdia.com.',
  },
  fr: {
    preview:
      'Un administrateur a créé votre compte SACDIA. Créez votre mot de passe.',
    title: 'Bienvenue sur SACDIA',
    body: 'Un administrateur a créé un compte SACDIA pour vous. Cliquez sur le bouton ci-dessous pour créer votre mot de passe et activer votre compte. Cette invitation est valable pendant 7 jours.',
    button: 'Créer mon mot de passe',
    link_fallback:
      'Le bouton ne fonctionne pas ? Copiez et collez ce lien dans votre navigateur :',
    footer:
      "Si vous n'attendiez pas cette invitation, vous pouvez ignorer cet e-mail : rien ne changera. Si l'invitation expire, demandez à un administrateur de vous en envoyer une nouvelle. Pour toute question, contactez le support à contacto@sacdia.com.",
  },
  'pt-BR': {
    preview: 'Um administrador criou sua conta SACDIA. Crie sua senha.',
    title: 'Boas-vindas ao SACDIA',
    body: 'Um administrador criou uma conta SACDIA para você. Clique no botão abaixo para criar sua senha e ativar sua conta. Este convite é válido por 7 dias.',
    button: 'Criar minha senha',
    link_fallback:
      'O botão não funciona? Copie e cole este link no seu navegador:',
    footer:
      'Se você não esperava este convite, pode ignorar este e-mail: nada será alterado. Se o convite expirar, peça a um administrador que envie um novo. Em caso de dúvida, entre em contato com o suporte em contacto@sacdia.com.',
  },
};

/**
 * Sent when an administrator creates an account or resends the invitation.
 * Token is embedded in invitationUrl — NEVER pass raw token in email templates.
 * Link expires in 7 days (set at token creation in better-auth.service.ts).
 */
export function InvitationEmail({
  invitationUrl,
  lang = 'es',
}: InvitationEmailProps) {
  const L = LABELS[lang] ?? LABELS['es'];

  return (
    <Layout preview={L.preview} lang={lang}>
      <EmailHeading>{L.title}</EmailHeading>
      <EmailText last>{L.body}</EmailText>
      <EmailButton href={invitationUrl}>{L.button}</EmailButton>
      <EmailLinkFallback label={L.link_fallback} href={invitationUrl} />
      <EmailNote>{L.footer}</EmailNote>
    </Layout>
  );
}

export default InvitationEmail;
