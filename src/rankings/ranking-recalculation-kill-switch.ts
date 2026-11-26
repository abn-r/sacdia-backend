/**
 * system_config key that disables the nightly club rankings recalculation and
 * the annual-progress snapshot refresh without a deploy. Only the literal
 * value 'false' disables; a missing row means enabled.
 */
export const RANKING_RECALCULATION_ENABLED_CONFIG_KEY =
  'ranking.recalculation_enabled';
export const RANKING_RECALCULATION_DISABLED_VALUE = 'false';
