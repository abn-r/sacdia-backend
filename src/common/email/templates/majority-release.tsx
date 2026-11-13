import * as React from 'react';
import { Layout } from './_layout';
import { EmailHeading, EmailNote, EmailText } from './_ui';
import type {
  MajorityReleaseEmailKind,
  SupportedEmailLocale,
} from '../email.queue';

export interface MajorityReleaseEmailProps {
  kind: MajorityReleaseEmailKind;
  /** Reminder: whole days left to accept. */
  daysLeft?: number;
  /** Release / reminder: the acceptance deadline. */
  deadlineAt?: Date;
  /** Notice: ISO date (YYYY-MM-DD) of the majority. */
  majorityDate?: string;
  lang?: SupportedEmailLocale;
}

interface Labels {
  preview: string;
  title: string;
  /** Gets the formatted date ('' when unknown) and the days left. */
  body: (date: string, daysLeft: number | undefined) => string;
  note: string;
}

/*
 * LEGAL SIGN-OFF PENDING (Phase 4 / R6): every text below is a draft until
 * counsel approves the wording (notice, acceptance, consequences of staying
 * frozen, retention of data). Keep the wording in LABELS only. The mails carry
 * no credentials and no links: they point to the app.
 */
const LABELS: Record<
  SupportedEmailLocale,
  Record<MajorityReleaseEmailKind, Labels>
> = {
  es: {
    notice: {
      preview: 'Pronto cumplirás la mayoría de edad en SACDIA.',
      title: 'Pronto serás mayor de edad',
      body: (date) =>
        `${date ? `El ${date} ` : 'Pronto '}cumples la mayoría de edad. A partir de ese día tus tutores dejarán de gestionar tu cuenta SACDIA y tu cuenta será solo tuya. Tendrás 30 días para aceptar los términos vigentes desde la app.`,
      note: 'Abre la app SACDIA cuando llegue ese día para continuar.',
    },
    released: {
      preview: 'Tu cuenta SACDIA ahora es solo tuya.',
      title: 'Ahora eres independiente',
      body: (date) =>
        `Ya eres mayor de edad y tu cuenta SACDIA es solo tuya. Abre la app y acepta los términos vigentes${date ? ` antes del ${date}` : ''} para seguir usándola.`,
      note: 'Si no aceptas, tu cuenta quedará en pausa: tus datos no se usarán ni se eliminarán hasta que regreses.',
    },
    reminder: {
      preview: 'Te queda poco tiempo para aceptar los términos de SACDIA.',
      title: 'Acepta los términos para mantener tu cuenta',
      body: (date, daysLeft) =>
        `Te ${daysLeft === 1 ? 'queda 1 día' : `quedan ${daysLeft ?? ''} días`} para aceptar los términos vigentes${date ? ` (fecha límite ${date})` : ''}. Abre la app SACDIA para hacerlo.`,
      note: 'Si no aceptas a tiempo, tu cuenta quedará en pausa y podrás reactivarla cuando quieras aceptando los términos.',
    },
    frozen: {
      preview: 'Tu cuenta SACDIA está en pausa.',
      title: 'Tu cuenta está en pausa',
      body: () =>
        'No aceptaste los términos a tiempo. Tus datos no se usan ni se eliminan. Abre la app SACDIA y acepta los términos vigentes para reactivar tu cuenta.',
      note: 'Solo tú puedes solicitar la eliminación de tu cuenta.',
    },
  },
  en: {
    notice: {
      preview: 'You will soon reach the age of majority on SACDIA.',
      title: 'You will soon be of age',
      body: (date) =>
        `${date ? `On ${date} you` : 'You'} reach the age of majority. From that day your guardians stop managing your SACDIA account and it becomes yours alone. You will have 30 days to accept the current terms in the app.`,
      note: 'Open the SACDIA app when that day comes to continue.',
    },
    released: {
      preview: 'Your SACDIA account is now yours alone.',
      title: 'You are now independent',
      body: (date) =>
        `You are now of age and your SACDIA account is yours alone. Open the app and accept the current terms${date ? ` before ${date}` : ''} to keep using it.`,
      note: 'If you do not accept, your account will be paused: your data will not be used or deleted until you return.',
    },
    reminder: {
      preview: 'You are running out of time to accept the SACDIA terms.',
      title: 'Accept the terms to keep your account',
      body: (date, daysLeft) =>
        `You have ${daysLeft === 1 ? '1 day' : `${daysLeft ?? ''} days`} left to accept the current terms${date ? ` (deadline ${date})` : ''}. Open the SACDIA app to do it.`,
      note: 'If you do not accept in time your account will be paused, and you can reactivate it any time by accepting the terms.',
    },
    frozen: {
      preview: 'Your SACDIA account is paused.',
      title: 'Your account is paused',
      body: () =>
        'You did not accept the terms in time. Your data is neither used nor deleted. Open the SACDIA app and accept the current terms to reactivate your account.',
      note: 'Only you can request the deletion of your account.',
    },
  },
  fr: {
    notice: {
      preview: 'Vous allez bientôt atteindre la majorité sur SACDIA.',
      title: 'Vous serez bientôt majeur',
      body: (date) =>
        `${date ? `Le ${date}, vous atteignez` : 'Vous atteignez bientôt'} la majorité. À partir de ce jour, vos tuteurs ne gèrent plus votre compte SACDIA et il devient uniquement le vôtre. Vous aurez 30 jours pour accepter les conditions en vigueur dans l'application.`,
      note: "Ouvrez l'application SACDIA ce jour-là pour continuer.",
    },
    released: {
      preview: 'Votre compte SACDIA est désormais uniquement le vôtre.',
      title: 'Vous êtes maintenant indépendant',
      body: (date) =>
        `Vous êtes majeur et votre compte SACDIA est uniquement le vôtre. Ouvrez l'application et acceptez les conditions en vigueur${date ? ` avant le ${date}` : ''} pour continuer à l'utiliser.`,
      note: "Si vous n'acceptez pas, votre compte sera mis en pause : vos données ne seront ni utilisées ni supprimées jusqu'à votre retour.",
    },
    reminder: {
      preview:
        'Il vous reste peu de temps pour accepter les conditions SACDIA.',
      title: 'Acceptez les conditions pour conserver votre compte',
      body: (date, daysLeft) =>
        `Il vous reste ${daysLeft === 1 ? '1 jour' : `${daysLeft ?? ''} jours`} pour accepter les conditions en vigueur${date ? ` (date limite ${date})` : ''}. Ouvrez l'application SACDIA pour le faire.`,
      note: "Si vous n'acceptez pas à temps, votre compte sera mis en pause et vous pourrez le réactiver à tout moment en acceptant les conditions.",
    },
    frozen: {
      preview: 'Votre compte SACDIA est en pause.',
      title: 'Votre compte est en pause',
      body: () =>
        "Vous n'avez pas accepté les conditions à temps. Vos données ne sont ni utilisées ni supprimées. Ouvrez l'application SACDIA et acceptez les conditions en vigueur pour réactiver votre compte.",
      note: 'Vous seul pouvez demander la suppression de votre compte.',
    },
  },
  'pt-BR': {
    notice: {
      preview: 'Em breve você atingirá a maioridade no SACDIA.',
      title: 'Em breve você será maior de idade',
      body: (date) =>
        `${date ? `Em ${date} você completa` : 'Em breve você completa'} a maioridade. A partir desse dia seus responsáveis deixam de gerenciar sua conta SACDIA e ela passa a ser só sua. Você terá 30 dias para aceitar os termos vigentes no app.`,
      note: 'Abra o app SACDIA quando esse dia chegar para continuar.',
    },
    released: {
      preview: 'Sua conta SACDIA agora é só sua.',
      title: 'Agora você é independente',
      body: (date) =>
        `Você já é maior de idade e sua conta SACDIA é só sua. Abra o app e aceite os termos vigentes${date ? ` antes de ${date}` : ''} para continuar usando.`,
      note: 'Se você não aceitar, sua conta ficará em pausa: seus dados não serão usados nem excluídos até você voltar.',
    },
    reminder: {
      preview: 'Resta pouco tempo para aceitar os termos do SACDIA.',
      title: 'Aceite os termos para manter sua conta',
      body: (date, daysLeft) =>
        `Resta${daysLeft === 1 ? ' 1 dia' : `m ${daysLeft ?? ''} dias`} para aceitar os termos vigentes${date ? ` (prazo ${date})` : ''}. Abra o app SACDIA para fazer isso.`,
      note: 'Se você não aceitar a tempo, sua conta ficará em pausa e você poderá reativá-la quando quiser aceitando os termos.',
    },
    frozen: {
      preview: 'Sua conta SACDIA está em pausa.',
      title: 'Sua conta está em pausa',
      body: () =>
        'Você não aceitou os termos a tempo. Seus dados não são usados nem excluídos. Abra o app SACDIA e aceite os termos vigentes para reativar sua conta.',
      note: 'Somente você pode solicitar a exclusão da sua conta.',
    },
  },
};

