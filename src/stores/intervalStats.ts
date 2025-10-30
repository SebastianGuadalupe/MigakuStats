import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import { fetchIntervalStats, reloadDatabase } from '../utils/database';
import type { IntervalStats } from '../types/Database';

const STORAGE_KEY = 'migaku-intervalStats';
const SETTINGS_KEY = 'migaku-intervalStats-settings';

export type PercentileId = '50th' | '75th' | '95th' | '100th';

export const useIntervalStatsStore = defineStore('intervalStats', () => {
  const intervalStats = ref<IntervalStats|null>(null);
  const isLoading = ref(false);
  const error = ref('');
  const percentileId = ref<PercentileId>('75th');

  function loadSettingsFromStorage() {
    try {
      const data = localStorage.getItem(SETTINGS_KEY);
      if (data) {
        const parsed = JSON.parse(data);
        if (['50th','75th','95th','100th'].includes(parsed.percentileId)) percentileId.value = parsed.percentileId;
      }
    } catch {}
  }
  function saveSettingsToStorage() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ percentileId: percentileId.value }));
  }
  function setPercentile(newPercentile: PercentileId) {
    percentileId.value = newPercentile;
  }
  loadSettingsFromStorage();
  watch([percentileId], saveSettingsToStorage);

  function loadFromStorage() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) intervalStats.value = JSON.parse(stored);
    } catch (err) {
      error.value = 'Failed to load interval stats.';
    }
  }
  function saveToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(intervalStats.value));
    } catch (err) {
      error.value = 'Failed to save interval stats.';
    }
  }
  watch(intervalStats, saveToStorage, { deep: true });

  async function fetchIntervalStatsIfNeeded(lang: string, deckId: string, percentileParam: PercentileId = percentileId.value) {
    if (!lang) return;
    isLoading.value = true;
    try {
      const stats = await fetchIntervalStats(lang, deckId, percentileParam);
      intervalStats.value = stats;
      error.value = '';
    } catch (e) {
      error.value = 'Interval stats fetch failed';
    } finally {
      isLoading.value = false;
    }
  }

  async function refetch(lang: string, deckId: string) {
    isLoading.value = true;
    error.value = '';
    intervalStats.value = null;
    await reloadDatabase();
    return fetchIntervalStatsIfNeeded(lang, deckId, percentileId.value);
  }

  return {
    intervalStats,
    isLoading,
    error,
    percentileId,
    setPercentile,
    fetchIntervalStatsIfNeeded,
    refetch,
    loadFromStorage,
    loadSettingsFromStorage,
  };
});
