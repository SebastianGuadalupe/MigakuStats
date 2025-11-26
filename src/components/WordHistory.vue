<script setup lang="ts">
import {
  computed,
  ref,
  watch,
  onMounted,
  onBeforeUnmount,
  nextTick,
} from "vue";
import { useAppStore } from "../stores/app";
import { useWordHistoryStore } from "../stores/wordHistory";
import { Line, Bar } from "vue-chartjs";
import {
  Chart as ChartJS,
  LineElement,
  BarElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
} from "chart.js";
import { THEME_CONFIGS } from "../utils/theme";
import { CHART_CONFIG } from "../utils/constants";
import { useCardsStore } from "../stores/cards";
import FloatingMenuButton from "./FloatingMenuButton.vue";

ChartJS.register(
  LineElement,
  BarElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend
);

const appStore = useAppStore();
const cardsStore = useCardsStore();
const componentHash = computed(() => appStore.componentHash || "");
const theme = computed(() => appStore.theme || "dark");
const themeColors = computed(
  () => THEME_CONFIGS[theme.value.toUpperCase() as keyof typeof THEME_CONFIGS]
);

const wordHistoryStore = useWordHistoryStore();
const wordHistory = computed(() => wordHistoryStore.wordHistory);
const isLoading = computed(() => wordHistoryStore.isLoading);
const error = computed(() => wordHistoryStore.error);
const language = computed(() => appStore.language);
const selectedDeckId = computed(() => appStore.selectedDeckId);
const viewMode = computed({
  get: () =>
    wordHistoryStore.viewMode === "cumulative" ? "Cumulative" : "Daily snapshot",
  set: (v) =>
    wordHistoryStore.setViewMode(v === "Cumulative" ? "cumulative" : "daily"),
});
const grouping = computed({
  get: () => wordHistoryStore.grouping,
  set: (v) =>
    wordHistoryStore.setGroupingAndPeriod(v, wordHistoryStore.periodId),
});
const periodId = computed({
  get: () => wordHistoryStore.periodId,
  set: (v) =>
    wordHistoryStore.setGroupingAndPeriod(wordHistoryStore.grouping, v),
});

const wordHistoryContainer = ref<HTMLElement | null>(null);
const shouldHideDates = ref(false);
const shouldHideLateralLabels = ref(false);

function checkResize() {
  if (!wordHistoryContainer.value) return;
  let hideDates = false;
  const wordHistoryCard = cardsStore.cards.find(
    (c) => c.item.i === "WordHistory"
  );
  if (wordHistoryCard && wordHistoryCard.item.h <= 5) {
    hideDates = true;
  } else {
    hideDates = false;
  }
  if (wordHistoryCard && wordHistoryCard.item.w <= 4) {
    shouldHideLateralLabels.value = true;
  } else {
    shouldHideLateralLabels.value = false;
  }
  shouldHideDates.value = hideDates;
}

onMounted(async () => {
  window.addEventListener("resize", checkResize);
  nextTick(() => {
    checkResize();
  });
  if (language.value) {
    await wordHistoryStore.refetch(language.value, selectedDeckId.value);
  }
});
onBeforeUnmount(() => {
  window.removeEventListener("resize", checkResize);
});

const offsetForLanguage = computed(() => wordHistoryStore.getOffsetForLanguage(language.value || ''));

watch(
  [wordHistory, isLoading, error, () => cardsStore],
  async () => {
    await nextTick();
    checkResize();
  },
  { deep: true }
);

watch(
  [language, selectedDeckId, periodId, grouping, () => wordHistoryStore.viewMode],
  async ([lang, deckId, period, group, mode], _prev, onCleanup) => {
    if (!lang) return;
    const fetchPromise = wordHistoryStore.fetchWordHistoryIfNeeded(
      lang,
      deckId,
      period,
      group,
      mode
    );
    let cancelled = false;
    onCleanup(() => (cancelled = true));
    await fetchPromise;
    if (cancelled) return;
  },
  { deep: true }
);

