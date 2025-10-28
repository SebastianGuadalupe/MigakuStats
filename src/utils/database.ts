import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
import pako from 'pako';
import { logger } from './logger';
import { DB_CONFIG, APP_SETTINGS, CHART_CONFIG } from './constants';
import { WORD_QUERY, WORD_QUERY_WITH_DECK, DUE_QUERY, CURRENT_DATE_QUERY, REVIEW_HISTORY_QUERY } from './sql-queries';
import { Grouping, PeriodId } from '../stores/reviewHistory';

interface DatabaseState {
  sql: SqlJsStatic | null;
  db: Database | null;
  isLoading: boolean;
  error: string | null;
}

const dbState: DatabaseState = {
  sql: null,
  db: null,
  isLoading: false,
  error: null,
};

function initDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    logger.debug(`Opening IndexedDB: ${DB_CONFIG.DB_NAME}`);
    const request = indexedDB.open(DB_CONFIG.DB_NAME);

    request.onerror = (event) => {
      const error = (event.target as IDBRequest).error;
      logger.error(`IndexedDB error: ${error?.message}`);
      reject(new Error(`IndexedDB error: ${error?.message}`));
    };

    request.onsuccess = (event) => {
      const db = (event.target as IDBRequest).result;
      logger.debug(`Connected to IndexedDB: ${DB_CONFIG.DB_NAME}`);
      resolve(db);
    };

    request.onupgradeneeded = () => {
      logger.warn('Database upgrade needed (or first time setup)');
    };
  });
}

function decompressData(compressedData: Uint8Array): Uint8Array | null {
  try {
    logger.debug('Attempting Gzip decompression...');
    const decompressedData = pako.inflate(compressedData);
    logger.debug('Decompression successful');
    return decompressedData;
  } catch (err) {
    logger.error('Gzip decompression failed:', err);
    return null;
  }
}

async function initializeSqlEngine(): Promise<SqlJsStatic | null> {
  try {
    if (dbState.sql) {
      logger.debug('Using existing SQL.js instance');
      return dbState.sql;
    }

    logger.debug('Initializing SQL.js...');
    
    const SQL = await initSqlJs({
      locateFile: (file: string) => {
        logger.debug(`Locating file: ${file}`);
        if (file.endsWith('.wasm')) {
          return 'https://cdn.jsdelivr.net/npm/sql.js@1.13.0/dist/sql-wasm.wasm';
        }
        return file;
      },
    });
    
    if (!SQL) {
      throw new Error('SQL.js initialization returned null');
    }
    
    logger.debug('SQL.js initialized successfully');
    dbState.sql = SQL;
    return SQL;
  } catch (err) {
    logger.error('Failed to initialize SQL.js:', err);
    return null;
  }
}

async function loadDatabase(): Promise<Database | null> {
  try {
    if (dbState.db) {
      logger.debug('Using existing database instance');
      return dbState.db;
    }

    if (dbState.isLoading) {
      logger.debug('Database already loading, waiting...');
      let attempts = 0;
      while (dbState.isLoading && attempts < 50) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        attempts++;
      }
      return dbState.db;
    }

    dbState.isLoading = true;
    dbState.error = null;

    const idb = await initDB();

    if (!idb.objectStoreNames.contains(DB_CONFIG.OBJECT_STORE)) {
      const error = `Object store "${DB_CONFIG.OBJECT_STORE}" not found in database "${DB_CONFIG.DB_NAME}"`;
      logger.error(error);
      logger.error(`Available stores: ${Array.from(idb.objectStoreNames).join(', ')}`);
      dbState.error = error;
      dbState.isLoading = false;
      return null;
    }

    const data = await new Promise<Uint8Array>((resolve, reject) => {
      const transaction = idb.transaction([DB_CONFIG.OBJECT_STORE], 'readonly');
      const objectStore = transaction.objectStore(DB_CONFIG.OBJECT_STORE);
      const getAllRequest = objectStore.getAll();

      transaction.oncomplete = () => {
        logger.debug('Read transaction completed');
      };

      transaction.onerror = (event) => {
        const error = (event.target as IDBRequest).error;
        logger.error('Read transaction error:', error);
        reject(error);
      };

      getAllRequest.onsuccess = (event) => {
        const allRecords = (event.target as IDBRequest).result;
        logger.debug(`Retrieved ${allRecords.length} records from ${DB_CONFIG.OBJECT_STORE}`);

        if (
          !allRecords ||
          allRecords.length === 0 ||
          !allRecords[0]?.data ||
          !(allRecords[0].data instanceof Uint8Array)
        ) {
          reject(new Error('Invalid data structure in IndexedDB'));
          return;
        }

        resolve(allRecords[0].data);
      };

      getAllRequest.onerror = (event) => {
        const error = (event.target as IDBRequest).error;
        logger.error('Error getting record:', error);
        reject(error);
      };
    });

    const decompressedData = decompressData(data);
    if (!decompressedData) {
      dbState.error = 'Failed to decompress database data';
      dbState.isLoading = false;
      return null;
    }

    const SQL = await initializeSqlEngine();
    if (!SQL) {
      dbState.error = 'Failed to initialize SQL.js';
      dbState.isLoading = false;
      return null;
    }

    logger.debug('Loading database into SQL.js...');
    const db = new SQL.Database(decompressedData);
    logger.debug('Database loaded successfully');

    dbState.db = db;
    dbState.isLoading = false;
    return db;
  } catch (err) {
    logger.error('Failed to load database:', err);
    dbState.error = err instanceof Error ? err.message : 'Unknown error';
    dbState.isLoading = false;
    return null;
  }
}

