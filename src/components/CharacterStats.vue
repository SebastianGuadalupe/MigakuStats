<script setup lang="ts">
import {
  computed,
  watch,
  ref,
  onMounted,
  onBeforeUnmount,
  nextTick,
} from "vue";
import { useAppStore } from "../stores/app";
import { useCharacterStatsStore } from "../stores/characterStats";
import { Doughnut } from "vue-chartjs";
import { Chart as ChartJS, ArcElement, Tooltip, Legend } from "chart.js";
import { THEME_CONFIGS } from "../utils/theme";
import { CHART_CONFIG } from "../utils/constants";
import { useCardsStore } from "../stores/cards";
import FloatingMenuButton from "./FloatingMenuButton.vue";
import CharacterGrid from "./CharacterGrid.vue";
import { FILTER_OPTIONS } from "../utils/kanjiDatabase";

ChartJS.register(ArcElement, Tooltip, Legend);

const appStore = useAppStore();
const characterStatsStore = useCharacterStatsStore();
const componentHash = computed(() => appStore.componentHash || "");
const theme = computed(() => appStore.theme || "dark");
const themeColors = computed(
  () => THEME_CONFIGS[theme.value.toUpperCase() as keyof typeof THEME_CONFIGS]
);
const language = computed(() => appStore.language);
const cardsStore = useCardsStore();

const error = computed(() => characterStatsStore.error);
const isLoading = computed(() => characterStatsStore.isLoading);
const characterStats = computed(
  () => characterStatsStore.characterStats
);

const characterStatsContainer = ref<HTMLElement | null>(null);
const isOverflowing = ref(false);
const grouping = computed({
  get: () => characterStatsStore.selectedGrouping,
  set: (v: number) => characterStatsStore.setSelectedGrouping(v),
});
const shouldShowCard = computed(() => language.value === 'ja');

function checkOverflow() {
  if (!characterStatsContainer.value) return;
  let isOverf = false;
  const characterStatsCard = cardsStore.cards.find(
    (c) => c.item.i === "CharacterStats"
  );
  if (
    characterStatsCard &&
    characterStatsCard.item.w <= 5 &&
    characterStatsCard.item.h <= 6
  ) {
    isOverf = true;
  } else if (
    characterStatsCard &&
    characterStatsCard.item.h <= 5 &&
    characterStatsCard.item.w <= 5
  ) {
    isOverf = true;
  }
  isOverflowing.value = isOverf;
}

onMounted(async () => {
  window.addEventListener("resize", checkOverflow);
  nextTick(() => {
    checkOverflow();
  });
  if (language.value === 'ja') {
    await characterStatsStore.refetch(language.value);
  }
});
onBeforeUnmount(() => {
  window.removeEventListener("resize", checkOverflow);
});

watch(
  [language, characterStats, grouping, isLoading, error, () => cardsStore],
  async () => {
    await nextTick();
    checkOverflow();
  },
  { deep: true }
);

