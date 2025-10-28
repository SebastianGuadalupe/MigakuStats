<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { logger } from './utils/logger';
import { setupThemeObserver, setupLanguageObserver } from './utils/observers';
import { SELECTORS, ATTRIBUTES } from './utils/constants';
import { useAppStore } from './stores/app';
import WordCount from './components/WordCount.vue';

const appStore = useAppStore();
const themeObserver = ref<MutationObserver | null>(null);
const languageObserver = ref<MutationObserver | null>(null);

onMounted(() => {
  logger.debug('App component mounted! 🎉');
  const mainElement = document.querySelector(SELECTORS.MIGAKU_MAIN);
  
  if (!mainElement) {
    logger.error('Main Migaku element not found - this should not happen');
    return;
  }
  
  logger.debug('Setting up observers');
  
  themeObserver.value = setupThemeObserver((newTheme) => {
    logger.debug(`Theme changed to: ${newTheme}`);
    appStore.setTheme(newTheme);
  });
  
  languageObserver.value = setupLanguageObserver(mainElement, (newLanguage) => {
    logger.debug(`Language changed to: ${newLanguage}`);
    appStore.setLanguage(newLanguage);
    appStore.resetDeckSelection();
    logger.debug(`Reset deck selection due to language change`);
  });
  
  const currentTheme = document.documentElement.getAttribute(ATTRIBUTES.THEME);
  const currentLanguage = mainElement.getAttribute(ATTRIBUTES.LANG_SELECTED);
  
  if (currentTheme) {
    appStore.setTheme(currentTheme);
  }
  if (currentLanguage) {
    appStore.setLanguage(currentLanguage);
  }

  const componentHash = document.querySelector(SELECTORS.STATISTICS_ELEMENT)?.attributes[0].nodeName;
  if (componentHash) {
    appStore.setComponentHash(componentHash);
  }

  logger.debug(`Component hash: ${componentHash}`);
});

onUnmounted(() => {
  logger.debug('Cleaning up observers');
  
  if (themeObserver.value) {
    themeObserver.value.disconnect();
    themeObserver.value = null;
  }
  
  if (languageObserver.value) {
    languageObserver.value.disconnect();
    languageObserver.value = null;
  }
});
</script>

<template>
  <WordCount />
</template>

<style scoped>
</style>
