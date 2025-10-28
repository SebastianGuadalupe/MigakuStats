import { ATTRIBUTES, APP_SETTINGS } from './constants';
import { logger } from './logger';

export function waitForElement(selector: string, timeout: number = APP_SETTINGS.DEFAULT_TIMEOUT): Promise<Element | null> {
  return new Promise((resolve) => {
    const observer = new MutationObserver((_, obs) => {
      const element = document.querySelector(selector);
      if (element) {
        logger.debug(`Element '${selector}' detected.`);
        obs.disconnect();
        resolve(element);
      }
    });

    const element = document.querySelector(selector);
    if (element) {
      logger.debug(`Element '${selector}' found immediately.`);
      resolve(element);
      return;
    }

    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
      if (!document.querySelector(selector)) {
        observer.disconnect();
        logger.debug(`Element '${selector}' not found via MutationObserver after ${timeout}ms.`);
        resolve(null);
      }
    }, timeout);
  });
}

export function setupThemeObserver(onThemeChange: (newTheme: string | null) => void): MutationObserver {
  logger.debug('Setting up theme change observer');
  
  const themeObserver = new MutationObserver((mutationsList) => {
    for (const mutation of mutationsList) {
      if (
        mutation.type === 'attributes' &&
        mutation.attributeName === ATTRIBUTES.THEME
      ) {
        const newTheme = document.documentElement.getAttribute(ATTRIBUTES.THEME);
        logger.debug(`Theme changed to: ${newTheme}`);
        onThemeChange(newTheme);
        break;
      }
    }
  });

  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: [ATTRIBUTES.THEME],
  });

  logger.debug('Theme change observer attached.');
  return themeObserver;
}

export function setupLanguageObserver(
  mainElement: Element,
  onLanguageChange: (newLanguage: string | null) => void
): MutationObserver {
  logger.debug('Setting up language change observer.');

  const languageObserver = new MutationObserver((mutationsList) => {
    for (const mutation of mutationsList) {
      if (
        mutation.type === 'attributes' &&
        mutation.attributeName === ATTRIBUTES.LANG_SELECTED
      ) {
        const newLanguage = mainElement.getAttribute(ATTRIBUTES.LANG_SELECTED);
        logger.debug(`Language attribute changed to: ${newLanguage}`);
        onLanguageChange(newLanguage);
        break;
      }
    }
  });

  languageObserver.observe(mainElement, {
    attributes: true,
    attributeFilter: [ATTRIBUTES.LANG_SELECTED],
  });

  logger.debug('Language change observer attached.');
  return languageObserver;
}