export function clearDatabaseCache(): void {
  logger.debug('Clearing database cache');
  if (dbState.db) {
    try {
      dbState.db.close();
    } catch (err) {
      logger.warn('Error closing database:', err);
    }
    dbState.db = null;
  }
}

export async function reloadDatabase(): Promise<Database | null> {
  logger.debug('Reloading database from IndexedDB');
  clearDatabaseCache();
  return loadDatabase();
}

export interface WordStats {
  known_count: number;
  learning_count: number;
  unknown_count: number;
  ignored_count: number;
}

export async function fetchWordStats(
  language: string,
  deckId: string = APP_SETTINGS.DEFAULT_DECK_ID
): Promise<WordStats | null> {
  try {
    const db = await loadDatabase();
    if (!db) {
      logger.error('Failed to load database');
      return null;
    }

    logger.debug(`Fetching word stats for language: ${language}, deck: ${deckId}`);

    const useDeckFilter = deckId !== APP_SETTINGS.DEFAULT_DECK_ID;
    const wordQuery: string = useDeckFilter ? WORD_QUERY_WITH_DECK : WORD_QUERY;
    const wordQueryParams = useDeckFilter ? [language, deckId] : [language];

    const wordResults = db.exec(wordQuery, wordQueryParams);

    if (wordResults.length > 0 && wordResults[0].values.length > 0) {
      logger.debug('Word query results:', wordResults);
      const numberOfResults = wordResults[0].values[0].length;
      const wordValues: any = {};

      for (let i = 0; i < numberOfResults; i++) {
        wordValues[wordResults[0].columns[i]] = wordResults[0].values[0][i];
      }

      logger.debug('Word stats:', wordValues);
      return wordValues as WordStats;
    } else {
      logger.warn('Word query returned no results');
      return null;
    }
  } catch (error) {
    logger.error('Error fetching word stats:', error);
    return null;
  }
}

export interface DueStats {
  labels: string[];
  counts: number[];
  knownCounts?: number[];
  learningCounts?: number[];
}

export async function fetchDueStats(
  language: string,
  deckId: string = APP_SETTINGS.DEFAULT_DECK_ID
): Promise<DueStats | null> {
  try {
    const db = await loadDatabase();
    if (!db) {
      logger.error('Failed to load database');
      return null;
    }
    let currentDayNumber = 0;
    let currentDate = new Date();
    currentDate.setHours(0,0,0,0);
    try {
      const dateResult = db.exec(CURRENT_DATE_QUERY);
      if (dateResult.length > 0 && dateResult[0].values.length > 0 && dateResult[0].values[0][0]) {
        currentDate = new Date(dateResult[0].values[0][0] + 'T00:00:00');
        currentDate.setHours(0,0,0,0);
      }
    } catch(err) {
      logger.warn('Could not load study.activeDay.currentDate; using system date', err);
    }
    const chartStartDate = new Date(2020, 0, 1, 0, 0, 0, 0);
    currentDayNumber = Math.floor((currentDate.getTime() - chartStartDate.getTime()) / (1000 * 60 * 60 * 24));
    const forecastDays = 30;
    const endDayNumber = currentDayNumber + (forecastDays - 1);
    let dueQuery = DUE_QUERY;
    const params: (string|number)[] = [language, currentDayNumber, endDayNumber];
    if (deckId !== APP_SETTINGS.DEFAULT_DECK_ID) {
      dueQuery += ' AND c.deckId = ?';
      params.push(deckId);
    }
    dueQuery += ' GROUP BY due, interval_range ORDER BY due';
    const dueResults = db.exec(dueQuery, params);
    const labels: string[] = [];
    const knownCounts = new Array(forecastDays).fill(0);
    const learningCounts = new Array(forecastDays).fill(0);
    const counts = new Array(forecastDays).fill(0);
    let d = new Date(currentDate);
    d.setDate(d.getDate() - 0);
    for(let i=0;i<forecastDays;i++) {
      labels.push(d.toLocaleDateString(undefined, {month:'short', day:'numeric', year:'numeric'}));
      d.setDate(d.getDate()+1);
    }
    if(dueResults.length > 0 && dueResults[0].values.length > 0) {
      dueResults[0].values.forEach((row: any[]) => {
        const due = row[0];
        const intervalRange = row[1];
        const count = row[2];
        const dayIndex = due - currentDayNumber;
        if(dayIndex >= 0 && dayIndex < forecastDays) {
          if(intervalRange === 'learning') learningCounts[dayIndex] += count;
          else if(intervalRange === 'known') knownCounts[dayIndex] += count;
          counts[dayIndex] += count;
        }
      });
    }
    return { labels, counts, knownCounts, learningCounts };
  } catch (error) {
    logger.error('Error fetching due stats:', error);
    return null;
  }
}

