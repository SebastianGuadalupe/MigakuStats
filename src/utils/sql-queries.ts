import { WORD_STATUS } from "./constants";

export const WORD_QUERY = `
  SELECT
      SUM(CASE WHEN knownStatus = '${WORD_STATUS.KNOWN}' THEN 1 ELSE 0 END) as known_count,
      SUM(CASE WHEN knownStatus = '${WORD_STATUS.LEARNING}' THEN 1 ELSE 0 END) as learning_count,
      SUM(CASE WHEN knownStatus = '${WORD_STATUS.UNKNOWN}' THEN 1 ELSE 0 END) as unknown_count,
      SUM(CASE WHEN knownStatus = '${WORD_STATUS.IGNORED}' THEN 1 ELSE 0 END) as ignored_count
  FROM WordList
  WHERE language = ? AND del = 0`;

export const WORD_QUERY_WITH_DECK = `
  SELECT
    SUM(CASE WHEN w.knownStatus = '${WORD_STATUS.KNOWN}' THEN 1 ELSE 0 END) as known_count,
    SUM(CASE WHEN w.knownStatus = '${WORD_STATUS.LEARNING}' THEN 1 ELSE 0 END) as learning_count,
    SUM(CASE WHEN w.knownStatus = '${WORD_STATUS.UNKNOWN}' THEN 1 ELSE 0 END) as unknown_count,
    SUM(CASE WHEN w.knownStatus = '${WORD_STATUS.IGNORED}' THEN 1 ELSE 0 END) as ignored_count
  FROM (
    SELECT DISTINCT w.dictForm, w.knownStatus
    FROM WordList w
    JOIN CardWordRelation cwr ON w.dictForm = cwr.dictForm
    JOIN card c ON cwr.cardId = c.id
    JOIN deck d ON c.deckId = d.id
    WHERE w.language = ? AND w.del = 0 AND d.id = ? AND c.del = 0
  ) as w`;

export const DECKS_QUERY = `
  SELECT id, name, lang 
  FROM deck 
  WHERE del = 0
  ORDER BY name;`;

export const DUE_QUERY = `
  SELECT
    due,
    CASE
      WHEN c.interval < 20 THEN 'learning'
      ELSE 'known'
    END as interval_range,
    COUNT(*) as count
  FROM card c
  JOIN card_type ct ON c.cardTypeId = ct.id
  WHERE ct.lang = ? AND c.due BETWEEN ? AND ? AND c.del = 0`;

export const INTERVAL_QUERY = `
  SELECT
    ROUND(interval) as interval_group,
    COUNT(*) as count
  FROM card c
  JOIN card_type ct ON c.cardTypeId = ct.id
  WHERE ct.lang = ? AND c.del = 0 AND c.interval > 0
  GROUP BY interval_group
  ORDER BY interval_group`;

export const REVIEW_HISTORY_QUERY = `
  SELECT 
    r.day,
    r.type,
    COUNT(DISTINCT r.cardId) as review_count
  FROM review r
  JOIN card c ON r.cardId = c.id
  JOIN card_type ct ON c.cardTypeId = ct.id
  JOIN reviewHistory rh ON r.day = rh.day
  WHERE ct.lang = ? AND r.day >= ? AND r.del = 0
  GROUP BY r.day, r.type
  ORDER BY r.day DESC, r.type`;

export const STUDY_STATS_QUERY = `
  SELECT 
    COUNT(DISTINCT r.day) as days_studied,
    COUNT(*) as total_reviews
  FROM review r
  JOIN card c ON r.cardId = c.id
  JOIN card_type ct ON c.cardTypeId = ct.id
  WHERE ct.lang = ? AND r.day BETWEEN ? AND ? AND r.del = 0`;

export const CURRENT_DATE_QUERY = `
  SELECT entry 
  FROM keyValue
  WHERE key = 'study.activeDay.currentDate';`;

export const PASS_RATE_QUERY = `
  SELECT 
    SUM(CASE WHEN r.type = 2 THEN 1 ELSE 0 END) as successful_reviews,
    SUM(CASE WHEN r.type = 1 THEN 1 ELSE 0 END) as failed_reviews
  FROM review r
  JOIN card c ON r.cardId = c.id
  JOIN card_type ct ON c.cardTypeId = ct.id
  WHERE ct.lang = ? AND r.day BETWEEN ? AND ? AND r.del = 0 AND r.type IN (1, 2);`;

export const NEW_CARDS_QUERY = `
  SELECT 
    COUNT(DISTINCT r.cardId) as new_cards_reviewed
  FROM review r
  JOIN card c ON r.cardId = c.id
  JOIN card_type ct ON c.cardTypeId = ct.id
  WHERE ct.lang = ? AND r.day BETWEEN ? AND ? AND r.del = 0 AND r.type = 0;`;

