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
import type { SupportedEmailLocale } from '../email.queue';

interface LayoutLabels {
  system_subtitle: string;
  footer_auto: string;
  footer_copyright: (year: number) => string;
}

const LAYOUT_LABELS: Record<SupportedEmailLocale, LayoutLabels> = {
  es: {
    system_subtitle: 'Sistema de Administración de Clubes JA',
    footer_auto:
      'Este correo fue enviado automáticamente por SACDIA. Si no realizaste ninguna acción, podés ignorarlo con seguridad.',
    footer_copyright: (year) =>
      `© ${year} SACDIA — Sistema de Administración de Clubes JA. Todos los derechos reservados.`,
  },
  en: {
    system_subtitle: 'JA Clubs Administration System',
    footer_auto:
      'This email was sent automatically by SACDIA. If you did not take any action, you can safely ignore it.',
    footer_copyright: (year) =>
      `© ${year} SACDIA — JA Clubs Administration System. All rights reserved.`,
  },
  fr: {
    system_subtitle: "Système d'Administration des Clubs JA",
    footer_auto:
      "Cet e-mail a été envoyé automatiquement par SACDIA. Si vous n'avez effectué aucune action, vous pouvez l'ignorer en toute sécurité.",
    footer_copyright: (year) =>
      `© ${year} SACDIA — Système d'Administration des Clubs JA. Tous droits réservés.`,
  },
  'pt-BR': {
    system_subtitle: 'Sistema de Administração de Clubes JA',
    footer_auto:
      'Este e-mail foi enviado automaticamente pelo SACDIA. Se você não realizou nenhuma ação, pode ignorá-lo com segurança.',
    footer_copyright: (year) =>
      `© ${year} SACDIA — Sistema de Administração de Clubes JA. Todos os direitos reservados.`,
  },
};

interface LayoutProps {
  preview?: string;
  children: React.ReactNode;
  lang?: SupportedEmailLocale;
}

/**
 * Base email layout: SACDIA branded header + GDPR-compliant footer.
 * All transactional templates wrap their content with this component.
 * Accepts optional `lang` prop for locale-aware footer text.
 */
export function Layout({ preview, children, lang = 'es' }: LayoutProps) {
  const L = LAYOUT_LABELS[lang] ?? LAYOUT_LABELS['es'];
  const year = new Date().getFullYear();

  return (
    <Html lang={lang}>
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
              {L.system_subtitle}
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
              {L.footer_auto}
            </Text>
            <Text
              style={{
                color: '#71717a',
                fontSize: '12px',
                lineHeight: '18px',
                margin: '8px 0 0',
              }}
            >
              {L.footer_copyright(year)}
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}
