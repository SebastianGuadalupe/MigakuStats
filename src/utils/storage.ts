import { logger } from './logger';
export function saveSetting(key: string, value: string): void {
  try { localStorage.setItem(key, value); }
  catch (error) { logger.warn(`Could not save ${key}`, error); }
}
