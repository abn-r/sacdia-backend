import * as React from 'react';
import { Html, Head, Body, Container, Section, Text, Hr } from 'react-email';
import { BrandMark, EMAIL_THEME } from './_ui';
import type { SupportedEmailLocale } from '../email.queue';

interface LayoutLabels {
  brand_subtitle: string;
  footer_auto: string;
  footer_copyright: (year: number) => string;
}

const LAYOUT_LABELS: Record<SupportedEmailLocale, LayoutLabels> = {
  es: {
    brand_subtitle: 'Clubes JA',
    footer_auto:
      'Este correo fue enviado automáticamente por SACDIA. Si no realizaste ninguna acción, puedes ignorarlo con seguridad.',
    footer_copyright: (year) =>
      `© ${year} SACDIA — Sistema de Administración de Clubes JA. Todos los derechos reservados.`,
  },
  en: {
    brand_subtitle: 'JA Clubs',
    footer_auto:
      'This email was sent automatically by SACDIA. If you did not take any action, you can safely ignore it.',
    footer_copyright: (year) =>
      `© ${year} SACDIA — JA Clubs Administration System. All rights reserved.`,
  },
  fr: {
    brand_subtitle: 'Clubs JA',
    footer_auto:
      "Cet e-mail a été envoyé automatiquement par SACDIA. Si vous n'avez effectué aucune action, vous pouvez l'ignorer en toute sécurité.",
    footer_copyright: (year) =>
      `© ${year} SACDIA — Système d'Administration des Clubs JA. Tous droits réservés.`,
  },
  'pt-BR': {
    brand_subtitle: 'Clubes JA',
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
  /** Replaces the default automatic-email notice (e.g. formal "usted" copy). */
  footerNotice?: string;
}

const footerText: React.CSSProperties = {
  color: EMAIL_THEME.muted,
  fontSize: '12px',
  lineHeight: '18px',
  margin: '0',
};

/**
 * Base email layout, styled like the SACDIA web pages (reset password page):
 * white page, brand mark on top, narrow column, footer with the automatic
 * notice. All transactional templates wrap their content with it.
 */
export function Layout({
  preview,
  children,
  lang = 'es',
  footerNotice,
}: LayoutProps) {
  const L = LAYOUT_LABELS[lang] ?? LAYOUT_LABELS['es'];
  const year = new Date().getFullYear();

  return (
    <Html lang={lang}>
      <Head>
        <meta name="color-scheme" content="light" />
        <meta name="supported-color-schemes" content="light" />
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
      </Head>
      <Body
        style={{
          backgroundColor: '#ffffff',
          color: EMAIL_THEME.foreground,
          fontFamily: EMAIL_THEME.fontFamily,
          margin: 0,
          padding: 0,
        }}
      >
        <Container
          style={{
            margin: '0 auto',
            maxWidth: '480px',
            padding: '48px 24px 40px',
          }}
        >
          <BrandMark subtitle={L.brand_subtitle} />

          <Section>{children}</Section>

          <Hr
            style={{
              borderColor: EMAIL_THEME.border,
              borderTopWidth: '1px',
              margin: '32px 0 20px',
            }}
          />
          <Text style={footerText}>{footerNotice ?? L.footer_auto}</Text>
          <Text style={{ ...footerText, margin: '8px 0 0' }}>
            {L.footer_copyright(year)}
          </Text>
        </Container>
      </Body>
    </Html>
  );
}
