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
import { useDueStatsStore } from "../stores/dueStats";
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

const dueStatsStore = useDueStatsStore();
const dueStats = computed(() => dueStatsStore.dueStats);
const isLoading = computed(() => dueStatsStore.isLoading);
const error = computed(() => dueStatsStore.error);
const language = computed(() => appStore.language);
const selectedDeckId = computed(() => appStore.selectedDeckId);
const periodId = computed(() => dueStatsStore.periodId);

const cardsDueContainer = ref<HTMLElement | null>(null);
const shouldHideDates = ref(false);
const shouldHideLateralLabels = ref(false);

function checkResize() {
  if (!cardsDueContainer.value) return;
  let hideDates = false;
  const cardsDueCard = cardsStore.cards.find((c) => c.item.i === "CardsDue");
  if (cardsDueCard && cardsDueCard.item.h <= 5) {
    hideDates = true;
  } else {
    hideDates = false;
  }
  if (cardsDueCard && cardsDueCard.item.w <= 4) {
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
    await dueStatsStore.refetch(language.value, selectedDeckId.value);
  }
});
onBeforeUnmount(() => {
  window.removeEventListener("resize", checkResize);
});

watch(
  [dueStats, isLoading, error, () => cardsStore],
  async () => {
    await nextTick();
    checkResize();
  },
  { deep: true }
);

watch(
  [language, selectedDeckId, periodId],
  async ([lang, deckId, period], _prev, onCleanup) => {
    if (!lang) return;
    const fetchPromise = dueStatsStore.fetchDueStatsIfNeeded(lang, deckId, period);
    let cancelled = false;
    onCleanup(() => (cancelled = true));
    await fetchPromise;
    if (cancelled) return;
  }
);

const cardsDueMenuSettings = [
  {
    key: "periodId",
    label: "Period",
    type: "dropdown" as const,
    options: ["1 Month", "2 Months", "3 Months", "6 Months", "1 Year", "All time"],
    value: periodId.value,
    displayPrefix: 'Next ',
  },
];

const menuSettingValues = computed(() => ({
  periodId: periodId.value,
}));

function updateMenuSettings(newVals: { periodId: "1 Month" | "2 Months" | "3 Months" | "6 Months" | "1 Year" | "All time" }) {
  dueStatsStore.setPeriod(newVals.periodId);
}

const chartData = computed(() => {
  if (!dueStats.value || !dueStats.value.labels || !dueStats.value.counts) {
    return { labels: [], datasets: [] };
  }

  const { labels, counts, learningCounts, knownCounts } = dueStats.value;
  const cumulativeCounts = [];
  let runningSum = 0;
  for (let i = 0; i < counts.length; i++) {
    runningSum += counts[i];
    cumulativeCounts.push(runningSum);
  }
  const datasets: any[] = [];

  if (learningCounts && knownCounts) {
    datasets.push({
      label: "Learning",
      data: learningCounts,
      backgroundColor: themeColors.value.barColor.includes("rgba")
        ? themeColors.value.barColor.replace(/,\s*[\d.]+\)$/, ", 0.5)")
        : themeColors.value.barColor + "40",
      borderWidth: 0,
      borderRadius: 4,
      order: 4,
      stack: "bargroup",
    });
    datasets.push({
      label: "Known",
      data: knownCounts,
      backgroundColor: themeColors.value.barColor.includes("rgba")
        ? themeColors.value.barColor.replace(/,\s*[\d.]+\)$/, ", 1)")
        : themeColors.value.barColor + "1A",
      borderWidth: 0,
      borderRadius: 4,
      order: 3,
      stack: "bargroup",
    });
  } else {
    datasets.push({
      label: "Cards Due",
      data: counts,
      backgroundColor: themeColors.value.barColor,
      borderWidth: 0,
      borderRadius: 4,
      order: 2,
      stack: "bargroup",
    });
  }
  datasets.push({
    label: "Cumulative Cards",
    data: cumulativeCounts,
    type: "line",
    borderColor: themeColors.value.unknownColor,
    backgroundColor: themeColors.value.unknownColor,
    borderWidth: 2,
    pointStyle: false,
    tension: 0.4,
    fill: "origin",
    yAxisID: "y1",
    order: 1,
  });

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
          text: "Cards Due",
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
        grid: {
          drawOnChartArea: false,
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
            const cumulativeCounts =
              context.chart.data.datasets.find(
                (ds: any) => ds.label === "Cumulative Cards"
              )?.data || [];
            const total = cumulativeCounts[cumulativeCounts.length - 1] || 0;
            const percentage =
              total > 0 ? ((value / total) * 100).toFixed(1) : "0.0";
            return `${datasetLabel}: ${value} (${percentage}%)`;
          },
          footer: function (context: any) {
            const values = context
              .filter((i: any) => i.dataset.label.includes("Cumulative"))
              .map((i: any) => i.parsed.y);
            return values.length > 0
              ? `Total: ${values.reduce((a: any, b: any) => a + b, 0)}`
              : "";
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
    ref="cardsDueContainer"
  >
    <h3
      :[componentHash]="true"
      class="UiTypo UiTypo__heading3 -heading Statistic__title"
    >
      Cards Due
    </h3>
    <div
      style="
        height: calc(100% - 56px);
        min-width: 100%;
        display: flex;
        align-items: flex-end;
        justify-content: center;
      "
    >
      <template
        v-if="
          dueStats && dueStats.labels && dueStats.counts && !isLoading && !error
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
        <span>{{ error }}</span>
      </template>
      <template v-else>
        <span>Could not load due card data.</span>
      </template>
      <FloatingMenuButton
        v-if="!cardsStore.isMoveModeActive"
        :settings="cardsDueMenuSettings"
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