export const CARDS_ADDED_QUERY = `
  SELECT 
    COUNT(*) as cards_added
  FROM card c
  JOIN card_type ct ON c.cardTypeId = ct.id
  WHERE ct.lang = ? AND c.created >= ? AND c.created <= ? AND c.del = 0 AND c.lessonId = '';`;

export const CARDS_LEARNED_QUERY = `
  SELECT 
    COUNT(DISTINCT c.id) as cards_learned
  FROM review r
  JOIN card c ON r.cardId = c.id
  JOIN card_type ct ON c.cardTypeId = ct.id
  WHERE ct.lang = ? AND r.day BETWEEN ? AND ? AND r.del = 0 
    AND c.interval >= 20 AND r.interval < 20 AND r.type = 2;`;

export const TOTAL_NEW_CARDS_QUERY = `
  SELECT 
    COUNT(DISTINCT r.cardId) as total_new_cards
  FROM review r
  JOIN card c ON r.cardId = c.id
  JOIN card_type ct ON c.cardTypeId = ct.id
  WHERE ct.lang = ? AND r.day BETWEEN ? AND ? AND c.del = 0 AND r.del = 0 AND r.type = 0;`;

export const CARDS_LEARNED_PER_DAY_QUERY = `
  SELECT 
    ROUND(COUNT(DISTINCT c.id) * 1.0 / NULLIF(COUNT(DISTINCT r.day), 0), 1) as cards_learned_per_day
  FROM review r
  JOIN card c ON r.cardId = c.id
  JOIN card_type ct ON c.cardTypeId = ct.id
  WHERE ct.lang = ? AND r.day BETWEEN ? AND ? AND r.del = 0 
    AND c.interval >= 20 AND r.interval < 20 AND r.type = 2;`;

export const NEW_CARDS_TIME_QUERY = `
  SELECT 
    SUM(r.duration) as total_time_seconds,
    COUNT(*) as review_count,
    ROUND(AVG(r.duration), 1) as avg_time_seconds
  FROM review r
  JOIN card c ON r.cardId = c.id
  JOIN card_type ct ON c.cardTypeId = ct.id
  WHERE ct.lang = ? AND r.day BETWEEN ? AND ? AND r.del = 0 AND r.type = 0;`;

export const REVIEWS_TIME_QUERY = `
  SELECT 
    SUM(r.duration) as total_time_seconds,
    COUNT(*) as review_count,
    ROUND(AVG(r.duration), 1) as avg_time_seconds
  FROM review r
  JOIN card c ON r.cardId = c.id
  JOIN card_type ct ON c.cardTypeId = ct.id
  WHERE ct.lang = ? AND r.day BETWEEN ? AND ? AND r.del = 0 AND r.type IN (1, 2);`;

export const TIME_HISTORY_QUERY = `
  SELECT 
    r.day,
    CASE 
      WHEN r.type = 0 THEN 'new_cards'
      WHEN r.type IN (1, 2) THEN 'reviews'
      ELSE 'other'
    END as review_type,
    SUM(r.duration) as total_time_seconds,
    ROUND(AVG(r.duration), 1) as avg_time_seconds,
    COUNT(*) as review_count
  FROM review r
  JOIN card c ON r.cardId = c.id
  JOIN card_type ct ON c.cardTypeId = ct.id
  JOIN reviewHistory rh ON r.day = rh.day
  WHERE ct.lang = ? AND r.day >= ? AND r.del = 0 AND r.type IN (0, 1, 2)
  GROUP BY r.day, review_type
  ORDER BY r.day DESC, review_type`;

export const WORD_HISTORY_QUERY = `
  SELECT 
    wh.day,
    wh.dictForm,
    wh.secondary,
    wh.partOfSpeech,
    wh.knownStatus,
    wh.prevKnownStatus
  FROM wordHistory wh
  WHERE wh.language = ? AND wh.day >= ? AND wh.del = 0
  ORDER BY wh.day ASC, wh.dictForm, wh.secondary, wh.partOfSpeech`;

export const WORD_HISTORY_QUERY_WITH_DECK = `
  SELECT DISTINCT
    wh.day,
    wh.dictForm,
    wh.secondary,
    wh.partOfSpeech,
    wh.knownStatus,
    wh.prevKnownStatus
  FROM wordHistory wh
  JOIN CardWordRelation cwr ON wh.dictForm = cwr.dictForm
  JOIN card c ON cwr.cardId = c.id
  JOIN deck d ON c.deckId = d.id
  WHERE wh.language = ? AND wh.day >= ? AND wh.del = 0 AND d.id = ? AND c.del = 0
  ORDER BY wh.day ASC, wh.dictForm, wh.secondary, wh.partOfSpeech`;
