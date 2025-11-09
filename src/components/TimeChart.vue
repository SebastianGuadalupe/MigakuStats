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
import { useTimeStatsStore } from "../stores/timeStats";
import { Bar } from "vue-chartjs";
import {
  Chart as ChartJS,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
} from "chart.js";
import { THEME_CONFIGS } from "../utils/theme";
import { CHART_CONFIG } from "../utils/constants";
import { useCardsStore } from "../stores/cards";
import FloatingMenuButton from "./FloatingMenuButton.vue";

ChartJS.register(BarElement, CategoryScale, LinearScale, Tooltip, Legend);

const appStore = useAppStore();
const cardsStore = useCardsStore();
const componentHash = computed(() => appStore.componentHash || "");
const theme = computed(() => appStore.theme || "dark");
const themeColors = computed(
  () => THEME_CONFIGS[theme.value.toUpperCase() as keyof typeof THEME_CONFIGS]
);

const timeStatsStore = useTimeStatsStore();
const timeHistory = computed(() => timeStatsStore.timeHistory);
const isLoading = computed(() => timeStatsStore.isLoading);
const error = computed(() => timeStatsStore.error);
const language = computed(() => appStore.language);
const selectedDeckId = computed(() => appStore.selectedDeckId);
const viewMode = computed({
  get: () =>
    timeStatsStore.viewMode === "totals" ? "Total time" : "Average time",
  set: (v) =>
    timeStatsStore.setViewMode(v === "Total time" ? "totals" : "averages"),
});
const grouping = computed({
  get: () => timeStatsStore.grouping,
  set: (v) => timeStatsStore.setGroupingAndPeriod(v, timeStatsStore.periodId),
});
const periodId = computed({
  get: () => timeStatsStore.periodId,
  set: (v) => timeStatsStore.setGroupingAndPeriod(timeStatsStore.grouping, v),
});

const timeChartContainer = ref<HTMLElement | null>(null);
const shouldHideDates = ref(false);
const shouldHideLateralLabels = ref(false);

function checkResize() {
  if (!timeChartContainer.value) return;
  let hideDates = false;
  const timeChartCard = cardsStore.cards.find((c) => c.item.i === "TimeChart");
  if (timeChartCard && timeChartCard.item.h <= 5) {
    hideDates = true;
  } else {
    hideDates = false;
  }
  if (timeChartCard && timeChartCard.item.w <= 4) {
    shouldHideLateralLabels.value = true;
  } else {
    shouldHideLateralLabels.value = false;
  }
  shouldHideDates.value = hideDates;
}

function formatTime(seconds: number): string {
  if (seconds === 0 || !seconds) return "0s";
  const secs = Math.floor(seconds);
  const minutes = Math.floor(secs / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    const remainingHours = hours % 24;
    return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
  }
  if (hours > 0) {
    const remainingMinutes = minutes % 60;
    return remainingMinutes > 0
      ? `${hours}h ${remainingMinutes}m`
      : `${hours}h`;
  }
  if (minutes > 0) {
    const remainingSeconds = secs % 60;
    return remainingSeconds > 0
      ? `${minutes}m ${remainingSeconds}s`
      : `${minutes}m`;
  }
  return `${secs}s`;
}

onMounted(async () => {
  window.addEventListener("resize", checkResize);
  nextTick(() => {
    checkResize();
  });
  if (language.value) {
    await timeStatsStore.refetch(language.value, selectedDeckId.value);
  }
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", checkResize);
});

watch(
  [timeHistory, isLoading, error, () => cardsStore],
  async () => {
    await nextTick();
    checkResize();
  },
  { deep: true }
);

watch(
  [language, selectedDeckId, periodId, grouping, () => timeStatsStore.viewMode],
  async ([lang, deckId, period, group, mode], _prev, onCleanup) => {
    if (!lang) return;
    const fetchPromise = timeStatsStore.fetchTimeHistoryIfNeeded(
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
  }
);

const menuSettings = [
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
    options: ["Total time", "Average time"],
    value: viewMode.value,
  },
];

