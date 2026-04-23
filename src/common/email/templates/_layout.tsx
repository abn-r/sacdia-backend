import * as React from 'react';
import {
  Html,
  Head,
  Body,
  Container,
  Section,
  Text,
  Hr,
  Font,
} from '@react-email/components';

interface LayoutProps {
  preview?: string;
  children: React.ReactNode;
}

/**
 * Base email layout: SACDIA branded header + GDPR-compliant footer.
 * All transactional templates wrap their content with this component.
 */
export function Layout({ preview, children }: LayoutProps) {
  return (
    <Html lang="es">
      <Head>
        {preview && (
          <span
            style={{
              display: 'none',
              overflow: 'hidden',
              maxHeight: 0,
              maxWidth: 0,
              opacity: 0,
            }}
          >
            {preview}
          </span>
        )}
        <Font
          fontFamily="Inter"
          fallbackFontFamily="Arial"
          webFont={{
            url: 'https://fonts.gstatic.com/s/inter/v13/UcCO3FwrK3iLTeHuS_fvQtMwCp50KnMw2boKoduKmMEVuLyfAZ9hiJ-Ek-_EeA.woff2',
            format: 'woff2',
          }}
          fontWeight={400}
          fontStyle="normal"
        />
      </Head>
      <Body
        style={{
          backgroundColor: '#f4f4f5',
          fontFamily: 'Inter, Arial, sans-serif',
          margin: 0,
          padding: 0,
        }}
      >
        <Container
          style={{
            backgroundColor: '#ffffff',
            margin: '40px auto',
            padding: '0',
            maxWidth: '560px',
            borderRadius: '8px',
            overflow: 'hidden',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          }}
        >
          {/* Header */}
          <Section
            style={{
              backgroundColor: '#1e40af',
              padding: '24px 32px',
              textAlign: 'center' as const,
            }}
          >
            <Text
              style={{
                color: '#ffffff',
                fontSize: '22px',
                fontWeight: '700',
                margin: '0',
                letterSpacing: '-0.3px',
              }}
            >
              SACDIA
            </Text>
            <Text
              style={{
                color: '#bfdbfe',
                fontSize: '12px',
                margin: '4px 0 0',
              }}
            >
              Sistema de Administración de Clubes JA
            </Text>
          </Section>

          {/* Content */}
          <Section style={{ padding: '32px' }}>{children}</Section>

          {/* Footer */}
          <Section
            style={{
              padding: '0 32px 32px',
            }}
          >
            <Hr style={{ borderColor: '#e4e4e7', margin: '0 0 24px' }} />
            <Text
              style={{
                color: '#71717a',
                fontSize: '12px',
                lineHeight: '18px',
                margin: '0',
              }}
            >
              Este correo fue enviado automáticamente por SACDIA. Si no
              realizaste ninguna acción, podés ignorarlo con seguridad.
            </Text>
            <Text
              style={{
                color: '#71717a',
                fontSize: '12px',
                lineHeight: '18px',
                margin: '8px 0 0',
              }}
            >
              © {new Date().getFullYear()} SACDIA — Sistema de Administración de
              Clubes JA. Todos los derechos reservados.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
