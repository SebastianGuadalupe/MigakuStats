import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
import { logger } from './logger';
import { KANJI_BY_JLPT_QUERY, KANJI_BY_KANKEN_QUERY, KANJI_BY_JOYO_QUERY } from './sql-queries';
import type { KanjiMetadata } from '../types/Database';

const KANJI_DB_URL = 'https://github.com/migaku-official/Migaku-Kanji-Addon/blob/main/addon/kanji.db?raw=true';

interface KanjiDatabaseState {
  sql: SqlJsStatic | null;
  db: Database | null;
  isLoading: boolean;
  error: string | null;
}

const kanjiDbState: KanjiDatabaseState = {
  sql: null,
  db: null,
  isLoading: false,
  error: null,
};

const filterCache = new Map<number, KanjiMetadata[]>();

async function initializeSqlEngine(): Promise<SqlJsStatic | null> {
  try {
    if (kanjiDbState.sql) {
      logger.debug('Using existing SQL.js instance for kanji DB');
      return kanjiDbState.sql;
    }

    logger.debug('Initializing SQL.js for kanji DB...');
    
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
    
    logger.debug('SQL.js initialized successfully for kanji DB');
    kanjiDbState.sql = SQL;
    return SQL;
  } catch (err) {
    logger.error('Failed to initialize SQL.js for kanji DB:', err);
    return null;
  }
}

async function loadKanjiDatabase(): Promise<Database | null> {
  try {
    if (kanjiDbState.db) {
      logger.debug('Using existing kanji database instance');
      return kanjiDbState.db;
    }

    if (kanjiDbState.isLoading) {
      logger.debug('Kanji database already loading, waiting...');
      let attempts = 0;
      while (kanjiDbState.isLoading && attempts < 50) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        attempts++;
      }
      return kanjiDbState.db;
    }

    kanjiDbState.isLoading = true;
    kanjiDbState.error = null;

    logger.debug('Fetching kanji.db from GitHub...');
    
    const arrayBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
      // @ts-ignore
      GM.xmlHttpRequest({
        method: 'GET',
        url: KANJI_DB_URL,
        responseType: 'arraybuffer',
        onload: (response: any) => {
          if (!response || !response.response) {
            reject(new Error('Empty response when fetching kanji.db'));
            return;
          }
          logger.debug(`Downloaded kanji.db: ${response.response.byteLength} bytes`);
          resolve(response.response as ArrayBuffer);
        },
        onerror: (error: any) => {
          reject(new Error(`Failed to fetch kanji.db: ${error}`));
        },
      });
    });

    const SQL = await initializeSqlEngine();
    if (!SQL) {
      kanjiDbState.error = 'Failed to initialize SQL.js';
      kanjiDbState.isLoading = false;
      return null;
    }

    logger.debug('Loading kanji database into SQL.js...');
    const db = new SQL.Database(new Uint8Array(arrayBuffer));
    logger.debug('Kanji database loaded successfully');

    kanjiDbState.db = db;
    kanjiDbState.isLoading = false;
    return db;
  } catch (err) {
    logger.error('Failed to load kanji database:', err);
    kanjiDbState.error = err instanceof Error ? err.message : 'Unknown error';
    kanjiDbState.isLoading = false;
    return null;
  }
}

export function clearKanjiDatabaseCache(): void {
  logger.debug('Clearing kanji database cache');
  if (kanjiDbState.db) {
    try {
      kanjiDbState.db.close();
    } catch (err) {
      logger.warn('Error closing kanji database:', err);
    }
    kanjiDbState.db = null;
  }
  filterCache.clear();
}

export async function reloadKanjiDatabase(): Promise<Database | null> {
  logger.debug('Reloading kanji database');
  clearKanjiDatabaseCache();
  return loadKanjiDatabase();
}

export async function fetchFilteredKanji(
  filterId: number,
  knownCharacters: string[],
  learningCharacters: string[]
): Promise<KanjiMetadata[]> {
  try {
    if (filterId === 0) {
      const allChars = [...new Set([...knownCharacters, ...learningCharacters])];
      return allChars.map(char => ({ character: char, level: 0 }));
    }

    if (filterCache.has(filterId)) {
      logger.debug(`Using cached filter results for filterId=${filterId}`);
      return filterCache.get(filterId)!;
    }

    const db = await loadKanjiDatabase();
    if (!db) {
      logger.error('Failed to load kanji database');
      return [];
    }

    logger.debug(`Fetching filtered kanji for filterId: ${filterId}`);

    const filterOption = FILTER_OPTIONS.find(opt => opt.id === filterId);
    if (!filterOption || !filterOption.query) {
      logger.warn(`No query defined for filterId: ${filterId}`);
      return [];
    }

    const results = db.exec(filterOption.query);
    
    if (results.length === 0 || results[0].values.length === 0) {
      logger.warn(`No results for filterId: ${filterId}`);
      return [];
    }

    const filteredKanji: KanjiMetadata[] = results[0].values.map((row: any[]) => ({
      character: String(row[0]),
      level: Number(row[1])
    }));

    filterCache.set(filterId, filteredKanji);

    logger.debug(`Fetched ${filteredKanji.length} kanji for filterId: ${filterId}`);
    return filteredKanji;
  } catch (error) {
    logger.error('Error fetching filtered kanji:', error);
    return [];
  }
}

export interface FilterOption {
  id: number;
  label: string;
  levelLabel: (level: number) => string | null;
  query?: string;
}

export const FILTER_OPTIONS: FilterOption[] = [
  {
    id: 0,
    label: 'All Characters',
    levelLabel: () => null,
  },
  {
    id: 1,
    label: 'Jōyō',
    levelLabel: () => null,
    query: KANJI_BY_JOYO_QUERY,
  },
  {
    id: 2,
    label: 'JLPT',
    levelLabel: (level: number) => `N${level}`,
    query: KANJI_BY_JLPT_QUERY,
  },
  {
    id: 3,
    label: 'Kanken',
    levelLabel: (level: number) => `Level ${level}`,
    query: KANJI_BY_KANKEN_QUERY,
  },
];

export function getKanjiDatabaseError(): string | null {
  return kanjiDbState.error;
}

export function isKanjiDatabaseLoading(): boolean {
  return kanjiDbState.isLoading;
}
