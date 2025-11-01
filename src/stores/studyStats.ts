import { defineStore } from "pinia";
import { ref, watch } from "vue";
import { fetchStudyStats, reloadDatabase } from "../utils/database";
import type { StudyStats } from "../types/Database";
import type { PeriodId } from "./reviewHistory";

const STORAGE_KEY = "migaku-studyStats";
const SETTINGS_KEY = "migaku-studyStats-settings";

export const useStudyStatsStore = defineStore("studyStats", () => {
  const studyStats = ref<StudyStats | null>(null);
  const isLoading = ref(false);
  const error = ref("");
  const periodId = ref<PeriodId>("1 Month");
  const visibility = ref({
    percGroup: true,
    totalsGroup: true,
    avgsGroup: true,
    timeGroup: true,
    daysStudiedPercent: true,
    passRate: true,
    totalReviews: true,
    avgReviewsPerDay: true,
    totalCardsAdded: true,
    cardsAddedPerDay: true,
    totalNewCards: true,
    newCardsPerDay: true,
    totalCardsLearned: true,
    cardsLearnedPerDay: true,
    totalTimeNewCards: true,
    avgTimeNewCard: true,
    totalTimeReviews: true,
    avgTimeReview: true,
  });

  function loadSettingsFromStorage() {
    try {
      const data = localStorage.getItem(SETTINGS_KEY);
      if (data) {
        const parsed = JSON.parse(data);
        if (
          [
            "1 Month",
            "2 Months",
            "3 Months",
            "6 Months",
            "1 Year",
            "All time",
          ].includes(parsed.periodId)
        )
          periodId.value = parsed.periodId;
        if (parsed.visibility && typeof parsed.visibility === "object")
          visibility.value = { ...visibility.value, ...parsed.visibility };
      }
    } catch {}
  }
  function saveSettingsToStorage() {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ periodId: periodId.value, visibility: visibility.value })
    );
  }
  function setPeriod(newPeriodId: PeriodId) {
    periodId.value = newPeriodId;
  }
  loadSettingsFromStorage();
  watch([periodId, visibility], saveSettingsToStorage, { deep: true });
  function setVisibility(key: keyof typeof visibility.value, value: boolean) {
    visibility.value = { ...visibility.value, [key]: value } as any;
  }
  function setVisibilities(values: Partial<typeof visibility.value>) {
    visibility.value = { ...visibility.value, ...values } as any;
  }

  function loadFromStorage() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) studyStats.value = JSON.parse(stored);
    } catch (err) {
      error.value = "Failed to load study stats.";
    }
  }
  function saveToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(studyStats.value));
    } catch (err) {
      error.value = "Failed to save study stats.";
    }
  }
  watch(studyStats, saveToStorage, { deep: true });

  async function fetchStudyStatsIfNeeded(
    lang: string,
    deckId: string,
    periodParam: PeriodId = periodId.value
  ) {
    if (!lang) return;
    isLoading.value = true;
    try {
      const stats = await fetchStudyStats(lang, deckId, periodParam);
      studyStats.value = stats;
      error.value = "";
    } catch (e) {
      error.value = "Study stats fetch failed";
    } finally {
      isLoading.value = false;
    }
  }

  async function refetch(lang: string, deckId: string) {
    isLoading.value = true;
    error.value = "";
    studyStats.value = null;
    await reloadDatabase();
    return fetchStudyStatsIfNeeded(lang, deckId, periodId.value);
  }

  return {
    studyStats,
    isLoading,
    error,
    periodId,
    visibility,
    setPeriod,
    setVisibility,
    setVisibilities,
    fetchStudyStatsIfNeeded,
    refetch,
    loadFromStorage,
    loadSettingsFromStorage,
  };
});
