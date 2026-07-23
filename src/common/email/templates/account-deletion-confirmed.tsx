import * as React from 'react';
import { Text, Section } from '@react-email/components';
import { Layout } from './_layout';
import type { SupportedEmailLocale } from '../email.queue';

export interface AccountDeletionConfirmedEmailProps {
  lang?: SupportedEmailLocale;
}

interface Labels {
  preview: string;
  title: string;
  body: string;
  data_summary_title: string;
  data_summary: string[];
  footer: string;
}

const LABELS: Record<SupportedEmailLocale, Labels> = {
  es: {
    preview: 'Tu cuenta SACDIA ha sido eliminada correctamente.',
    title: 'Tu cuenta ha sido eliminada',
    body: 'Tu solicitud de eliminación de cuenta en SACDIA fue procesada exitosamente. Tus datos personales han sido anonimizados conforme al Reglamento General de Protección de Datos (RGPD).',
    data_summary_title: '¿Qué ocurrió con tus datos?',
    data_summary: [
      'Tu perfil fue anonimizado (nombre, email, foto eliminados)',
      'Todas tus sesiones activas fueron revocadas',
      'Tu contraseña fue eliminada permanentemente',
      'Tus tokens de dispositivo fueron desactivados',
    ],
    footer:
      'Registros históricos anónimos (honores, progreso de clases, actividades) pueden conservarse por un periodo de retención conforme a nuestra política de datos. Para más información, escribinos a contacto@sacdia.com.',
  },
  en: {
    preview: 'Your SACDIA account has been successfully deleted.',
    title: 'Your account has been deleted',
    body: 'Your SACDIA account deletion request was processed successfully. Your personal data has been anonymized in accordance with the General Data Protection Regulation (GDPR).',
    data_summary_title: 'What happened to your data?',
    data_summary: [
      'Your profile was anonymized (name, email, photo removed)',
      'All your active sessions were revoked',
      'Your password was permanently deleted',
      'Your device tokens were deactivated',
    ],
    footer:
      'Anonymous historical records (honors, class progress, activities) may be retained for a retention period in accordance with our data policy. For more information, contact us at contacto@sacdia.com.',
  },
  fr: {
    preview: 'Votre compte SACDIA a été supprimé avec succès.',
    title: 'Votre compte a été supprimé',
    body: 'Votre demande de suppression de compte SACDIA a été traitée avec succès. Vos données personnelles ont été anonymisées conformément au Règlement Général sur la Protection des Données (RGPD).',
    data_summary_title: "Qu'est-il arrivé à vos données ?",
    data_summary: [
      'Votre profil a été anonymisé (nom, e-mail, photo supprimés)',
      'Toutes vos sessions actives ont été révoquées',
      'Votre mot de passe a été définitivement supprimé',
      "Vos jetons d'appareil ont été désactivés",
    ],
    footer:
      "Les enregistrements historiques anonymes (honneurs, progression des cours, activités) peuvent être conservés pendant une période de rétention conformément à notre politique de données. Pour plus d'informations, contactez-nous à contacto@sacdia.com.",
  },
  'pt-BR': {
    preview: 'Sua conta SACDIA foi excluída com sucesso.',
    title: 'Sua conta foi excluída',
    body: 'Sua solicitação de exclusão de conta SACDIA foi processada com sucesso. Seus dados pessoais foram anonimizados em conformidade com o Regulamento Geral de Proteção de Dados (RGPD).',
    data_summary_title: 'O que aconteceu com seus dados?',
    data_summary: [
      'Seu perfil foi anonimizado (nome, e-mail, foto removidos)',
      'Todas as suas sessões ativas foram revogadas',
      'Sua senha foi excluída permanentemente',
      'Seus tokens de dispositivo foram desativados',
    ],
    footer:
      'Registros históricos anônimos (honras, progresso de aulas, atividades) podem ser mantidos por um período de retenção de acordo com nossa política de dados. Para mais informações, entre em contato em contacto@sacdia.com.',
  },
};

/**
 * Sent as a fire-and-forget confirmation after successful account deletion.
 * No action links — purely informational.
 * Required by Apple App Store guideline 5.1.1(v) and GDPR Article 17.
 *
 * NOTE: This email is sent to the ORIGINAL email address BEFORE anonymization.
 * The caller (account-deletion.service.ts) must capture the email pre-transaction.
 */
export function AccountDeletionConfirmedEmail({
  lang = 'es',
}: AccountDeletionConfirmedEmailProps) {
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

      <Section
        style={{
          backgroundColor: '#f4f4f5',
          padding: '16px',
          borderRadius: '6px',
          margin: '0 0 24px',
        }}
      >
        <Text
          style={{
            color: '#52525b',
            fontSize: '14px',
            lineHeight: '22px',
            margin: '0',
          }}
        >
          <strong>{L.data_summary_title}</strong>
          {L.data_summary.map((item, i) => (
            <React.Fragment key={i}>
              <br />— {item}
            </React.Fragment>
          ))}
        </Text>
      </Section>

      <Text
        style={{
          color: '#71717a',
          fontSize: '13px',
          lineHeight: '20px',
          margin: '0',
        }}
      >
        {L.footer}
      </Text>
    </Layout>
  );
}

export default AccountDeletionConfirmedEmail;
