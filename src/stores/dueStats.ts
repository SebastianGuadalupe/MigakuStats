import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import { fetchDueStats, DueStats, reloadDatabase } from '../utils/database';
import type { PeriodId } from './reviewHistory';
const STORAGE_KEY = 'migaku-dueStats';
const SETTINGS_KEY = 'migaku-dueStats-settings';

export const useDueStatsStore = defineStore('dueStats', () => {
  const dueStats = ref<DueStats|null>(null);
  const isLoading = ref(false);
  const error = ref('');
  const periodId = ref<PeriodId>('1 Month');

  function loadSettingsFromStorage() {
    try {
      const data = localStorage.getItem(SETTINGS_KEY);
      if (data) {
        const parsed = JSON.parse(data);
        if (parsed.periodId && ["1 Month", "2 Months", "3 Months", "6 Months", "1 Year", "All time"].includes(parsed.periodId)) periodId.value = parsed.periodId;
      }
    } catch {}
  }
  function saveSettingsToStorage() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ periodId: periodId.value }));
  }
  function setPeriod(newPeriodId: PeriodId) {
    periodId.value = newPeriodId;
  }
  loadSettingsFromStorage();
  watch([periodId], saveSettingsToStorage);

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

  async function fetchDueStatsIfNeeded(lang: string, deckId: string, periodIdParam: PeriodId = periodId.value) {
    if (!lang) return;
    isLoading.value = true;
    try {
      const stats = await fetchDueStats(lang, deckId, periodIdParam);
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
    return fetchDueStatsIfNeeded(lang, deckId, periodId.value);
  }

  function setDueStats(stats: DueStats|null) { dueStats.value = stats; }
  function clearDueStats() { dueStats.value = null; }

  return {
    dueStats,
    isLoading,
    error,
    periodId,
    setDueStats,
    clearDueStats,
    fetchDueStatsIfNeeded,
    refetch,
    loadFromStorage,
    setPeriod,
    loadSettingsFromStorage
  };
});
