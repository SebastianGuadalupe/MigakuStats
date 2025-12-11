import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import { fetchCharacterStats as dbFetchCharacterStats, reloadDatabase } from '../utils/database';
import type { CharacterStats } from '../types/Database';
const STORAGE_KEY = 'migaku-characterstats';
const SETTINGS_KEY = 'migaku-characterstats-settings';

export const useCharacterStatsStore = defineStore('characterStats', () => {
  const characterStats = ref<CharacterStats|null>(null);
  const isLoading = ref(false);
  const error = ref('');
  const gridCellWidth = ref(40);
  const selectedGrouping = ref(0);

  function loadSettingsFromStorage() {
    try {
      const data = localStorage.getItem(SETTINGS_KEY);
      if (data) {
        const parsed = JSON.parse(data);
        if (typeof parsed.gridCellWidth === 'number') gridCellWidth.value = parsed.gridCellWidth;
        if (typeof parsed.selectedGrouping === 'number') selectedGrouping.value = parsed.selectedGrouping;
      }
    } catch {}
  }
  function saveSettingsToStorage() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ 
      gridCellWidth: gridCellWidth.value,
      selectedGrouping: selectedGrouping.value
    }));
  }
  function setGridCellWidth(val: number) { gridCellWidth.value = val; }
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
      localStorage.setItem(STORAGE_KEY, JSON.stringify(characterStats.value));
    } catch (err) {
      error.value = 'Failed to save character stats.';
    }
  }
  watch(characterStats, saveToStorage, { deep: true });

  async function fetchCharacterStatsIfNeeded(lang: string) {
    if (!lang) return;
    isLoading.value = true;
    try {
      const stats = await dbFetchCharacterStats(lang);
      if (!stats) throw new Error('No character stats found');
      characterStats.value = stats;
      error.value = '';
    } catch (e) {
      error.value = 'Fetch failed';
    } finally {
      isLoading.value = false;
    }
  }

  async function refetch(lang: string) {
    isLoading.value = true;
    error.value = '';
    characterStats.value = null;
    await reloadDatabase();
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
