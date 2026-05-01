export const ACHIEVEMENT_EVENTS = {
  HONOR_STARTED: 'honor.started',
  // HONOR_COMPLETED was an alias for HONOR_VALIDATED — use HONOR_VALIDATED instead.
  HONOR_VALIDATED: 'honor.validated',
  ACTIVITY_ATTENDED: 'activity.attended',
  CLASS_STARTED: 'class.started',
  CLASS_COMPLETED: 'class.completed',
  CAMPOREE_PARTICIPATED: 'camporee.participated',
  MEMBER_OF_MONTH: 'member_of_month.awarded',
} as const;

export type AchievementEventType =
  (typeof ACHIEVEMENT_EVENTS)[keyof typeof ACHIEVEMENT_EVENTS];

export interface AchievementEventPayload {
  [key: string]: unknown;
}

export interface AchievementEvent {
  userId: string;
  eventType: AchievementEventType | string;
  payload: AchievementEventPayload;
}
