import * as React from 'react';
import { Text, Section, Hr } from '@react-email/components';
import { Layout } from './_layout';

export type CronAlertCondition = 'consecutive_failures' | 'duration' | 'failure_rate';

export interface CronAlertFailedRun {
  run_id: number;
  started_at: string; // ISO string
  error_message: string | null;
  duration_ms: number | null;
}

export interface CronAlertEmailProps {
  jobName: string;
  condition: CronAlertCondition;
  /** Human-readable summary of why the alert fired */
  conditionDetail: string;
  recentFailures: CronAlertFailedRun[];
  locale?: 'es' | 'en' | 'pt-BR' | 'fr';
}

interface LocaleLabels {
  title: string;
  subtitle: string;
  job: string;
  condition_label: string;
  recent: string;
  run_id_label: string;
  started: string;
  error_label: string;
  duration_col: string;
  none: string;
  consecutive_failures: string;
  duration: string;
  failure_rate: string;
}

const LABELS: Record<string, LocaleLabels> = {
  es: {
    title: 'Alerta de Job Programado',
    subtitle: 'Se detectó una condición de alerta en el sistema SACDIA.',
    job: 'Job',
    condition_label: 'Condición',
    recent: 'Últimas ejecuciones fallidas',
    run_id_label: 'ID',
    started: 'Iniciado',
    error_label: 'Error',
    duration_col: 'Duración (ms)',
    none: 'Sin mensaje de error',
    consecutive_failures: 'Fallos consecutivos',
    duration: 'Duración excesiva',
    failure_rate: 'Tasa de fallos alta',
  },
  en: {
    title: 'Scheduled Job Alert',
    subtitle: 'An alert condition was detected in the SACDIA system.',
    job: 'Job',
    condition_label: 'Condition',
    recent: 'Recent failed runs',
    run_id_label: 'ID',
    started: 'Started',
    error_label: 'Error',
    duration_col: 'Duration (ms)',
    none: 'No error message',
    consecutive_failures: 'Consecutive failures',
    duration: 'Excessive duration',
    failure_rate: 'High failure rate',
  },
  'pt-BR': {
    title: 'Alerta de Job Agendado',
    subtitle: 'Uma condição de alerta foi detectada no sistema SACDIA.',
    job: 'Job',
    condition_label: 'Condição',
    recent: 'Últimas execuções com falha',
    run_id_label: 'ID',
    started: 'Iniciado',
    error_label: 'Erro',
    duration_col: 'Duração (ms)',
    none: 'Sem mensagem de erro',
    consecutive_failures: 'Falhas consecutivas',
    duration: 'Duração excessiva',
    failure_rate: 'Alta taxa de falhas',
  },
  fr: {
    title: "Alerte de Tâche Planifiée",
    subtitle: "Une condition d'alerte a été détectée dans le système SACDIA.",
    job: 'Tâche',
    condition_label: 'Condition',
    recent: 'Dernières exécutions échouées',
    run_id_label: 'ID',
    started: 'Démarré',
    error_label: 'Erreur',
    duration_col: 'Durée (ms)',
    none: "Pas de message d'erreur",
    consecutive_failures: 'Échecs consécutifs',
    duration: 'Durée excessive',
    failure_rate: "Taux d'échec élevé",
  },
};

/**
 * Email template for automated cron job alerts.
 * Sent to admin users when a job hits consecutive_failures, duration, or failure_rate threshold.
 */
export function CronAlertEmail({
  jobName,
  condition,
  conditionDetail,
  recentFailures,
  locale = 'es',
}: CronAlertEmailProps) {
  const L = LABELS[locale] ?? LABELS['es'];
  const conditionLabel = L[condition];

  return (
    <Layout preview={`[SACDIA] ${L.title}: ${jobName}`}>
      {/* Alert header */}
      <Section
        style={{
          backgroundColor: '#fef2f2',
          border: '1px solid #fecaca',
          borderRadius: '6px',
          padding: '16px',
          marginBottom: '24px',
        }}
      >
        <Text
          style={{
            fontSize: '20px',
            fontWeight: '700',
            color: '#991b1b',
            margin: '0 0 4px',
          }}
        >
          {L.title}
        </Text>
        <Text style={{ color: '#7f1d1d', fontSize: '14px', margin: '0' }}>
          {L.subtitle}
        </Text>
      </Section>

      {/* Job + condition summary */}
      <Section style={{ marginBottom: '24px' }}>
        <Text style={{ fontSize: '14px', color: '#3f3f46', margin: '0 0 8px' }}>
          <strong>{L.job}:</strong>{' '}
          <code
            style={{
              backgroundColor: '#f4f4f5',
              padding: '2px 6px',
              borderRadius: '4px',
              fontSize: '13px',
              fontFamily: 'monospace',
            }}
          >
            {jobName}
          </code>
        </Text>
        <Text style={{ fontSize: '14px', color: '#3f3f46', margin: '0 0 4px' }}>
          <strong>{L.condition_label}:</strong> {conditionLabel}
        </Text>
        <Text style={{ fontSize: '14px', color: '#52525b', margin: '0' }}>
          {conditionDetail}
        </Text>
      </Section>

      <Hr style={{ borderColor: '#e4e4e7', margin: '0 0 20px' }} />

      {/* Recent failures */}
      {recentFailures.length > 0 && (
        <Section>
          <Text
            style={{
              fontSize: '15px',
              fontWeight: '600',
              color: '#18181b',
              margin: '0 0 12px',
            }}
          >
            {L.recent}
          </Text>

          {recentFailures.map((run) => (
            <Section
              key={run.run_id}
              style={{
                backgroundColor: '#fafafa',
                border: '1px solid #e4e4e7',
                borderRadius: '4px',
                padding: '10px 12px',
                marginBottom: '8px',
              }}
            >
              <Text style={{ fontSize: '12px', color: '#71717a', margin: '0 0 4px' }}>
                #{run.run_id} &mdash;{' '}
                {new Date(run.started_at).toLocaleString('es-AR', { timeZone: 'UTC' })} UTC
                {run.duration_ms !== null ? ` (${run.duration_ms} ms)` : ''}
              </Text>
              <Text
                style={{
                  fontSize: '13px',
                  color: '#dc2626',
                  margin: '0',
                  fontFamily: 'monospace',
                  wordBreak: 'break-all',
                }}
              >
                {run.error_message ?? L.none}
              </Text>
            </Section>
          ))}
        </Section>
      )}
    </Layout>
  );
}

export default CronAlertEmail;
