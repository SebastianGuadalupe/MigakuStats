import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import { fetchWordStats as dbFetchWordStats } from '../utils/database';
const STORAGE_KEY = 'migaku-wordstats';

export const useWordStatsStore = defineStore('wordStats', () => {
  const wordStats = ref(null);
  const isLoading = ref(false);
  const error = ref('');

  function loadFromStorage() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) wordStats.value = JSON.parse(stored);
    } catch (err) {
      error.value = 'Failed to load word stats.';
    }
  }
  function saveToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(wordStats.value));
    } catch (err) {
      error.value = 'Failed to save word stats.';
    }
  }
  watch(wordStats, saveToStorage, { deep: true });

  async function fetchWordStatsIfNeeded(lang: string, deckId: string) {
    if (!lang) return;
    isLoading.value = true;
    try {
      const stats = await dbFetchWordStats(lang, deckId);
      wordStats.value = stats;
      error.value = '';
    } catch (e) {
      error.value = 'Fetch failed';
    } finally {
      isLoading.value = false;
    }
  }

  function setWordStats(stats: any) {
    wordStats.value = stats;
  }
  function clearWordStats() {
    wordStats.value = null;
  }

  return {
    wordStats,
    isLoading,
    error,
    setWordStats,
    clearWordStats,
    fetchWordStatsIfNeeded,
    loadFromStorage
  };
});