const menuSettingValues = computed(() => ({
  grouping: grouping.value,
  periodId: periodId.value,
  viewMode: viewMode.value,
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
  viewMode?: "Total time" | "Average time";
}) {
  if (newVals.grouping !== undefined || newVals.periodId !== undefined) {
    timeStatsStore.setGroupingAndPeriod(
      newVals.grouping ?? grouping.value,
      newVals.periodId ?? periodId.value
    );
  }
  if (newVals.viewMode !== undefined) {
    const storeValue =
      newVals.viewMode === "Total time" ? "totals" : "averages";
    timeStatsStore.setViewMode(storeValue);
  }
}

async function handleRetry() {
  if (language.value) {
    await timeStatsStore.refetch(language.value, selectedDeckId.value);
  }
}

const chartData = computed(() => {
  if (
    !timeHistory.value ||
    !timeHistory.value.labels ||
    !timeHistory.value.newCardsTime ||
    !timeHistory.value.reviewsTime
  ) {
    return { labels: [], datasets: [] };
  }

  const { labels, newCardsTime, reviewsTime } = timeHistory.value;

  return {
    labels,
    datasets: [
      {
        label: "New Cards Time",
        data: newCardsTime,
        backgroundColor:
          themeColors.value.learningColor || themeColors.value.accent1,
        borderWidth: 0,
        borderRadius: 4,
        order: 2,
        stack: "timegroup",
      },
      {
        label: "Reviews Time",
        data: reviewsTime,
        backgroundColor: themeColors.value.barColor,
        borderWidth: 0,
        borderRadius: 4,
        order: 1,
        stack: "timegroup",
      },
    ],
  };
});

const chartOptions = computed(() => {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: {
      duration: 800,
      easing: "easeOutQuart" as const,
    },
    scales: {
      y: {
        beginAtZero: true,
        stacked: true,
        title: {
          display: !shouldHideLateralLabels.value,
          text:
            viewMode.value === "Average time" ? "Average Time" : "Total Time",
          color: themeColors.value.textColor,
        },
        ticks: {
          color: themeColors.value.textColor,
          precision: 1,
          display: !shouldHideLateralLabels.value,
          callback: function (value: any) {
            return formatTime(value);
          },
        },
        grid: {
          color: themeColors.value.gridColor,
        },
      },
      x: {
        stacked: true,
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
        display: true,
        position: "top" as const,
        labels: {
          color: themeColors.value.textColor,
          usePointStyle: true,
          pointStyle: "circle",
        },
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
            const allData = context.chart.data.datasets.reduce(
              (acc: number, ds: any) =>
                acc +
                (Array.isArray(ds.data) ? ds.data[context.dataIndex] ?? 0 : 0),
              0
            );
            const percentage =
              allData > 0 ? ((value / allData) * 100).toFixed(1) : "0.0";
            return `${datasetLabel}: ${formatTime(value)} (${percentage}%)`;
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
</script>

<template>
  <div
    :[componentHash]="true"
    class="UiCard -lesson Statistic__card"
    ref="timeChartContainer"
  >
    <h3
      :[componentHash]="true"
      class="UiTypo UiTypo__heading3 -heading Statistic__title"
    >
      Time Statistics
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
          timeHistory &&
          timeHistory.labels &&
          timeHistory.newCardsTime &&
          timeHistory.reviewsTime &&
          !isLoading &&
          !error
        "
      >
        <Bar
          :data="chartData"
          :options="chartOptions"
          style="width: 100%; height: 100%"
        />
      </template>
      <template v-else-if="isLoading">
        <div class="MCS__time-skeleton-container">
          <div class="MCS__time-skeleton-bar-chart">
            <div
              v-for="n in 30"
              :key="n"
              class="MCS__time-skeleton-bar"
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
        <div style="display: flex; flex-direction: column; align-items: center; gap: 12px;">
          <span>{{ error }}</span>
          <button 
            v-bind:[componentHash]="true" 
            class="UiButton UiButton--primary"
            @click="handleRetry"
            :disabled="isLoading"
          >
            {{ isLoading ? 'Retrying...' : 'Retry' }}
          </button>
        </div>
      </template>
      <template v-else>
        <div style="display: flex; flex-direction: column; align-items: center; gap: 12px;">
          <span>Could not load time statistics.</span>
          <button 
            v-bind:[componentHash]="true" 
            class="UiButton UiButton--primary"
            @click="handleRetry"
            :disabled="isLoading"
          >
            {{ isLoading ? 'Retrying...' : 'Retry' }}
          </button>
        </div>
      </template>
      <FloatingMenuButton
        v-if="!isLoading && !error && !cardsStore.isMoveModeActive"
        :settings="menuSettings"
        :modelValue="menuSettingValues"
        @update:modelValue="updateMenuSettings"
        :buttonPos="{ top: 24, right: 24 }"
      />
    </div>
  </div>
</template>

<style scoped>
.MCS__time-skeleton-container {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 32px 32px 64px 32px;
}

.MCS__time-skeleton-bar-chart {
  height: 100%;
  width: 100%;
  min-width: 200px;
  position: relative;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 2px;
}

.MCS__time-skeleton-bar {
  width: 100%;
  border-radius: 6px 6px 2px 2px;
}
.MCS__time-skeleton-bar .UiSkeleton {
  width: 100%;
  height: 100%;
  border-radius: 6px 6px 2px 2px;
  display: block;
}
</style>
