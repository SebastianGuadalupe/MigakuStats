export const ATTRIBUTES = {
  LANG_SELECTED: "data-mgk-lang-selected",
  THEME: "data-mgk-theme",
} as const;

export const APP_SETTINGS = {
  ENVIRONMENT: "prod",
  DEFAULT_TIMEOUT: 15000,
  DEFAULT_DECK_ID: "all",
} as const;

export const SELECTORS = {
  STATISTICS_ELEMENT: ".Statistic",
  TARGET_ELEMENT: ".UiPageLayout",
  MIGAKU_MAIN: ".MIGAKU-SRS",
  VUE_CONTAINER_ID: "migaku-custom-stats-vue-container",
  ERROR_CONTAINER_ID: "migaku-custom-stats-error",
  HEATMAP: ".Statistic__heatmap"
} as const;

export const ROUTES = {
  STATS_ROUTE: "/statistic",
} as const;

export const WORD_STATUS = {
  KNOWN: "KNOWN",
  LEARNING: "LEARNING",
  UNKNOWN: "UNKNOWN",
  IGNORED: "IGNORED",
} as const;

export const DB_CONFIG = {
  DB_NAME: "srs",
  OBJECT_STORE: "data"
} as const;

export const CHART_CONFIG = {
  FORECAST_DAYS: 30,
  START_YEAR: 2020,
  START_MONTH: 0,
  START_DAY: 1,
  CHART_LABELS: {
    KNOWN: "Known",
    LEARNING: "Learning",
    UNKNOWN: "Unknown",
    IGNORED: "Ignored"
  },
  TOOLTIP_CONFIG: {
    CORNER_RADIUS: 20,
    PADDING: 12,
    CARET_SIZE: 0,
    BOX_PADDING: 4,
  },
  ANIMATION_DELAY: 250
} as const;

export const CHARACTER_STATS = {
  CHARACTER_REGEX: /\p{Unified_Ideograph}/u,
  CHARACTER_STATUS: {
    KNOWN: "KNOWN",
    LEARNING: "LEARNING",
    UNKNOWN: "UNKNOWN",
  }
} as const;