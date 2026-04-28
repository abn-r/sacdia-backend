import * as React from 'react';
import { Text, Button, Section } from '@react-email/components';
import { Layout } from './_layout';

export interface DataExportReadyEmailProps {
  deepLink: string;
  expiresAt: Date;
}

/**
 * Sent when a GDPR data export is ready to download.
 * Deep link opens the SACDIA mobile app directly to the export screen.
 * Link expires in 48 hours.
 */
export function DataExportReadyEmail({
  deepLink,
  expiresAt,
}: DataExportReadyEmailProps) {
  const expiresFormatted = expiresAt.toLocaleString('es-AR', {
    timeZone: 'UTC',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <Layout preview="Tu exportación de datos SACDIA está lista para descargar.">
      <Text
        style={{
          fontSize: '20px',
          fontWeight: '600',
          color: '#18181b',
          margin: '0 0 8px',
        }}
      >
        Tu exportación de datos está lista
      </Text>
      <Text
        style={{
          color: '#52525b',
          fontSize: '15px',
          lineHeight: '24px',
          margin: '0 0 24px',
        }}
      >
        Hemos generado tu exportación de datos personales conforme al RGPD. Podés
        descargarla directamente desde la app SACDIA.
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
          Ver mis datos en la app
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
        Este enlace expira el {expiresFormatted} UTC. Pasada esa fecha, deberás
        solicitar una nueva exportación desde Configuración → Privacidad → Exportar
        mis datos.
      </Text>

      <Text
        style={{
          color: '#71717a',
          fontSize: '13px',
          lineHeight: '20px',
          margin: '16px 0 0',
        }}
      >
        Si el botón no funciona, abrí la app SACDIA y navegá a
        Configuración → Privacidad → Mis exportaciones.
      </Text>
    </Layout>
  );
}

export default DataExportReadyEmail;
