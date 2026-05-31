export const RANKING_AXES = {
  administrative: {
    axis_key: 'administrative',
    label: 'Cumplimiento Administrativo',
    sort_order: 1,
  },
  operational: {
    axis_key: 'operational',
    label: 'Vida Operativa del Club',
    sort_order: 2,
  },
} as const;

export type RankingAxisKey = keyof typeof RANKING_AXES;

interface RankingComponentDefinition {
  component_key: string;
  axis_key: RankingAxisKey;
  label: string;
  sort_order: number;
}

export const RANKING_COMPONENTS = {
  annual_evidence_folder: {
    component_key: 'annual_evidence_folder',
    axis_key: 'administrative',
    label: 'Carpeta Anual de Evidencias',
    sort_order: 1,
  },
  monthly_reports_timeliness: {
    component_key: 'monthly_reports_timeliness',
    axis_key: 'administrative',
    label: 'Entrega oportuna de informes mensuales',
    sort_order: 2,
  },
  finance_compliance: {
    component_key: 'finance_compliance',
    axis_key: 'administrative',
    label: 'Cumplimiento financiero',
    sort_order: 3,
  },
  institutional_data_completeness: {
    component_key: 'institutional_data_completeness',
    axis_key: 'administrative',
    label: 'Información institucional completa',
    sort_order: 4,
  },
  activities_registered: {
    component_key: 'activities_registered',
    axis_key: 'operational',
    label: 'Actividades registradas',
    sort_order: 1,
  },
  attendance_participation: {
    component_key: 'attendance_participation',
    axis_key: 'operational',
    label: 'Asistencia y participación',
    sort_order: 2,
  },
  camporee_events: {
    component_key: 'camporee_events',
    axis_key: 'operational',
    label: 'Eventos y camporee',
    sort_order: 3,
  },
  class_investiture_progress: {
    component_key: 'class_investiture_progress',
    axis_key: 'operational',
    label: 'Avance de clases e investiduras',
    sort_order: 4,
  },
  sacdia_operational_usage: {
    component_key: 'sacdia_operational_usage',
    axis_key: 'operational',
    label: 'Uso operativo de SACDIA',
    sort_order: 5,
  },
} as const satisfies Record<string, RankingComponentDefinition>;

export type RankingComponentKey = keyof typeof RANKING_COMPONENTS;

export const RANKING_COMPONENT_ALIASES = {
  annual_folder: 'annual_evidence_folder',
  finance: 'finance_compliance',
  camporee: 'camporee_events',
} as const satisfies Record<string, RankingComponentKey>;

export function normalizeRankingComponentKey(
  componentKey: string,
): RankingComponentKey {
  if (isRankingComponentKey(componentKey)) {
    return componentKey;
  }

  if (isRankingComponentAlias(componentKey)) {
    return RANKING_COMPONENT_ALIASES[componentKey];
  }

  throw new Error(`Unknown annual ranking component key: ${componentKey}`);
}

export function getRankingComponentDefinition(componentKey: string) {
  return RANKING_COMPONENTS[normalizeRankingComponentKey(componentKey)];
}

export function getRankingComponentAxis(componentKey: string): RankingAxisKey {
  return getRankingComponentDefinition(componentKey).axis_key;
}

export function isRankingComponentKey(
  componentKey: string,
): componentKey is RankingComponentKey {
  return Object.prototype.hasOwnProperty.call(RANKING_COMPONENTS, componentKey);
}

function isRankingComponentAlias(
  componentKey: string,
): componentKey is keyof typeof RANKING_COMPONENT_ALIASES {
  return Object.prototype.hasOwnProperty.call(
    RANKING_COMPONENT_ALIASES,
    componentKey,
  );
}