const chartData = computed(() => {
  if (
    !wordHistory.value ||
    !wordHistory.value.labels ||
    !wordHistory.value.knownCounts
  ) {
    return { labels: [], datasets: [] };
  }
  const { labels, knownCounts } = wordHistory.value;
  const isCumulative = wordHistoryStore.viewMode === "cumulative";
  
  const offset = isCumulative && offsetForLanguage.value.enabled ? offsetForLanguage.value.offset : 0;
  const adjustedCounts = offset !== 0 ? knownCounts.map(count => count + offset) : knownCounts;
  
  const datasets: any[] = isCumulative
    ? [
        {
          type: "line",
          label: "Known Words",
          data: adjustedCounts,
          borderColor: themeColors.value.accent1,
          backgroundColor: themeColors.value.accent1 + "20",
          borderWidth: 2,
          pointRadius: 3,
          pointHoverRadius: 5,
          pointBackgroundColor: themeColors.value.accent1,
          pointBorderColor: themeColors.value.accent1,
          tension: 0.4,
          fill: false,
        },
      ]
    : [
        {
          type: "bar",
          label: "Known Words",
          data: knownCounts,
          backgroundColor: themeColors.value.accent1,
          borderWidth: 0,
          borderRadius: 4,
        },
      ];

  return { labels, datasets };
});

const chartOptions = computed(() => {
  const isCumulative = wordHistoryStore.viewMode === "cumulative";
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: {
      duration: 800,
      easing: "easeOutQuart" as const,
    },
    scales: {
      y: {
        beginAtZero: isCumulative,
        stacked: !isCumulative,
        title: {
          display: !shouldHideLateralLabels.value,
          text: "Words",
          color: themeColors.value.textColor,
        },
        ticks: {
          color: themeColors.value.textColor,
          precision: 0,
          display: !shouldHideLateralLabels.value,
        },
        grid: {
          color: themeColors.value.gridColor,
        },
      },
      x: {
        stacked: !isCumulative,
        title: {
          display: !shouldHideDates.value,
          text: "Date",
          color: themeColors.value.textColor,
        },
        ticks: {
          color: themeColors.value.textColor,
          maxRotation: 45,
          minRotation: 45,
          display: !shouldHideDates.value,
        },
        grid: {
          color: themeColors.value.gridColor,
        },
      },
    },
    plugins: {
      legend: {
        display: false,
      },
      tooltip: {
        mode: "index" as const,
        intersect: false,
        callbacks: {
          title: function (tooltipItems: any) {
            return tooltipItems[0].label;
          },
          label: function (context: any) {
            const datasetLabel = context.dataset.label || "";
            const value = context.parsed.y;
            return `${datasetLabel}: ${value}`;
          },
        },
        backgroundColor: themeColors.value.backgroundElevation2,
        titleFontColor: themeColors.value.textColor,
        caretSize: CHART_CONFIG.TOOLTIP_CONFIG.CARET_SIZE,
        padding: CHART_CONFIG.TOOLTIP_CONFIG.PADDING,
        cornerRadius: CHART_CONFIG.TOOLTIP_CONFIG.CORNER_RADIUS,
        boxPadding: CHART_CONFIG.TOOLTIP_CONFIG.BOX_PADDING,
        multiKeyBackground: themeColors.value.backgroundElevation1,
        bodyColor: themeColors.value.textColor,
        footerColor: themeColors.value.textColor,
        titleColor: themeColors.value.textColor,
      },
    },
  };
});

const wordHistoryMenuSettings = computed(() => {
  const baseSettings: Array<{
    key: string;
    label: string;
    type: "dropdown" | "radio" | "switch" | "group" | "number";
    options?: string[];
    value: any;
    displayPrefix?: string;
    min?: number;
    max?: number;
    step?: number;
    children?: Array<{
      key: string;
      label: string;
      type: "dropdown" | "radio" | "switch" | "number";
      options?: string[];
      value: any;
      min?: number;
      max?: number;
      step?: number;
    }>;
  }> = [
    {
      key: "grouping",
      label: "Grouping",
      type: "dropdown" as const,
      options: ["Days", "Weeks", "Months"],
      value: grouping.value,
    },
    {
      key: "periodId",
      label: "Period",
      type: "dropdown" as const,
      options: [
        "1 Month",
        "2 Months",
        "3 Months",
        "6 Months",
        "1 Year",
        "All time",
      ],
      value: periodId.value,
      displayPrefix: "Last ",
    },
    {
      key: "viewMode",
      label: "Show",
      type: "dropdown" as const,
      options: ["Daily snapshot", "Cumulative"],
      value: viewMode.value,
    },
  ];

  if (wordHistoryStore.viewMode === "cumulative") {
    baseSettings.push({
      key: "cumulativeOffset",
      label: "Cumulative Offset",
      type: "group" as const,
      value: offsetForLanguage.value.enabled,
      children: [
        {
          key: "cumulativeOffsetValue",
          label: "Offset",
          type: "number" as const,
          value: offsetForLanguage.value.offset,
          min: 0,
          step: 1,
        },
      ],
    });
  }

  return baseSettings;
});

