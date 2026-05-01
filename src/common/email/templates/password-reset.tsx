import * as React from 'react';
import { Text, Button, Section } from '@react-email/components';
import { Layout } from './_layout';

export interface PasswordResetEmailProps {
  resetUrl: string;
}

/**
 * Sent when a user requests a password reset.
 * Token is embedded in resetUrl — NEVER pass raw token in email templates.
 * Link expires in 1 hour (set at token creation in better-auth.service.ts).
 */
export function PasswordResetEmail({ resetUrl }: PasswordResetEmailProps) {
  return (
    <Layout preview="Recibiste una solicitud para restablecer tu contraseña SACDIA.">
      <Text
        style={{
          fontSize: '20px',
          fontWeight: '600',
          color: '#18181b',
          margin: '0 0 8px',
        }}
      >
        Restablecer contraseña
      </Text>
      <Text
        style={{
          color: '#52525b',
          fontSize: '15px',
          lineHeight: '24px',
          margin: '0 0 24px',
        }}
      >
        Recibimos una solicitud para restablecer la contraseña de tu cuenta
        SACDIA. Hacé clic en el botón de abajo para elegir una nueva contraseña.
        Este enlace es válido por 1 hora.
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
          Restablecer contraseña
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
        Si no solicitaste restablecer tu contraseña, ignorá este correo. Tu
        contraseña actual no cambiará. Si sospechás de actividad no autorizada,
        contactá soporte en hola@sacdia.app.
      </Text>
    </Layout>
  );
}

export default PasswordResetEmail;
