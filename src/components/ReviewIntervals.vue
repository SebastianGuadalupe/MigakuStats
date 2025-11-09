<script setup lang="ts">
import {
  computed,
  ref,
  watch,
  onMounted,
  onBeforeUnmount,
  nextTick,
} from "vue";
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
import { useAppStore } from "../stores/app";
import { useIntervalStatsStore } from "../stores/intervalStats";
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

const intervalStatsStore = useIntervalStatsStore();
const intervalStats = computed(() => intervalStatsStore.intervalStats);
const isLoading = computed(() => intervalStatsStore.isLoading);
const error = computed(() => intervalStatsStore.error);
const language = computed(() => appStore.language);
const selectedDeckId = computed(() => appStore.selectedDeckId);
const percentileId = computed(() => intervalStatsStore.percentileId);

const containerRef = ref<HTMLElement | null>(null);
const shouldHideDates = ref(false);
const shouldHideLateralLabels = ref(false);

function checkResize() {
  if (!containerRef.value) return;
  const card = cardsStore.cards.find((c) => c.item.i === "ReviewIntervals");
  if (card && card.item.h <= 5) {
    shouldHideDates.value = true;
  } else {
    shouldHideDates.value = false;
  }
  if (card && card.item.w <= 4) {
    shouldHideLateralLabels.value = true;
  } else {
    shouldHideLateralLabels.value = false;
  }
}

onMounted(async () => {
  window.addEventListener("resize", checkResize);
  nextTick(() => checkResize());
  if (language.value) {
    await intervalStatsStore.refetch(language.value, selectedDeckId.value);
  }
});
onBeforeUnmount(() => window.removeEventListener("resize", checkResize));

watch(
  [intervalStats, isLoading, error, () => cardsStore],
  async () => {
    await nextTick();
    checkResize();
  },
  { deep: true }
);

watch(
  [language, selectedDeckId, percentileId],
  async ([lang, deckId, pct], _prev, onCleanup) => {
    if (!lang) return;
    const fetchPromise = intervalStatsStore.fetchIntervalStatsIfNeeded(
      lang,
      deckId,
      pct
    );
    let cancelled = false;
    onCleanup(() => (cancelled = true));
    await fetchPromise;
    if (cancelled) return;
  }
);

const chartData = computed(() => {
  if (
    !intervalStats.value ||
    !intervalStats.value.labels ||
    !intervalStats.value.counts
  ) {
    return { labels: [], datasets: [] } as any;
  }
  const labels = intervalStats.value.labels;
  const counts = intervalStats.value.counts;
  const cumulativeCounts: number[] = [];
  let sum = 0;
  for (const c of counts) {
    sum += c;
    cumulativeCounts.push(sum);
  }

  const datasets: any[] = [
    {
      label: "Cards per Interval",
      data: counts,
      backgroundColor: themeColors.value.accent1,
      borderWidth: 0,
      borderRadius: 4,
      order: 2,
      stack: "bargroup",
    },
    {
      label: "Cumulative Cards",
      data: cumulativeCounts,
      type: "line",
      borderColor: themeColors.value.accent1Transparent,
      backgroundColor: themeColors.value.accent1Transparent,
      borderWidth: 2,
      pointStyle: false,
      tension: 0.4,
      fill: "origin",
      yAxisID: "y1",
      order: 1,
    },
  ];
  return { labels, datasets };
});

const chartOptions = computed(() => {
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 800, easing: "easeOutQuart" as const },
    scales: {
      y: {
        beginAtZero: true,
        title: {
          display: !shouldHideLateralLabels.value,
          text: "Number of Cards",
          color: themeColors.value.textColor,
        },
        ticks: {
          color: themeColors.value.textColor,
          precision: 0,
          display: !shouldHideLateralLabels.value,
        },
        grid: { color: themeColors.value.gridColor },
      },
      y1: {
        position: "right" as const,
        beginAtZero: true,
        title: {
          display: !shouldHideLateralLabels.value,
          text: "Cumulative Cards",
          color: themeColors.value.textColor,
        },
        ticks: {
          color: themeColors.value.textColor,
          precision: 0,
          display: !shouldHideLateralLabels.value,
        },
        grid: { drawOnChartArea: false },
      },
      x: {
        title: {
          display: !shouldHideDates.value,
          text: "Review Interval (Days)",
          color: themeColors.value.textColor,
        },
        ticks: {
          color: themeColors.value.textColor,
          maxRotation: 45,
          minRotation: 45,
          display: !shouldHideDates.value,
        },
        grid: { color: themeColors.value.gridColor },
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
          title: (items: any) => items[0].label,
          label: (context: any) => {
            const datasetLabel = context.dataset.label || "";
            const value = context.parsed.y;
            const cum =
              context.chart.data.datasets.find(
                (d: any) => d.label === "Cumulative Cards"
              )?.data || [];
            const total = cum[cum.length - 1] || 0;
            if (datasetLabel === "Cards per Interval" && value > 0) {
              const pct =
                total > 0 ? ((value / total) * 100).toFixed(1) : "0.0";
              return `${datasetLabel}: ${value} (${pct}%)`;
            }
            if (datasetLabel === "Cumulative Cards") {
              const pct =
                total > 0 ? ((value / total) * 100).toFixed(1) : "0.0";
              return `${datasetLabel}: ${value} (${pct}%)`;
            }
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

const menuSettings = [
  {
    key: "percentileId",
    label: "Percentile",
    type: "dropdown" as const,
    options: ["50th", "75th", "95th", "100th"],
    value: percentileId.value,
  },
];

const menuValues = computed(() => ({ percentileId: percentileId.value }));
function updateMenuSettings(newVals: {
  percentileId: "50th" | "75th" | "95th" | "100th";
}) {
  intervalStatsStore.setPercentile(newVals.percentileId);
}

async function handleRetry() {
  if (language.value) {
    await intervalStatsStore.refetch(language.value, selectedDeckId.value);
  }
}
</script>

<template>
  <div
    :[componentHash]="true"
    class="UiCard -lesson Statistic__card"
    ref="containerRef"
  >
    <h3
      :[componentHash]="true"
      class="UiTypo UiTypo__heading3 -heading Statistic__title"
    >
      Review Intervals
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
          intervalStats &&
          intervalStats.labels &&
          intervalStats.counts &&
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
          <span>Could not load interval data.</span>
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
        :modelValue="menuValues"
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
