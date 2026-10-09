import * as React from 'react';
import {
  Body,
  Container,
  Head,
  Html,
  Link,
  Section,
  Text,
} from '@react-email/components';

export interface InvestitureNoticeEmailProps {
  paragraphs: string[];
  link: string | null;
}

export function InvestitureNoticeEmail({
  paragraphs,
  link,
}: InvestitureNoticeEmailProps) {
  return React.createElement(
    Html,
    null,
    React.createElement(Head, null),
    React.createElement(
      Body,
      null,
      React.createElement(
        Container,
        null,
        paragraphs.map((paragraph) =>
          React.createElement(
            Section,
            { key: paragraph },
            React.createElement(Text, null, paragraph),
          ),
        ),
        link
          ? React.createElement(
              Section,
              null,
              React.createElement(Link, { href: link }, link),
            )
          : null,
        React.createElement(
          Text,
          null,
          'Este correo fue enviado automáticamente por SACDIA. Si no realizó esta acción, puede ignorarlo.',
        ),
      ),
    ),
  );
}
