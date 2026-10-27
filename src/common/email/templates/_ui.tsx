import * as React from 'react';
import { Button, Img, Link, Section, Text } from 'react-email';

/**
 * Visual tokens of the SACDIA web pages (sacdia-admin `globals.css`, light
 * theme, `data-theme-preset="default"` / Scout Vibrante), so the emails look
 * like the reset password page they link to. Email clients ignore CSS
 * variables, so the values are literal: update them when the admin theme
 * changes.
 */
export const EMAIL_THEME = {
  primary: '#0073ea',
  primaryForeground: '#ffffff',
  foreground: '#0a0a0a',
  muted: '#666666',
  subtle: '#f5f5f5',
  border: '#ebebeb',
  destructive: '#dc2626',
  destructiveSoft: '#fef2f2',
  destructiveBorder: '#fecaca',
  radius: '8px',
  fontFamily:
    "Geist, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
  monoFamily:
    "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
} as const;

/**
 * Public URL of the logo used in the email header, or null when it can't be
 * built. The image is served by the admin web app
 * (`sacdia-admin/public/email-logo.png`), so it follows ADMIN_PANEL_URL.
 */
export function emailLogoUrl(
  adminPanelUrl: string | undefined = process.env.ADMIN_PANEL_URL,
): string | null {
  const raw = adminPanelUrl?.trim();
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return null;
    }
  } catch {
    return null;
  }
  return `${raw.replace(/\/+$/, '')}/email-logo.png`;
}

/** Logo + "SACDIA" + subtitle, same mark as the top of the web pages. */
export function BrandMark({ subtitle }: { subtitle: string }) {
  const logo = emailLogoUrl();
  return (
    <table
      role="presentation"
      cellPadding={0}
      cellSpacing={0}
      style={{ borderCollapse: 'collapse', margin: '0 0 32px' }}
    >
      <tbody>
        <tr>
          {logo && (
            <td style={{ paddingRight: '12px', verticalAlign: 'middle' }}>
              <Img
                src={logo}
                width="40"
                height="40"
                alt="SACDIA"
                style={{ borderRadius: '12px', display: 'block' }}
              />
            </td>
          )}
          <td style={{ verticalAlign: 'middle' }}>
            <Text
              style={{
                color: EMAIL_THEME.foreground,
                fontSize: '16px',
                fontWeight: 700,
                letterSpacing: '-0.2px',
                lineHeight: '20px',
                margin: 0,
              }}
            >
              SACDIA
            </Text>
            <Text
              style={{
                color: EMAIL_THEME.muted,
                fontFamily: EMAIL_THEME.monoFamily,
                fontSize: '11px',
                lineHeight: '16px',
                margin: 0,
              }}
            >
              {subtitle}
            </Text>
          </td>
        </tr>
      </tbody>
    </table>
  );
}

export function EmailHeading({ children }: { children: React.ReactNode }) {
  return (
    <Text
      style={{
        color: EMAIL_THEME.foreground,
        fontSize: '24px',
        fontWeight: 600,
        letterSpacing: '-0.4px',
        lineHeight: '30px',
        margin: '0 0 8px',
      }}
    >
      {children}
    </Text>
  );
}

export function EmailText({
  children,
  last = false,
}: {
  children: React.ReactNode;
  last?: boolean;
}) {
  return (
    <Text
      style={{
        color: EMAIL_THEME.muted,
        fontSize: '14px',
        lineHeight: '22px',
        margin: last ? '0 0 28px' : '0 0 12px',
      }}
    >
      {children}
    </Text>
  );
}

/** Full-width primary button, like the submit button of the web form. */
export function EmailButton({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Section style={{ margin: '0 0 20px' }}>
      <Button
        href={href}
        style={{
          backgroundColor: EMAIL_THEME.primary,
          borderRadius: EMAIL_THEME.radius,
          color: EMAIL_THEME.primaryForeground,
          display: 'block',
          fontSize: '14px',
          fontWeight: 600,
          lineHeight: '20px',
          padding: '12px 16px',
          textAlign: 'center' as const,
          textDecoration: 'none',
        }}
      >
        {children}
      </Button>
    </Section>
  );
}

/**
 * Plain link under the button, for mail clients that block buttons or
 * when the person prefers to copy the address.
 */
export function EmailLinkFallback({
  label,
  href,
}: {
  label: string;
  href: string;
}) {
  return (
    <Text
      style={{
        color: EMAIL_THEME.muted,
        fontSize: '12px',
        lineHeight: '18px',
        margin: '0 0 24px',
        wordBreak: 'break-all' as const,
      }}
    >
      {label}{' '}
      <Link href={href} style={{ color: EMAIL_THEME.primary }}>
        {href}
      </Link>
    </Text>
  );
}

/** Soft box for security notes (neutral) or warnings (destructive). */
export function EmailNote({
  children,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  tone?: 'neutral' | 'warning';
}) {
  const warning = tone === 'warning';
  return (
    <Text
      style={{
        backgroundColor: warning
          ? EMAIL_THEME.destructiveSoft
          : EMAIL_THEME.subtle,
        border: `1px solid ${warning ? EMAIL_THEME.destructiveBorder : EMAIL_THEME.border}`,
        borderRadius: EMAIL_THEME.radius,
        color: warning ? EMAIL_THEME.destructive : EMAIL_THEME.muted,
        fontSize: '13px',
        lineHeight: '20px',
        margin: '0 0 8px',
        padding: '12px 14px',
      }}
    >
      {children}
    </Text>
  );
}
