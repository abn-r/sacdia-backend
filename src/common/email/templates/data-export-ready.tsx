import * as React from 'react';
import { Text, Button, Section } from '@react-email/components';
import { Layout } from './_layout';
import type { SupportedEmailLocale } from '../email.queue';

export interface DataExportReadyEmailProps {
  deepLink: string;
  expiresAt: Date;
  lang?: SupportedEmailLocale;
}

interface Labels {
  preview: string;
  title: string;
  body: string;
  button: string;
  expires_note: (expiresFormatted: string) => string;
  fallback_note: string;
}

const LABELS: Record<SupportedEmailLocale, Labels> = {
  es: {
    preview: 'Tu exportación de datos SACDIA está lista para descargar.',
    title: 'Tu exportación de datos está lista',
    body: 'Hemos generado tu exportación de datos personales conforme al RGPD. Podés descargarla directamente desde la app SACDIA.',
    button: 'Ver mis datos en la app',
    expires_note: (exp) =>
      `Este enlace expira el ${exp} UTC. Pasada esa fecha, deberás solicitar una nueva exportación desde Configuración → Privacidad → Exportar mis datos.`,
    fallback_note:
      'Si el botón no funciona, abrí la app SACDIA y navegá a Configuración → Privacidad → Mis exportaciones.',
  },
  en: {
    preview: 'Your SACDIA data export is ready to download.',
    title: 'Your data export is ready',
    body: 'We have generated your personal data export in accordance with GDPR. You can download it directly from the SACDIA app.',
    button: 'View my data in the app',
    expires_note: (exp) =>
      `This link expires on ${exp} UTC. After that date, you will need to request a new export from Settings → Privacy → Export my data.`,
    fallback_note:
      "If the button doesn't work, open the SACDIA app and navigate to Settings → Privacy → My exports.",
  },
  fr: {
    preview: 'Votre exportation de données SACDIA est prête à télécharger.',
    title: 'Votre exportation de données est prête',
    body: 'Nous avons généré votre exportation de données personnelles conformément au RGPD. Vous pouvez la télécharger directement depuis l\'application SACDIA.',
    button: 'Voir mes données dans l\'application',
    expires_note: (exp) =>
      `Ce lien expire le ${exp} UTC. Passé cette date, vous devrez demander une nouvelle exportation depuis Paramètres → Confidentialité → Exporter mes données.`,
    fallback_note:
      "Si le bouton ne fonctionne pas, ouvrez l'application SACDIA et accédez à Paramètres → Confidentialité → Mes exportations.",
  },
  'pt-BR': {
    preview: 'Sua exportação de dados SACDIA está pronta para download.',
    title: 'Sua exportação de dados está pronta',
    body: 'Geramos sua exportação de dados pessoais em conformidade com o RGPD. Você pode baixá-la diretamente do aplicativo SACDIA.',
    button: 'Ver meus dados no aplicativo',
    expires_note: (exp) =>
      `Este link expira em ${exp} UTC. Após essa data, você precisará solicitar uma nova exportação em Configurações → Privacidade → Exportar meus dados.`,
    fallback_note:
      'Se o botão não funcionar, abra o aplicativo SACDIA e navegue até Configurações → Privacidade → Minhas exportações.',
  },
};

/**
 * Sent when a GDPR data export is ready to download.
 * Deep link opens the SACDIA mobile app directly to the export screen.
 * Link expires in 48 hours.
 */
export function DataExportReadyEmail({
  deepLink,
  expiresAt,
  lang = 'es',
}: DataExportReadyEmailProps) {
  const L = LABELS[lang] ?? LABELS['es'];

  const expiresFormatted = expiresAt.toLocaleString('es-AR', {
    timeZone: 'UTC',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

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
          href={deepLink}
          style={{
            backgroundColor: '#1e40af',
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
        {L.expires_note(expiresFormatted)}
      </Text>

      <Text
        style={{
          color: '#71717a',
          fontSize: '13px',
          lineHeight: '20px',
          margin: '16px 0 0',
        }}
      >
        {L.fallback_note}
      </Text>
    </Layout>
  );
}

export default DataExportReadyEmail;