const DATE_LOCALE: Record<SupportedEmailLocale, string> = {
  es: 'es-MX',
  en: 'en-US',
  fr: 'fr-FR',
  'pt-BR': 'pt-BR',
};

/**
 * Majority-release mail (Phase 4): notice at T-30, "released / now
 * independent", reminders and the freeze notice. Informational only: no token,
 * no credentials, no link. Wording is pending legal sign-off.
 */
export function MajorityReleaseEmail({
  kind,
  daysLeft,
  deadlineAt,
  majorityDate,
  lang = 'es',
}: MajorityReleaseEmailProps) {
  const L = (LABELS[lang] ?? LABELS['es'])[kind] ?? LABELS['es'].notice;
  const format = (value: Date): string =>
    value.toLocaleDateString(DATE_LOCALE[lang] ?? 'es-MX', {
      timeZone: 'UTC',
      day: '2-digit',
      month: 'long',
      year: 'numeric',
    });
  const majority = majorityDate ? new Date(`${majorityDate}T00:00:00Z`) : null;
  const date =
    kind === 'notice'
      ? majority && !Number.isNaN(majority.getTime())
        ? format(majority)
        : ''
      : deadlineAt
        ? format(deadlineAt)
        : '';

  return (
    <Layout preview={L.preview} lang={lang}>
      <EmailHeading>{L.title}</EmailHeading>
      <EmailText last>{L.body(date, daysLeft)}</EmailText>
      <EmailNote>{L.note}</EmailNote>
    </Layout>
  );
}

export default MajorityReleaseEmail;