export interface ReviewHistoryResult {
  labels: string[];
  counts: number[][];
  typeLabels: string[];
}

export async function fetchReviewHistory(
  language: string,
  deckId: string = APP_SETTINGS.DEFAULT_DECK_ID,
  periodId: PeriodId = "1 Month" as const,
  grouping: Grouping = "Days" as const
): Promise<ReviewHistoryResult | null> {
  try {
    const db = await loadDatabase();
    if (!db) {
      logger.error('Failed to load database');
      return null;
    }

    let currentDate = new Date();
    currentDate.setHours(0, 0, 0, 0);
    let currentDayNumber = Math.floor(
      (currentDate.getTime() - new Date(
        CHART_CONFIG.START_YEAR, CHART_CONFIG.START_MONTH, CHART_CONFIG.START_DAY
      ).getTime()) / (1000 * 60 * 60 * 24)
    );

    let period: string | number;
    if (periodId === 'All time') {
      period = 'All';
    } else if (periodId === '1 Year') {
      period = 12;
    } else {
      period = periodId.replace(' Months', '').replace('Months', '');
    }
    
    let periodDays: number;
    if (period === 'All') {
      periodDays = currentDayNumber;
    } else {
      const periodMonths = typeof period === 'number' ? period : parseInt(period, 10) || 1;
      const periodStartDate = new Date(currentDate);
      periodStartDate.setMonth(currentDate.getMonth() - periodMonths);
      periodDays = Math.round((currentDate.getTime() - periodStartDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
    }
    const periodDaysAgoDayNumber = currentDayNumber - periodDays;

    let reviewQuery = REVIEW_HISTORY_QUERY;
    let reviewQueryParams: (string | number)[] = [language, periodDaysAgoDayNumber];
    if (deckId !== APP_SETTINGS.DEFAULT_DECK_ID) {
      reviewQuery = reviewQuery.replace(
        'WHERE ct.lang = ? AND r.day >= ? AND r.del = 0',
        'WHERE ct.lang = ? AND r.day >= ? AND r.del = 0 AND c.deckId = ?'
      );
      reviewQueryParams.push(deckId);
    }
    const reviewResults = db.exec(reviewQuery, reviewQueryParams);

    const dateLabels: string[] = [];
    const type0Counts: number[] = [];
    const type1Counts: number[] = [];
    const type2Counts: number[] = [];
    const dayMap = new Map<number, { index: number }>();
    const aggregateMap = new Map<string, { index: number, data: [number, number, number] }>();

    let actualPeriodDays = periodDays;
    if (period === 'All' && reviewResults.length > 0 && reviewResults[0].values.length > 0) {
      let earliestDayWithReviews = currentDayNumber;
      reviewResults[0].values.forEach(row => {
        const dayNumber = Number(row[0]) ?? 0;
        earliestDayWithReviews = Math.min(earliestDayWithReviews, dayNumber);
      });
      const daysWithData = currentDayNumber - earliestDayWithReviews + 1;
      actualPeriodDays = Math.min(periodDays, daysWithData);
    }

    let currentGroupKey: string | number | null = null;
    let groupIndex = -1;
    const startDate = new Date(CHART_CONFIG.START_YEAR, CHART_CONFIG.START_MONTH, CHART_CONFIG.START_DAY);
    for (let i = 0; i < actualPeriodDays; i++) {
      const dayNumber = currentDayNumber - (actualPeriodDays - 1 - i);
      const date = new Date(startDate);
      date.setDate(date.getDate() + dayNumber);
      date.setHours(0, 0, 0, 0);
      let displayDate;
      let groupKey: string | number;
      if (grouping === 'Weeks') {
        const dayOfWeek = (date.getDay() + 6) % 7;
        const weekStartDate = new Date(date);
        weekStartDate.setDate(date.getDate() - dayOfWeek);
        groupKey = weekStartDate.toISOString().split('T')[0];
        if (groupKey !== currentGroupKey) {
          displayDate = 'Week of ' + weekStartDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
          dateLabels.push(displayDate);
          type0Counts.push(0);
          type1Counts.push(0);
          type2Counts.push(0);
          currentGroupKey = groupKey;
          groupIndex++;
          aggregateMap.set(groupKey, { index: groupIndex, data: [0, 0, 0] });
        }
      } else if (grouping === 'Months') {
        groupKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        if (groupKey !== currentGroupKey) {
          displayDate = date.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
          dateLabels.push(displayDate);
          type0Counts.push(0);
          type1Counts.push(0);
          type2Counts.push(0);
          currentGroupKey = groupKey;
          groupIndex++;
          aggregateMap.set(groupKey, { index: groupIndex, data: [0, 0, 0] });
        }
      } else {
        groupKey = dayNumber;
        displayDate = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
        dateLabels.push(displayDate);
        type0Counts.push(0);
        type1Counts.push(0);
        type2Counts.push(0);
        dayMap.set(dayNumber, { index: i });
      }
    }

    if (reviewResults.length > 0 && reviewResults[0].values.length > 0) {
      reviewResults[0].values.forEach(row => {
        const dayNumber = typeof row[0] === 'number' ? row[0] : Number(row[0]) ?? 0;
        const reviewType = typeof row[1] === 'number' ? row[1] : Number(row[1]) ?? 0;
        const count = typeof row[2] === 'number' ? row[2] : Number(row[2]) ?? 0;
        const date = new Date(startDate);
        date.setDate(date.getDate() + dayNumber);
        date.setHours(0, 0, 0, 0);
        let targetIndex = -1;
        let targetMapEntry: { index: number; data: [number, number, number] } | undefined = undefined;
        if (grouping === 'Weeks') {
          const dayOfWeek = (date.getDay() + 6) % 7;
          const weekStartDate = new Date(date);
          weekStartDate.setDate(date.getDate() - dayOfWeek);
          const groupKey = weekStartDate.toISOString().split('T')[0];
          if (aggregateMap.has(groupKey)) {
            targetMapEntry = aggregateMap.get(groupKey);
            targetIndex = targetMapEntry?.index ?? -1;
          }
        } else if (grouping === 'Months') {
          const groupKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
          if (aggregateMap.has(groupKey)) {
            targetMapEntry = aggregateMap.get(groupKey);
            targetIndex = targetMapEntry?.index ?? -1;
          }
        } else {
          if (dayMap.has(dayNumber)) {
            targetIndex = dayMap.get(dayNumber)?.index ?? -1;
          }
        }
        if (targetIndex !== -1) {
          if (reviewType === 0) {
            if (grouping === 'Days') type0Counts[targetIndex] += count; else if (targetMapEntry) targetMapEntry.data[0] += count;
          } else if (reviewType === 1) {
            if (grouping === 'Days') type1Counts[targetIndex] += count; else if (targetMapEntry) targetMapEntry.data[1] += count;
          } else if (reviewType === 2) {
            if (grouping === 'Days') type2Counts[targetIndex] += count; else if (targetMapEntry) targetMapEntry.data[2] += count;
          }
        }
      });
      if (grouping === 'Weeks' || grouping === 'Months') {
        aggregateMap.forEach(entry => {
          type0Counts[entry.index] = entry.data[0];
          type1Counts[entry.index] = entry.data[1];
          type2Counts[entry.index] = entry.data[2];
        });
      }
    }
    return { labels: dateLabels, counts: [type0Counts, type1Counts, type2Counts], typeLabels: ['New cards', 'Failed reviews', 'Successful reviews'] };
  } catch (error) {
    logger.error('Error fetching review history:', error);
    return null;
  }
}

export function getDatabaseError(): string | null {
  return dbState.error;
}

export function isDatabaseLoading(): boolean {
  return dbState.isLoading;
}

