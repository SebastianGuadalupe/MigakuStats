import { saveSetting } from '../utils/storage';
import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import { fetchReviewHistory, reloadDatabase } from '../utils/database';
import type { ReviewHistoryResult } from '../types/Database';
const STORAGE_KEY = 'migaku-reviewHistory';
const SETTINGS_KEY = 'migaku-reviewHistory-settings';

export type PeriodId = "1 Month" | "2 Months" | "3 Months" | "6 Months" | "1 Year" | "All time";
export type Grouping = "Days" | "Weeks" | "Months";
export type PassMode = "All passes" | "First try";

export const useReviewHistoryStore = defineStore('reviewHistory', () => {
  const reviewHistory = ref<ReviewHistoryResult|null>(null);
  const isLoading = ref(false);
  let requestId = 0;
  const error = ref('');

  const grouping = ref<Grouping>('Days');
  const periodId = ref<PeriodId>('1 Month');
  const passMode = ref<PassMode>('First try');

  function loadSettingsFromStorage() {
    try {
      const data = localStorage.getItem(SETTINGS_KEY);
      if (data) {
        const parsed = JSON.parse(data);
        if (parsed.grouping && ['Days','Weeks','Months'].includes(parsed.grouping)) grouping.value = parsed.grouping;
        if (parsed.periodId && ["1 Month", "2 Months", "3 Months", "6 Months", "1 Year", "All time"].includes(parsed.periodId)) periodId.value = parsed.periodId;
        if (parsed.passMode && ['All passes', 'First try'].includes(parsed.passMode)) passMode.value = parsed.passMode;
      }
    } catch {}
  }
  function saveSettingsToStorage() {
    saveSetting(SETTINGS_KEY, JSON.stringify({ grouping: grouping.value, periodId: periodId.value, passMode: passMode.value }));
  }
  function setGroupingPeriodAndMode(newGrouping: Grouping, newPeriodId: PeriodId, newPassMode: PassMode) {
    grouping.value = newGrouping;
    periodId.value = newPeriodId;
    passMode.value = newPassMode;
  }
  loadSettingsFromStorage();
  watch([grouping, periodId, passMode], saveSettingsToStorage);

  function loadFromStorage() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) reviewHistory.value = JSON.parse(stored);
    } catch (err) {
      error.value = 'Failed to load review history.';
    }
  }
  function saveToStorage() {
    try {
      saveSetting(STORAGE_KEY, JSON.stringify(reviewHistory.value));
    } catch (err) {
      error.value = 'Failed to save review history.';
    }
  }
  watch(reviewHistory, saveToStorage, { deep: true });

  async function fetchReviewHistoryIfNeeded(
    lang: string,
    deckId: string,
    periodIdParam: PeriodId = periodId.value,
    groupingParam: Grouping = grouping.value,
    passModeParam: PassMode = passMode.value
  ) {
    const currentRequest = ++requestId;
    if (!lang) { isLoading.value = false; return; }
    isLoading.value = true;
    try {
      const stats = await fetchReviewHistory(lang, deckId, periodIdParam, groupingParam, passModeParam);
      if (currentRequest !== requestId) return;
      if (!stats) throw new Error("Statistics could not be loaded");
      reviewHistory.value = stats;
      error.value = '';
    } catch (e) {
      if (currentRequest !== requestId) return;
      reviewHistory.value = null;
      error.value = 'Review history fetch failed';
    } finally {
      if (currentRequest === requestId) isLoading.value = false;
    }
  }

  async function refetch(lang: string, deckId: string) {
    isLoading.value = true;
    error.value = '';
    reviewHistory.value = null;
    void reloadDatabase();
    await fetchReviewHistoryIfNeeded(lang, deckId, periodId.value, grouping.value, passMode.value);
  }

  function setReviewHistory(stats: ReviewHistoryResult|null) { reviewHistory.value = stats; }
  function clearReviewHistory() { reviewHistory.value = null; }

  return {
    reviewHistory,
    isLoading,
    error,
    grouping,
    periodId,
    passMode,
    setReviewHistory,
    clearReviewHistory,
    fetchReviewHistoryIfNeeded,
    refetch,
    loadFromStorage,
    setGroupingPeriodAndMode,
    loadSettingsFromStorage,
  };
});
