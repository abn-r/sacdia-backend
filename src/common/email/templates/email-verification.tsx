import * as React from 'react';
import { Text, Button, Section } from '@react-email/components';
import { Layout } from './_layout';

export interface EmailVerificationProps {
  verificationUrl: string;
  userName?: string;
}

/**
 * Sent after registration to verify the user's email address.
 * Token is embedded in verificationUrl — NEVER pass raw token in email templates.
 * Link expires in 24 hours (set at token creation in auth.service.ts).
 */
export function EmailVerificationEmail({
  verificationUrl,
  userName,
}: EmailVerificationProps) {
  const greeting = userName ? `Hola, ${userName}` : 'Hola';

  return (
    <Layout preview="Verificá tu dirección de correo para activar tu cuenta SACDIA.">
      <Text
        style={{
          fontSize: '20px',
          fontWeight: '600',
          color: '#18181b',
          margin: '0 0 8px',
        }}
      >
        Verificá tu correo electrónico
      </Text>
      <Text
        style={{
          color: '#52525b',
          fontSize: '15px',
          lineHeight: '24px',
          margin: '0 0 24px',
        }}
      >
        {greeting}. Para activar tu cuenta SACDIA, hacé clic en el botón de
        abajo. Este enlace es válido por 24 horas.
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
          Verificar mi correo
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
        Si no creaste una cuenta en SACDIA, ignorá este correo. No se realizará
        ningún cambio en tu cuenta.
      </Text>
    </Layout>
  );
}

export default EmailVerificationEmail;
