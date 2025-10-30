<script setup lang="ts">
import { computed, watch, ref, onMounted, onBeforeUnmount, nextTick } from "vue";
import { useAppStore } from "../stores/app";
import { useWordStatsStore } from "../stores/wordStats";
import { Doughnut } from "vue-chartjs";
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from "chart.js";
import { THEME_CONFIGS } from "../utils/theme";
import { CHART_CONFIG } from "../utils/constants";
import { useCardsStore } from "../stores/cards";
import FloatingMenuButton from "./FloatingMenuButton.vue";

ChartJS.register(ArcElement, Tooltip, Legend);

const appStore = useAppStore();
const wordStatsStore = useWordStatsStore();
const componentHash = computed(() => appStore.componentHash || "");
const theme = computed(() => appStore.theme || "dark");
const themeColors = computed(() => THEME_CONFIGS[theme.value.toUpperCase() as keyof typeof THEME_CONFIGS]);
const language = computed(() => appStore.language);
const selectedDeckId = computed(() => appStore.selectedDeckId);
const cardsStore = useCardsStore();

interface WordStats {
  known_count: number;
  learning_count: number;
  unknown_count: number;
  ignored_count: number;
}

const error = computed(() => wordStatsStore.error);
const isLoading = computed(() => wordStatsStore.isLoading);
const wordStats = computed<WordStats|null>(() => wordStatsStore.wordStats);

const wordcountContainer = ref<HTMLElement | null>(null);
const isOverflowing = ref(false);

function checkOverflow() {
  if (!wordcountContainer.value) return;
  let isOverf = false;
  const wordCountCard = cardsStore.cards.find(c => c.item.i === 'WordCount');
  if (wordCountCard && wordCountCard.item.w <= 5 && wordCountCard.item.h <= 6) {
    isOverf = true;
  } else if (wordCountCard && wordCountCard.item.h <= 5 && wordCountCard.item.w <= 5) {
    isOverf = true;
  }
  isOverflowing.value = isOverf;
}

onMounted(async () => {
  window.addEventListener("resize", checkOverflow);
  nextTick(() => {
    checkOverflow();
  });
  if (language.value) {
    await wordStatsStore.refetch(language.value, selectedDeckId.value);
  }
});
onBeforeUnmount(() => {
  window.removeEventListener("resize", checkOverflow);
});

watch([
  wordStats,
  isLoading,
  error,
  () => cardsStore
], async () => {
  await nextTick();
  checkOverflow();
}, { deep: true });

const chartData = computed(() => {
  if (!wordStats.value) {
    return {
      labels: [],
      datasets: [],
    };
  }
  const labels: string[] = ["Known", "Learning"]; 
  const data: number[] = [
    wordStats.value.known_count,
    wordStats.value.learning_count,
  ];
  const bg: string[] = [
    themeColors.value.knownColor,
    themeColors.value.learningColor,
  ];
  const border: string[] = [
    themeColors.value.knownColor,
    themeColors.value.learningColor,
  ];
  if (wordStatsStore.showUnknown) {
    labels.push("Unknown");
    data.push(wordStats.value.unknown_count);
    bg.push(themeColors.value.unknownColor);
    border.push(themeColors.value.unknownColor);
  }
  if (wordStatsStore.showIgnored) {
    labels.push("Ignored");
    data.push(wordStats.value.ignored_count);
    bg.push(themeColors.value.ignoredColor);
    border.push(themeColors.value.ignoredColor);
  }
  return {
    labels,
    datasets: [
      {
        data,
        backgroundColor: bg,
        borderColor: border,
        borderWidth: 0,
      },
    ],
  };
});

