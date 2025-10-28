import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import { fetchReviewHistory, ReviewHistoryResult, reloadDatabase } from '../utils/database';
const STORAGE_KEY = 'migaku-reviewHistory';
const SETTINGS_KEY = 'migaku-reviewHistory-settings';

export type PeriodId = "1 Month" | "2 Months" | "3 Months" | "6 Months" | "1 Year" | "All time";
export type Grouping = "Days" | "Weeks" | "Months";

export const useReviewHistoryStore = defineStore('reviewHistory', () => {
  const reviewHistory = ref<ReviewHistoryResult|null>(null);
  const isLoading = ref(false);
  const error = ref('');

  const grouping = ref<Grouping>('Days');
  const periodId = ref<PeriodId>('1 Month');

  function loadSettingsFromStorage() {
    try {
      const data = localStorage.getItem(SETTINGS_KEY);
      if (data) {
        const parsed = JSON.parse(data);
        if (parsed.grouping && ['Days','Weeks','Months'].includes(parsed.grouping)) grouping.value = parsed.grouping;
        if (parsed.periodId && ["1 Month", "2 Months", "3 Months", "6 Months", "1 Year", "All time"].includes(parsed.periodId)) periodId.value = parsed.periodId;
      }
    } catch {}
  }
  function saveSettingsToStorage() {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ grouping: grouping.value, periodId: periodId.value }));
  }
  function setGroupingAndPeriod(newGrouping: Grouping, newPeriodId: PeriodId) {
    grouping.value = newGrouping;
    periodId.value = newPeriodId;
  }
  loadSettingsFromStorage();
  watch([grouping, periodId], saveSettingsToStorage);

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
      localStorage.setItem(STORAGE_KEY, JSON.stringify(reviewHistory.value));
    } catch (err) {
      error.value = 'Failed to save review history.';
    }
  }
  watch(reviewHistory, saveToStorage, { deep: true });

  async function fetchReviewHistoryIfNeeded(lang: string, deckId: string, periodIdParam: PeriodId = periodId.value, groupingParam: Grouping = grouping.value) {
    if (!lang) return;
    isLoading.value = true;
    try {
      const stats = await fetchReviewHistory(lang, deckId, periodIdParam, groupingParam);
      reviewHistory.value = stats;
      error.value = '';
    } catch (e) {
      error.value = 'Review history fetch failed';
    } finally {
      isLoading.value = false;
    }
  }

  async function refetch(lang: string, deckId: string) {
    isLoading.value = true;
    error.value = '';
    reviewHistory.value = null;
    await reloadDatabase();
    await fetchReviewHistoryIfNeeded(lang, deckId, periodId.value, grouping.value);
  }

  function setReviewHistory(stats: ReviewHistoryResult|null) { reviewHistory.value = stats; }
  function clearReviewHistory() { reviewHistory.value = null; }

  return {
    reviewHistory,
    isLoading,
    error,
    grouping,
    periodId,
    setReviewHistory,
    clearReviewHistory,
    fetchReviewHistoryIfNeeded,
    refetch,
    loadFromStorage,
    setGroupingAndPeriod,
    loadSettingsFromStorage,
  };
});
