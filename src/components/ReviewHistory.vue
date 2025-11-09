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
import { useReviewHistoryStore } from "../stores/reviewHistory";
import { Bar } from "vue-chartjs";
import {
  Chart as ChartJS,
  BarElement,
  LineElement,
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
  BarElement,
  LineElement,
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

const reviewHistoryStore = useReviewHistoryStore();
const reviewHistory = computed(() => reviewHistoryStore.reviewHistory);
const isLoading = computed(() => reviewHistoryStore.isLoading);
const error = computed(() => reviewHistoryStore.error);
const language = computed(() => appStore.language);
const selectedDeckId = computed(() => appStore.selectedDeckId);
const grouping = computed({
  get: () => reviewHistoryStore.grouping,
  set: v => reviewHistoryStore.setGroupingAndPeriod(v, reviewHistoryStore.periodId)
});
const periodId = computed({
  get: () => reviewHistoryStore.periodId,
  set: v => reviewHistoryStore.setGroupingAndPeriod(reviewHistoryStore.grouping, v)
});

const reviewHistoryContainer = ref<HTMLElement | null>(null);
const shouldHideDates = ref(false);
const shouldHideLateralLabels = ref(false);

function checkResize() {
  if (!reviewHistoryContainer.value) return;
  let hideDates = false;
  const reviewHistoryCard = cardsStore.cards.find(
    (c) => c.item.i === "ReviewHistory"
  );
  if (reviewHistoryCard && reviewHistoryCard.item.h <= 5) {
    hideDates = true;
  } else {
    hideDates = false;
  }
  if (reviewHistoryCard && reviewHistoryCard.item.w <= 4) {
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
    await reviewHistoryStore.refetch(language.value, selectedDeckId.value);
  }
});
onBeforeUnmount(() => {
  window.removeEventListener("resize", checkResize);
});

watch(
  [reviewHistory, isLoading, error, () => cardsStore],
  async () => {
    await nextTick();
    checkResize();
  },
  { deep: true }
);

watch(
  [language, selectedDeckId, periodId, grouping],
  async ([lang, deckId, period, group], _prev, onCleanup) => {
    if (!lang) return;
    const fetchPromise = reviewHistoryStore.fetchReviewHistoryIfNeeded(
      lang,
      deckId,
      period,
      group
    );
    let cancelled = false;
    onCleanup(() => (cancelled = true));
    await fetchPromise;
    if (cancelled) return;
  }
);

const chartData = computed(() => {
  if (
    !reviewHistory.value ||
    !reviewHistory.value.labels ||
    !reviewHistory.value.counts
  ) {
    return { labels: [], datasets: [] };
  }
  const { labels, counts, typeLabels } = reviewHistory.value;
  const datasets: any[] = counts.map((arr, idx) => ({
    label: typeLabels && typeLabels[idx] ? typeLabels[idx] : `Type ${idx}`,
    data: arr,
    backgroundColor: [
      themeColors.value.accent1,
      themeColors.value.accent2,
      themeColors.value.accent3,
    ][idx % 3],
    borderWidth: 0,
    borderRadius: 4,
    order: -idx,
    stack: "bargroup",
  }));

  return { labels, datasets };
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
          text: "Cards",
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
            return `${datasetLabel}: ${value} (${percentage}%)`;
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

const reviewHistoryMenuSettings = [
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
    options: ["1 Month", "2 Months", "3 Months", "6 Months", "1 Year", "All time"],
    value: periodId.value,
    displayPrefix: "Last ",
  }
];

const menuSettingValues = computed(() => ({
  grouping: grouping.value,
  periodId: periodId.value,
}));

function updateMenuSettings(newVals: { grouping: "Days" | "Weeks" | "Months"; periodId: "1 Month" | "2 Months" | "3 Months" | "6 Months" | "1 Year" | "All time" }) {
  reviewHistoryStore.setGroupingAndPeriod(newVals.grouping, newVals.periodId);
}

async function handleRetry() {
  if (language.value) {
    await reviewHistoryStore.refetch(language.value, selectedDeckId.value);
  }
}
</script>

<template>
  <div
    :[componentHash]="true"
    class="UiCard -lesson Statistic__card"
    ref="reviewHistoryContainer"
  >
    <h3
      :[componentHash]="true"
      class="UiTypo UiTypo__heading3 -heading Statistic__title"
    >
      Review History
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
          reviewHistory &&
          reviewHistory.labels &&
          reviewHistory.counts &&
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
        <div class="MCS__due-skeleton-container">
          <div class="MCS__due-skeleton-bar-chart">
            <div
              v-for="n in 30"
              :key="n"
              class="MCS__due-skeleton-bar"
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
          <span>Could not load review history data.</span>
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
        :settings="reviewHistoryMenuSettings"
        :modelValue="menuSettingValues"
        @update:modelValue="updateMenuSettings"
        :buttonPos="{ top: 24, right: 24 }"
      />
    </div>
  </div>
</template>

<style scoped>
.MCS__due-skeleton-container {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 32px 32px 64px 32px;
}

.MCS__due-skeleton-bar-chart {
  height: 100%;
  width: 100%;
  min-width: 200px;
  position: relative;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  gap: 2px;
}

.MCS__due-skeleton-bar {
  width: 100%;
  border-radius: 6px 6px 2px 2px;
}
.MCS__due-skeleton-bar .UiSkeleton {
  width: 100%;
  height: 100%;
  border-radius: 6px 6px 2px 2px;
  display: block;
}
</style>