const chartOptions = computed(() => {
  return {
    responsive: true,
    maintainAspectRatio: false,
    aspectRatio: 1.6,
    animation: {
      duration: 800,
      easing: "easeOutQuart" as const,
    },
    layout: {
      padding: {
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
      },
    },
    plugins: {
      legend: {
        position: "right" as const,
        labels: {
          color: themeColors.value.textColor,
          usePointStyle: true,
          pointStyle: "circle" as const,
        }
      },
      tooltip: {
        callbacks: {
          label: function (context: any) {
            let label = context.label || "";
            if (label) {
              label += ": ";
            }
            if (context.parsed !== null) {
              label += context.parsed.toLocaleString();
            }
            return label;
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
        titleColor: themeColors.value.textColor,
      },
      bodyColor: themeColors.value.textColor,
      titleColor: themeColors.value.textColor,
    },
};
});

const menuSettings = [
  { key: "showUnknown", label: "Show Unknown", type: "switch" as const, value: wordStatsStore.showUnknown },
  { key: "showIgnored", label: "Show Ignored", type: "switch" as const, value: wordStatsStore.showIgnored },
];

const menuValues = computed(() => ({
  showUnknown: !!wordStatsStore.showUnknown,
  showIgnored: !!wordStatsStore.showIgnored,
}));

function updateMenuSettings(newVals: { showUnknown: boolean; showIgnored: boolean }) {
  wordStatsStore.setShowUnknown(!!newVals.showUnknown);
  wordStatsStore.setShowIgnored(!!newVals.showIgnored);
}

watch([language, selectedDeckId], async ([lang, deckId], _prev, onCleanup) => {
  if (!lang) return;
  const fetchPromise = wordStatsStore.fetchWordStatsIfNeeded(lang, deckId);
  let cancelled = false;
  onCleanup(() => cancelled = true);
  await fetchPromise;
  if (cancelled) return;
});
</script>

<template>
  <div :[componentHash]="true" class="UiCard -lesson Statistic__card" ref="wordcountContainer">
    <h3
      :[componentHash]="true"
      class="UiTypo UiTypo__heading3 -heading Statistic__title"
    >
      Word Status
    </h3>
    <div v-if="wordStats && !isLoading && !error" v-bind:[componentHash]="true" style="height: calc(100% - 56px); display: flex; align-items: center; justify-content: center; position: relative;">
      <div v-bind:[componentHash]="true" class="MCS__wordcount">
        <div v-bind:[componentHash]="true" class="MCS__wordcount__details" v-show="!isOverflowing">
          <div v-bind:[componentHash]="true">
            <div v-bind:[componentHash]="true">
              <span class="UiTypo UiTypo__caption">Known:</span>
              <span class="UiTypo UiTypo__heading4 -heading -inline">{{
                wordStats.known_count ?? "N/A"
              }}</span>
            </div>
            <div v-bind:[componentHash]="true">
              <span class="UiTypo UiTypo__caption">Learning:</span>
              <span class="UiTypo UiTypo__heading4 -heading -inline">{{
                wordStats.learning_count ?? "N/A"
              }}</span>
            </div>
            <div v-bind:[componentHash]="true" v-if="wordStatsStore.showUnknown">
              <span class="UiTypo UiTypo__caption">Unknown:</span>
              <span class="UiTypo UiTypo__heading4 -heading -inline">{{
                wordStats.unknown_count ?? "N/A"
              }}</span>
            </div>
            <div v-bind:[componentHash]="true" v-if="wordStatsStore.showIgnored">
              <span class="UiTypo UiTypo__caption">Ignored:</span>
              <span class="UiTypo UiTypo__heading4 -heading -inline">{{
                wordStats.ignored_count ?? "N/A"
              }}</span>
            </div>
          </div>
        </div>
        <div v-bind:[componentHash]="true" class="MCS__wordcount__piechart">
          <Doughnut class="MCS__wordcount__piechart__donut" :data="chartData" :options="chartOptions" />
        </div>
      </div>
      <FloatingMenuButton
        v-if="!cardsStore.isMoveModeActive"
        :settings="menuSettings"
        :modelValue="menuValues"
        @update:modelValue="updateMenuSettings"
        :buttonPos="{ top: 24, right: 24 }"
      />
    </div>
    <div v-else-if="isLoading" v-bind:[componentHash]="true">
      <div v-bind:[componentHash]="true" class="MCS__wordcount">
        <!-- Left side: Label + Number pairs -->
        <div v-bind:[componentHash]="true" class="MCS__wordcount__details" v-show="!isOverflowing">
          <div v-bind:[componentHash]="true">
            <div v-bind:[componentHash]="true" class="skeleton-row">
              <span class="UiSkeleton skeleton-label"></span>
              <span class="UiSkeleton skeleton-label"></span>
              <span class="UiSkeleton skeleton-label"></span>
              <span class="UiSkeleton skeleton-label"></span>
            </div>
          </div>
        </div>
        
        <!-- Right side: Donut chart + Legend -->
        <div v-bind:[componentHash]="true" class="MCS__wordcount__piechart">
          <div class="skeleton-donut-container">
            <!-- Donut chart skeleton -->
            <div class="skeleton-donut UiSkeleton"></div>
            
            <!-- Legend skeleton -->
            <div class="skeleton-legend">
              <div class="skeleton-legend-item">
                <span class="skeleton-legend-circle UiSkeleton"></span>
                <span class="skeleton-legend-text UiSkeleton"></span>
              </div>
              <div class="skeleton-legend-item">
                <span class="skeleton-legend-circle UiSkeleton"></span>
                <span class="skeleton-legend-text UiSkeleton"></span>
              </div>
              <div class="skeleton-legend-item">
                <span class="skeleton-legend-circle UiSkeleton"></span>
                <span class="skeleton-legend-text UiSkeleton"></span>
              </div>
              <div class="skeleton-legend-item">
                <span class="skeleton-legend-circle UiSkeleton"></span>
                <span class="skeleton-legend-text UiSkeleton"></span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div v-else-if="error" v-bind:[componentHash]="true" class="MCS__word-stats-card">
      <p v-bind:[componentHash]="true" class="UiTypo UiTypo__body2">
        {{ error }}
      </p>
    </div>
    <div v-else v-bind:[componentHash]="true" class="MCS__word-stats-card">
      <p v-bind:[componentHash]="true" class="UiTypo UiTypo__body2">
        Could not load word status data.
      </p>
    </div>
  </div>
</template>

<style scoped>
.MCS__wordcount {
  display: flex;
  flex-wrap: wrap;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 16px;
  margin: 16px 0;
}

.MCS__wordcount__details {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.MCS__wordcount__piechart {
  display: flex;
  align-items: center;
  justify-content: center;
}

.MCS__wordcount__piechart__donut {
  aspect-ratio: 1.6;
  max-height: 300px;
  min-height: 100px;
}

.skeleton-row {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.skeleton-label {
  width: 128px;
  height: 16px;
  border-radius: 30px;
}

.skeleton-donut-container {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  width: 100%;
  justify-content: center;
}

.skeleton-donut {
  height: 187px;
  width: 187px;
  border-radius: 50%;
  border: 50px solid rgba(255, 255, 255, 0.1);
  background: transparent;
}

.skeleton-legend {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.skeleton-legend-item {
  display: flex;
  align-items: center;
  gap: 3px;
}

.skeleton-legend-circle {
  width: 18px;
  height: 18px;
  border-radius: 50%;
}

.skeleton-legend-text {
  width: 60px;
  height: 14px;
  border-radius: 30px;
}
</style>
