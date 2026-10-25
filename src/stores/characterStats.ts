import { saveSetting } from '../utils/storage';
import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import { fetchCharacterStats as dbFetchCharacterStats, reloadDatabase } from '../utils/database';
import type { CharacterStats } from '../types/Database';
const STORAGE_KEY = 'migaku-characterstats';
const SETTINGS_KEY = 'migaku-characterstats-settings';

export const useCharacterStatsStore = defineStore('characterStats', () => {
  const characterStats = ref<CharacterStats|null>(null);
  const isLoading = ref(false);
  let requestId = 0;
  const error = ref('');
  const gridCellWidth = ref(40);
  const selectedGrouping = ref(0);

  function loadSettingsFromStorage() {
    try {
      const data = localStorage.getItem(SETTINGS_KEY);
      if (data) {
        const parsed = JSON.parse(data);
        if (Number.isFinite(parsed.gridCellWidth)) gridCellWidth.value = Math.max(40, Math.min(80, parsed.gridCellWidth));
        if ([0, 1, 2, 3].includes(parsed.selectedGrouping)) selectedGrouping.value = parsed.selectedGrouping;
      }
    } catch {}
  }
  function saveSettingsToStorage() {
    saveSetting(SETTINGS_KEY, JSON.stringify({
      gridCellWidth: gridCellWidth.value,
      selectedGrouping: selectedGrouping.value
    }));
  }
  function setGridCellWidth(val: number) { if (Number.isFinite(val)) gridCellWidth.value = Math.max(40, Math.min(80, val)); }
  function setSelectedGrouping(val: number) { selectedGrouping.value = val; }
  loadSettingsFromStorage();
  watch([gridCellWidth, selectedGrouping], saveSettingsToStorage);

  function loadFromStorage() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) characterStats.value = JSON.parse(stored);
    } catch (err) {
      error.value = 'Failed to load character stats.';
    }
  }
  function saveToStorage() {
    try {
      saveSetting(STORAGE_KEY, JSON.stringify(characterStats.value));
    } catch (err) {
      error.value = 'Failed to save character stats.';
    }
  }
  watch(characterStats, saveToStorage, { deep: true });

  async function fetchCharacterStatsIfNeeded(lang: string) {
    const currentRequest = ++requestId;
    if (!lang) { isLoading.value = false; return; }
    isLoading.value = true;
    try {
      const stats = await dbFetchCharacterStats(lang);
      if (currentRequest !== requestId) return;
      if (!stats) throw new Error("Statistics could not be loaded");
      if (!stats) throw new Error('No character stats found');
      characterStats.value = stats;
      error.value = '';
    } catch (e) {
      if (currentRequest !== requestId) return;
      characterStats.value = null;
      error.value = 'Fetch failed';
    } finally {
      if (currentRequest === requestId) isLoading.value = false;
    }
  }

  async function refetch(lang: string) {
    isLoading.value = true;
    error.value = '';
    characterStats.value = null;
    void reloadDatabase();
    return fetchCharacterStatsIfNeeded(lang);
  }

  function setCharacterStats(stats: any) {
    characterStats.value = stats;
  }
  function clearCharacterStats() {
    characterStats.value = null;
  }

  return {
    characterStats,
    isLoading,
    error,
    gridCellWidth,
    selectedGrouping,
    setGridCellWidth,
    setSelectedGrouping,
    setCharacterStats,
    clearCharacterStats,
    fetchCharacterStatsIfNeeded,
    refetch,
    loadFromStorage,
    loadSettingsFromStorage
  };
});
