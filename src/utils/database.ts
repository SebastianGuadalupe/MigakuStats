import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
import pako from 'pako';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { logger } from './logger';
import { DB_CONFIG, APP_SETTINGS } from './constants';
import { WORD_QUERY, WORD_QUERY_WITH_DECK } from './sql-queries';

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
          return wasmUrl;
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

export function getDatabaseError(): string | null {
  return dbState.error;
}

export function isDatabaseLoading(): boolean {
  return dbState.isLoading;
}

