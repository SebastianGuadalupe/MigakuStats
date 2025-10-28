import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import { fetchReviewHistory, ReviewHistoryResult } from '../utils/database';
const STORAGE_KEY = 'migaku-reviewHistory';

export const useReviewHistoryStore = defineStore('reviewHistory', () => {
  const reviewHistory = ref<ReviewHistoryResult|null>(null);
  const isLoading = ref(false);
  const error = ref('');

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

  async function fetchReviewHistoryIfNeeded(lang: string, deckId: string, periodId = 'reviewHistory1', grouping: 'Days'|'Weeks'|'Months' = 'Days') {
    if (!lang) return;
    isLoading.value = true;
    try {
      const stats = await fetchReviewHistory(lang, deckId, periodId, grouping);
      reviewHistory.value = stats;
      error.value = '';
    } catch (e) {
      error.value = 'Review history fetch failed';
    } finally {
      isLoading.value = false;
    }
  }

  function setReviewHistory(stats: ReviewHistoryResult|null) { reviewHistory.value = stats; }
  function clearReviewHistory() { reviewHistory.value = null; }

  return {
    reviewHistory,
    isLoading,
    error,
    setReviewHistory,
    clearReviewHistory,
    fetchReviewHistoryIfNeeded,
    loadFromStorage,
  };
});
