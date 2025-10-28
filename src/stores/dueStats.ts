import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import { fetchDueStats, DueStats, reloadDatabase } from '../utils/database';
const STORAGE_KEY = 'migaku-dueStats';

export const useDueStatsStore = defineStore('dueStats', () => {
  const dueStats = ref<DueStats|null>(null);
  const isLoading = ref(false);
  const error = ref('');

  function loadFromStorage() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) dueStats.value = JSON.parse(stored);
    } catch (err) {
      error.value = 'Failed to load due stats.';
    }
  }
  function saveToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(dueStats.value));
    } catch (err) {
      error.value = 'Failed to save due stats.';
    }
  }
  watch(dueStats, saveToStorage, { deep: true });

  async function fetchDueStatsIfNeeded(lang: string, deckId: string) {
    if (!lang) return;
    isLoading.value = true;
    try {
      const stats = await fetchDueStats(lang, deckId);
      dueStats.value = stats;
      error.value = '';
    } catch (e) {
      error.value = 'Due stats fetch failed';
    } finally {
      isLoading.value = false;
    }
  }

  async function refetch(lang: string, deckId: string) {
    isLoading.value = true;
    error.value = '';
    dueStats.value = null;
    await reloadDatabase();
    return fetchDueStatsIfNeeded(lang, deckId);
  }

  function setDueStats(stats: DueStats|null) { dueStats.value = stats; }
  function clearDueStats() { dueStats.value = null; }

  return {
    dueStats,
    isLoading,
    error,
    setDueStats,
    clearDueStats,
    fetchDueStatsIfNeeded,
    refetch,
    loadFromStorage
  };
});
