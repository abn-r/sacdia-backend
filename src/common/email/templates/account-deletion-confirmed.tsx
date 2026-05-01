import * as React from 'react';
import { Text, Section } from '@react-email/components';
import { Layout } from './_layout';

/**
 * Sent as a fire-and-forget confirmation after successful account deletion.
 * No action links — purely informational.
 * Required by Apple App Store guideline 5.1.1(v) and GDPR Article 17.
 *
 * NOTE: This email is sent to the ORIGINAL email address BEFORE anonymization.
 * The caller (account-deletion.service.ts) must capture the email pre-transaction.
 */
export function AccountDeletionConfirmedEmail() {
  return (
    <Layout preview="Tu cuenta SACDIA ha sido eliminada correctamente.">
      <Text
        style={{
          fontSize: '20px',
          fontWeight: '600',
          color: '#18181b',
          margin: '0 0 8px',
        }}
      >
        Tu cuenta ha sido eliminada
      </Text>
      <Text
        style={{
          color: '#52525b',
          fontSize: '15px',
          lineHeight: '24px',
          margin: '0 0 24px',
        }}
      >
        Tu solicitud de eliminación de cuenta en SACDIA fue procesada
        exitosamente. Tus datos personales han sido anonimizados conforme al
        Reglamento General de Protección de Datos (RGPD).
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
          <strong>¿Qué ocurrió con tus datos?</strong>
          <br />— Tu perfil fue anonimizado (nombre, email, foto eliminados)
          <br />— Todas tus sesiones activas fueron revocadas
          <br />— Tu contraseña fue eliminada permanentemente
          <br />— Tus tokens de dispositivo fueron desactivados
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
        Registros históricos anónimos (honores, progreso de clases, actividades)
        pueden conservarse por un periodo de retención conforme a nuestra
        política de datos. Para más información, escribinos a hola@sacdia.app.
      </Text>
    </Layout>
  );
}

export default AccountDeletionConfirmedEmail;
