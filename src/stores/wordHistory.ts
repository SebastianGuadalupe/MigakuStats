import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import { fetchWordHistory, reloadDatabase } from '../utils/database';
import type { WordHistoryResult } from '../types/Database';
import type { PeriodId, Grouping } from './reviewHistory';

const STORAGE_KEY = 'migaku-wordHistory';
const SETTINGS_KEY = 'migaku-wordHistory-settings';

export const useWordHistoryStore = defineStore('wordHistory', () => {
  const wordHistory = ref<WordHistoryResult|null>(null);
  const isLoading = ref(false);
  const error = ref('');
  const viewMode = ref<'cumulative' | 'daily'>('daily');
  const grouping = ref<Grouping>('Days');
  const periodId = ref<PeriodId>('1 Month');
  
  const offsetSettings = ref<Record<string, { enabled: boolean; offset: number }>>({});

  function loadSettingsFromStorage() {
    try {
      const data = localStorage.getItem(SETTINGS_KEY);
      if (data) {
        const parsed = JSON.parse(data);
        if (parsed.viewMode && ['cumulative', 'daily'].includes(parsed.viewMode)) {
          viewMode.value = parsed.viewMode;
        }
        if (parsed.grouping && ['Days','Weeks','Months'].includes(parsed.grouping)) {
          grouping.value = parsed.grouping;
        }
        if (parsed.periodId && ["1 Month", "2 Months", "3 Months", "6 Months", "1 Year", "All time"].includes(parsed.periodId)) {
          periodId.value = parsed.periodId;
        }
        if (parsed.offsetSettings && typeof parsed.offsetSettings === 'object') {
          offsetSettings.value = parsed.offsetSettings;
        }
      }
    } catch {}
  }

  function saveSettingsToStorage() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ 
      viewMode: viewMode.value, 
      grouping: grouping.value, 
      periodId: periodId.value,
      offsetSettings: offsetSettings.value
    }));
  }
  
  function getOffsetForLanguage(language: string): { enabled: boolean; offset: number } {
    return offsetSettings.value[language] || { enabled: false, offset: 0 };
  }
  
  function setOffsetForLanguage(language: string, enabled: boolean, offset: number) {
    offsetSettings.value[language] = { enabled, offset };
    saveSettingsToStorage();
  }

  function setViewMode(mode: 'cumulative' | 'daily') {
    viewMode.value = mode;
  }

  function setGroupingAndPeriod(newGrouping: Grouping, newPeriodId: PeriodId) {
    grouping.value = newGrouping;
    periodId.value = newPeriodId;
  }

  loadSettingsFromStorage();
  watch([viewMode, grouping, periodId, offsetSettings], saveSettingsToStorage, { deep: true });

  function loadFromStorage() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) wordHistory.value = JSON.parse(stored);
    } catch (err) {
      error.value = 'Failed to load word history.';
    }
  }

  function saveToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(wordHistory.value));
    } catch (err) {
      error.value = 'Failed to save word history.';
    }
  }

  watch(wordHistory, saveToStorage, { deep: true });

  async function fetchWordHistoryIfNeeded(
    lang: string, 
    deckId: string, 
    periodIdParam: PeriodId = periodId.value, 
    groupingParam: Grouping = grouping.value,
    viewModeParam: 'cumulative' | 'daily' = viewMode.value
  ) {
    if (!lang) return;
    isLoading.value = true;
    try {
      const stats = await fetchWordHistory(lang, deckId, periodIdParam, groupingParam, viewModeParam);
      wordHistory.value = stats;
      error.value = '';
    } catch (e) {
      error.value = 'Word history fetch failed';
    } finally {
      isLoading.value = false;
    }
  }

  async function refetch(lang: string, deckId: string) {
    isLoading.value = true;
    error.value = '';
    wordHistory.value = null;
    await reloadDatabase();
    await fetchWordHistoryIfNeeded(lang, deckId, periodId.value, grouping.value, viewMode.value);
  }

  function setWordHistory(stats: WordHistoryResult|null) { 
    wordHistory.value = stats; 
  }
  
  function clearWordHistory() { 
    wordHistory.value = null; 
  }

  return {
    wordHistory,
    isLoading,
    error,
    viewMode,
    grouping,
    periodId,
    offsetSettings,
    setWordHistory,
    clearWordHistory,
    fetchWordHistoryIfNeeded,
    refetch,
    loadFromStorage,
    setGroupingAndPeriod,
    setViewMode,
    loadSettingsFromStorage,
    getOffsetForLanguage,
    setOffsetForLanguage,
  };
});
