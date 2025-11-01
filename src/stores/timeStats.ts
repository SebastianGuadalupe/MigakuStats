import { defineStore } from "pinia";
import { ref, watch } from "vue";
import { fetchTimeHistory, reloadDatabase } from "../utils/database";
import type { TimeHistoryResult } from "../types/Database";
import type { PeriodId, Grouping } from "./reviewHistory";

const STORAGE_KEY = "migaku-timeStats";
const SETTINGS_KEY = "migaku-timeStats-settings";

export const useTimeStatsStore = defineStore("timeStats", () => {
  const timeHistory = ref<TimeHistoryResult | null>(null);
  const isLoading = ref(false);
  const error = ref("");
  const viewMode = ref<"totals" | "averages">("totals");
  const grouping = ref<Grouping>("Days");
  const periodId = ref<PeriodId>("1 Month");

  function loadSettingsFromStorage() {
    try {
      const data = localStorage.getItem(SETTINGS_KEY);
      if (data) {
        const parsed = JSON.parse(data);
        if (
          parsed.viewMode &&
          ["totals", "averages"].includes(parsed.viewMode)
        ) {
          viewMode.value = parsed.viewMode;
        }
        if (
          parsed.grouping &&
          ["Days", "Weeks", "Months"].includes(parsed.grouping)
        ) {
          grouping.value = parsed.grouping;
        }
        if (
          parsed.periodId &&
          [
            "1 Month",
            "2 Months",
            "3 Months",
            "6 Months",
            "1 Year",
            "All time",
          ].includes(parsed.periodId)
        ) {
          periodId.value = parsed.periodId;
        }
      }
    } catch {}
  }

  function saveSettingsToStorage() {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({
        viewMode: viewMode.value,
        grouping: grouping.value,
        periodId: periodId.value,
      })
    );
  }

  function setViewMode(mode: "totals" | "averages") {
    viewMode.value = mode;
  }

  function setGroupingAndPeriod(newGrouping: Grouping, newPeriodId: PeriodId) {
    grouping.value = newGrouping;
    periodId.value = newPeriodId;
  }

  loadSettingsFromStorage();
  watch([viewMode, grouping, periodId], saveSettingsToStorage);

  function loadFromStorage() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) timeHistory.value = JSON.parse(stored);
    } catch (err) {
      error.value = "Failed to load time history.";
    }
  }

  function saveToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(timeHistory.value));
    } catch (err) {
      error.value = "Failed to save time history.";
    }
  }

  watch(timeHistory, saveToStorage, { deep: true });

  async function fetchTimeHistoryIfNeeded(
    lang: string,
    deckId: string,
    periodIdParam: PeriodId = periodId.value,
    groupingParam: Grouping = grouping.value,
    viewModeParam: "totals" | "averages" = viewMode.value
  ) {
    if (!lang) return;
    isLoading.value = true;
    try {
      const stats = await fetchTimeHistory(
        lang,
        deckId,
        periodIdParam,
        groupingParam,
        viewModeParam
      );
      timeHistory.value = stats;
      error.value = "";
    } catch (e) {
      error.value = "Time history fetch failed";
    } finally {
      isLoading.value = false;
    }
  }

  async function refetch(lang: string, deckId: string) {
    isLoading.value = true;
    error.value = "";
    timeHistory.value = null;
    await reloadDatabase();
    await fetchTimeHistoryIfNeeded(
      lang,
      deckId,
      periodId.value,
      grouping.value,
      viewMode.value
    );
  }

  return {
    timeHistory,
    isLoading,
    error,
    viewMode,
    grouping,
    periodId,
    setViewMode,
    setGroupingAndPeriod,
    fetchTimeHistoryIfNeeded,
    refetch,
    loadFromStorage,
    loadSettingsFromStorage,
  };
});