const chartData = computed(() => {
  if (!characterStats.value) {
    return {
      labels: [],
      datasets: [],
    };
  }
  const labels: string[] = ["Known", "Learning"];
  const data: number[] = [
    characterStats.value.knownCharacters.length,
    characterStats.value.learningCharacters.length,
  ];
  const bg: string[] = [
    themeColors.value.knownColor,
    themeColors.value.learningColor,
  ];
  const border: string[] = [
    themeColors.value.knownColor,
    themeColors.value.learningColor,
  ];
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
        },
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

const menuSettings = computed(() => [
  {
    key: "grouping",
    label: "Grouping",
    type: "dropdown" as const,
    options: FILTER_OPTIONS.map(f => f.label),
    value: grouping.value,
  },
  {
    key: "gridCellWidth",
    label: "Grid Cell Width",
    type: "number" as const,
    min: 40,
    max: 80,
    step: 5,
    value: characterStatsStore.gridCellWidth,
  },
]);

const menuValues = computed(() => ({
  grouping: FILTER_OPTIONS[grouping.value]?.label || FILTER_OPTIONS[0].label,
  gridCellWidth: characterStatsStore.gridCellWidth,
}));

function updateMenuSettings(newVals: { grouping: string; gridCellWidth: number }) {
  const selectedFilter = FILTER_OPTIONS.find(f => f.label === newVals.grouping);
  if (selectedFilter) {
    grouping.value = selectedFilter.id;
  }
  if (typeof newVals.gridCellWidth === 'number') {
    characterStatsStore.setGridCellWidth(newVals.gridCellWidth);
  }
}

watch(language, async (lang, _prev, onCleanup) => {
  if (!lang || lang !== 'ja') return;
  const fetchPromise = characterStatsStore.fetchCharacterStatsIfNeeded(lang);
  let cancelled = false;
  onCleanup(() => (cancelled = true));
  await fetchPromise;
  if (cancelled) return;
});
</script>

<template>
  <div
    v-if="shouldShowCard"
    :[componentHash]="true"
    class="UiCard -lesson Statistic__card"
    ref="characterStatsContainer"
  >
    <h3
      :[componentHash]="true"
      class="UiTypo UiTypo__heading3 -heading Statistic__title"
    >
      Character Statistics
    </h3>
    <div
    v-if="characterStats && !isLoading && !error"
    :[componentHash]="true"
      style="
        display: flex;
        flex-direction: column;
        justify-content: center;
        position: relative;
        height: calc(100% - 56px);
      "
    >
      <div :[componentHash]="true" class="MCS__character-chart" v-if="characterStats.knownCharacters.length">
        <div
          :[componentHash]="true"
          class="MCS__character-stats__details"
          v-show="!isOverflowing"
        >
          <div :[componentHash]="true">
            <div :[componentHash]="true">
              <span class="UiTypo UiTypo__caption">Known:</span>
              <span class="UiTypo UiTypo__heading4 -heading -inline">{{
                characterStats.knownCharacters.length ?? "N/A"
              }}</span>
            </div>
            <div :[componentHash]="true">
              <span class="UiTypo UiTypo__caption">Learning:</span>
              <span class="UiTypo UiTypo__heading4 -heading -inline">{{
                characterStats.learningCharacters.length ?? "N/A"
              }}</span>
            </div>
          </div>
        </div>
        <div :[componentHash]="true" class="MCS__character-stats__chart">
          <Doughnut
            class="MCS__character-stats__chart__donut"
            :data="chartData"
            :options="chartOptions"
          />
        </div>
      </div>
      <div v-else style="text-align: center; margin: 16px 0;">
        <p>Known:0</p>
        <p>Learning:0</p>
      </div>
      <CharacterGrid :filterId="grouping" />
      <FloatingMenuButton
        v-if="!cardsStore.isMoveModeActive"
        :settings="menuSettings"
        :modelValue="menuValues"
        @update:modelValue="updateMenuSettings"
        :buttonPos="{ top: 24, right: 24 }"
      />
    </div>
    <div v-else-if="isLoading" :[componentHash]="true">
      <div :[componentHash]="true" class="MCS__character-stats">
        <!-- Left side: Label + Number pairs -->
        <div
          :[componentHash]="true"
          class="MCS__character-stats__details"
          v-show="!isOverflowing"
        >
          <div :[componentHash]="true">
            <div :[componentHash]="true" class="skeleton-row">
              <span class="UiSkeleton skeleton-label"></span>
              <span class="UiSkeleton skeleton-label"></span>
              <span class="UiSkeleton skeleton-label"></span>
              <span class="UiSkeleton skeleton-label"></span>
            </div>
          </div>
        </div>

        <!-- Right side: Donut chart + Legend -->
        <div :[componentHash]="true" class="MCS__character-stats__chart">
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
    <div
      v-else-if="error"
      :[componentHash]="true"
      class="MCS__character-stats-card"
    >
      <p :[componentHash]="true" class="UiTypo UiTypo__body2">
        {{ error }}
      </p>
    </div>
    <div v-else :[componentHash]="true" class="MCS__character-stats-card">
      <p :[componentHash]="true" class="UiTypo UiTypo__body2">
        Could not load character status data.
      </p>
    </div>
  </div>
</template>

<style scoped>
.MCS__character-chart {
  display: flex;
  flex-wrap: wrap;
  flex-direction: row;
  align-items: center;
  justify-content: center;
  gap: 16px;
  margin: 16px 0;
}

.MCS__character-stats__details {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}

.MCS__character-stats__chart {
  display: flex;
  align-items: center;
  justify-content: center;
}

.MCS__character-stats__chart__donut {
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
