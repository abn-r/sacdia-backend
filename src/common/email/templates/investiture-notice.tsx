import * as React from 'react';
import { Layout } from './_layout';
import { EmailButton, EmailText } from './_ui';

export interface InvestitureNoticeEmailProps {
  paragraphs: string[];
  link: string | null;
}

/**
 * Investiture authorization notices (Spanish only, formal "usted"). The
 * paragraphs come from investiture-communications.rules.ts; `link` opens the
 * request in the admin panel.
 */
export function InvestitureNoticeEmail({
  paragraphs,
  link,
}: InvestitureNoticeEmailProps) {
  return (
    <Layout
      lang="es"
      preview={paragraphs[0]}
      footerNotice="Este correo fue enviado automáticamente por SACDIA. Si no realizó esta acción, puede ignorarlo."
    >
      {paragraphs.map((paragraph, index) => (
        <EmailText
          key={`${index}-${paragraph}`}
          last={index === paragraphs.length - 1 && !link}
        >
          {paragraph}
        </EmailText>
      ))}
      {/* The paragraphs already list each request URL in plain text. */}
      {link && <EmailButton href={link}>Abrir en el panel</EmailButton>}
    </Layout>
  );
}

export default InvestitureNoticeEmail;