const menuSettingValues = computed(() => ({
  grouping: grouping.value,
  periodId: periodId.value,
  viewMode: viewMode.value,
  cumulativeOffset: offsetForLanguage.value.enabled,
  cumulativeOffsetValue: offsetForLanguage.value.offset,
}));

function updateMenuSettings(newVals: {
  grouping?: "Days" | "Weeks" | "Months";
  periodId?:
    | "1 Month"
    | "2 Months"
    | "3 Months"
    | "6 Months"
    | "1 Year"
    | "All time";
  viewMode?: "Cumulative" | "Daily snapshot";
  cumulativeOffset?: boolean;
  cumulativeOffsetValue?: number;
}) {
  if (newVals.grouping !== undefined || newVals.periodId !== undefined) {
    wordHistoryStore.setGroupingAndPeriod(
      newVals.grouping ?? grouping.value,
      newVals.periodId ?? periodId.value
    );
  }
  if (newVals.viewMode !== undefined) {
    const storeValue =
      newVals.viewMode === "Cumulative" ? "cumulative" : "daily";
    wordHistoryStore.setViewMode(storeValue);
  }
  if (newVals.cumulativeOffset !== undefined || newVals.cumulativeOffsetValue !== undefined) {
    const currentOffset = offsetForLanguage.value;
    const enabled = newVals.cumulativeOffset !== undefined ? newVals.cumulativeOffset : currentOffset.enabled;
    const offset = newVals.cumulativeOffsetValue !== undefined ? (newVals.cumulativeOffsetValue || 0) : currentOffset.offset;
    if (language.value) {
      wordHistoryStore.setOffsetForLanguage(language.value, enabled, offset);
    }
  }
}
</script>

<template>
  <div
    :[componentHash]="true"
    class="UiCard -lesson Statistic__card"
    ref="wordHistoryContainer"
  >
    <h3
      :[componentHash]="true"
      class="UiTypo UiTypo__heading3 -heading Statistic__title"
    >
      Known Word History
    </h3>
    <div
      style="
        height: calc(100% - 56px);
        min-width: 100%;
        display: flex;
        align-items: flex-end;
        justify-content: center;
        position: relative;
      "
    >
      <template
        v-if="
          wordHistory &&
          wordHistory.labels &&
          wordHistory.knownCounts &&
          !isLoading &&
          !error
        "
      >
        <Line
          v-if="wordHistoryStore.viewMode === 'cumulative'"
          :data="chartData"
          :options="chartOptions"
          style="width: 100%; height: 100%"
        />
        <Bar
          v-else
          :data="chartData"
          :options="chartOptions"
          style="width: 100%; height: 100%"
        />
      </template>
      <template v-else-if="isLoading">
        <div class="MCS__word-history-skeleton-container">
          <div class="MCS__word-history-skeleton-chart">
            <div
              v-for="n in 30"
              :key="n"
              class="MCS__word-history-skeleton-bar"
              :style="{
                height: `${Math.floor(Math.random() * 80) + 10}%`,
                flex: '1 1 0',
                margin: '0 2px',
              }"
            >
              <span class="UiSkeleton"></span>
            </div>
          </div>
        </div>
      </template>
      <template v-else-if="error">
        <div
          style="
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 12px;
          "
        >
          <span>{{ error }}</span>
        </div>
      </template>
      <template v-else>
        <div
          style="
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 12px;
          "
        >
          <span>Could not load word history data.</span>
        </div>
      </template>
      <FloatingMenuButton
        v-if="!isLoading && !error && !cardsStore.isMoveModeActive"
        :settings="wordHistoryMenuSettings"
        :modelValue="menuSettingValues"
        @update:modelValue="updateMenuSettings"
        :buttonPos="{ top: 24, right: 24 }"
      />
    </div>
  </div>
</template>

<style scoped>
.MCS__word-history-skeleton-container {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 32px 32px 64px 32px;
}

.MCS__word-history-skeleton-chart {
  height: 100%;
  width: 100%;
  min-width: 200px;
  position: relative;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 2px;
}

.MCS__word-history-skeleton-bar {
  width: 100%;
  border-radius: 6px 6px 2px 2px;
}
.MCS__word-history-skeleton-bar .UiSkeleton {
  width: 100%;
  height: 100%;
  border-radius: 6px 6px 2px 2px;
  display: block;
}
</style>
