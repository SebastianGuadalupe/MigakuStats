export interface WordStats {
  known_count: number;
  learning_count: number;
  unknown_count: number;
  ignored_count: number;
}

export interface DueStats {
  labels: string[];
  counts: number[];
  knownCounts?: number[];
  learningCounts?: number[];
}

export interface IntervalStats {
  labels: string[];
  counts: number[];
}

export interface StudyStats {
  days_studied: number;
  days_studied_percent: number;
  total_reviews: number;
  avg_reviews_per_calendar_day: number;
  period_days: number;
  pass_rate: number;
  new_cards_per_day: number;
  total_new_cards: number;
  total_cards_added: number;
  cards_added_per_day: number;
  total_cards_learned: number;
  cards_learned_per_day: number;
  total_time_new_cards_seconds: number;
  avg_time_new_card_seconds: number;
  total_time_reviews_seconds: number;
  avg_time_review_seconds: number;
}

export interface ReviewHistoryResult {
  labels: string[];
  counts: number[][];
  typeLabels: string[];
}

export interface TimeHistoryResult {
  labels: string[];
  newCardsTime: number[];
  reviewsTime: number[];
}

export interface WordHistoryResult {
  labels: string[];
  knownCounts: number[];
}
