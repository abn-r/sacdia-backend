import * as React from 'react';
import { Layout } from './_layout';
import { EmailHeading, EmailNote, EmailText } from './_ui';
import type { SupportedEmailLocale } from '../email.queue';

export interface DataExportReadyEmailProps {
  expiresAt: Date;
  lang?: SupportedEmailLocale;
}

interface Labels {
  preview: string;
  title: string;
  body: string;
  steps: string;
  expires_note: (expiresFormatted: string) => string;
  /** Footer: replaces the generic "you can ignore this" notice. */
  not_requested: string;
}

const LABELS: Record<SupportedEmailLocale, Labels> = {
  es: {
    preview: 'Tu exportación de datos SACDIA está lista para descargar.',
    title: 'Tu exportación de datos está lista',
    body: 'Generamos el archivo con tus datos personales. Por seguridad, solo se puede descargar desde la app SACDIA con tu sesión iniciada.',
    steps:
      'En la app, abre Perfil → Configuración → Cuenta → Descargar mis datos.',
    expires_note: (exp) =>
      `La descarga estará disponible hasta el ${exp} UTC. Después tendrás que solicitar una nueva exportación desde esa misma pantalla.`,
    not_requested:
      'Este correo fue enviado automáticamente por SACDIA. Si no solicitaste esta exportación, cambia tu contraseña y revisa Configuración → Cuenta → Sesiones activas.',
  },
  en: {
    preview: 'Your SACDIA data export is ready to download.',
    title: 'Your data export is ready',
    body: 'We generated the file with your personal data. For your security, it can only be downloaded from the SACDIA app while signed in.',
    steps: 'In the app, open Profile → Settings → Account → Download my data.',
    expires_note: (exp) =>
      `The download is available until ${exp} UTC. After that, you will need to request a new export from the same screen.`,
    not_requested:
      'This email was sent automatically by SACDIA. If you did not request this export, change your password and review Settings → Account → Active sessions.',
  },
  fr: {
    preview: 'Votre exportation de données SACDIA est prête à télécharger.',
    title: 'Votre exportation de données est prête',
    body: "Nous avons généré le fichier contenant vos données personnelles. Pour votre sécurité, il ne peut être téléchargé que depuis l'application SACDIA, avec votre session ouverte.",
    steps:
      "Dans l'application, ouvrez Profil → Paramètres → Compte → Télécharger mes données.",
    expires_note: (exp) =>
      `Le téléchargement est disponible jusqu'au ${exp} UTC. Ensuite, vous devrez demander une nouvelle exportation depuis le même écran.`,
    not_requested:
      "Cet e-mail a été envoyé automatiquement par SACDIA. Si vous n'avez pas demandé cette exportation, changez votre mot de passe et vérifiez Paramètres → Compte → Sessions actives.",
  },
  'pt-BR': {
    preview: 'Sua exportação de dados SACDIA está pronta para download.',
    title: 'Sua exportação de dados está pronta',
    body: 'Geramos o arquivo com seus dados pessoais. Por segurança, ele só pode ser baixado pelo aplicativo SACDIA com sua sessão iniciada.',
    steps:
      'No aplicativo, abra Perfil → Configurações → Conta → Baixar meus dados.',
    expires_note: (exp) =>
      `O download fica disponível até ${exp} UTC. Depois disso, você precisará solicitar uma nova exportação na mesma tela.`,
    not_requested:
      'Este e-mail foi enviado automaticamente pelo SACDIA. Se você não solicitou esta exportação, altere sua senha e revise Configurações → Conta → Sessões ativas.',
  },
};

const DATE_LOCALE: Record<SupportedEmailLocale, string> = {
  es: 'es-MX',
  en: 'en-US',
  fr: 'fr-FR',
  'pt-BR': 'pt-BR',
};

/**
 * Sent when a GDPR data export is ready. No button on purpose: the app has
 * no handler for a custom-scheme link and mail clients strip it, and a
 * direct file link would hand all personal data to anyone holding the email.
 * The email points to the in-app screen, which requires a signed-in session.
 * The export is available for 48 hours.
 */
export function DataExportReadyEmail({
  expiresAt,
  lang = 'es',
}: DataExportReadyEmailProps) {
  const L = LABELS[lang] ?? LABELS['es'];

  const expiresFormatted = expiresAt.toLocaleString(
    DATE_LOCALE[lang] ?? 'es-MX',
    {
      timeZone: 'UTC',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    },
  );

  return (
    <Layout preview={L.preview} lang={lang} footerNotice={L.not_requested}>
      <EmailHeading>{L.title}</EmailHeading>
      <EmailText>{L.body}</EmailText>
      <EmailText last>{L.steps}</EmailText>
      <EmailNote>{L.expires_note(expiresFormatted)}</EmailNote>
    </Layout>
  );
}

export default DataExportReadyEmail;
