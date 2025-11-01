<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { useAppStore } from '../stores/app';
import { useStudyStatsStore } from '../stores/studyStats';
import { useCardsStore } from '../stores/cards';
import FloatingMenuButton from './FloatingMenuButton.vue';

const appStore = useAppStore();
const cardsStore = useCardsStore();
const componentHash = computed(() => appStore.componentHash || '');

const studyStatsStore = useStudyStatsStore();
const stats = computed(() => studyStatsStore.studyStats);
const isLoading = computed(() => studyStatsStore.isLoading);
const error = computed(() => studyStatsStore.error);
const language = computed(() => appStore.language);
const selectedDeckId = computed(() => appStore.selectedDeckId);
const periodId = computed(() => studyStatsStore.periodId);
const visibility = computed(() => studyStatsStore.visibility);

const containerRef = ref<HTMLElement|null>(null);

onMounted(async () => {
  if (language.value) await studyStatsStore.refetch(language.value, selectedDeckId.value);
});
onBeforeUnmount(() => {});

watch([language, selectedDeckId, periodId], async ([lang, deck, period], _prev, onCleanup) => {
  if (!lang) return;
  const promise = studyStatsStore.fetchStudyStatsIfNeeded(lang, deck, period);
  let cancelled = false; onCleanup(() => (cancelled = true));
  await promise; if (cancelled) return;
});

function formatTime(seconds: number): string {
  if (seconds === 0 || !seconds) return '0s';
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
    return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
  }
  if (minutes > 0) {
    const remainingSeconds = secs % 60;
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
  }
  return `${secs}s`;
}

const menuSettings = [
  {
    key: 'periodId',
    label: 'Period',
    type: 'dropdown' as const,
    options: ['1 Month','2 Months','3 Months','6 Months','1 Year','All time'],
    value: periodId.value,
    displayPrefix: 'Last ',
  },
  {
    key: 'percGroup',
    label: 'Percentages (group)',
    type: 'group' as const,
    value: visibility.value.percGroup,
    children: [
      { key: 'daysStudiedPercent', label: 'Days studied %', type: 'switch' as const, value: visibility.value.daysStudiedPercent },
      { key: 'passRate', label: 'Pass rate', type: 'switch' as const, value: visibility.value.passRate },
    ]
  },
  {
    key: 'totalsGroup',
    label: 'Totals (group)',
    type: 'group' as const,
    value: visibility.value.totalsGroup,
    children: [
      { key: 'totalReviews', label: 'Total reviews', type: 'switch' as const, value: visibility.value.totalReviews },
      { key: 'totalCardsAdded', label: 'Total cards added', type: 'switch' as const, value: visibility.value.totalCardsAdded },
      { key: 'totalNewCards', label: 'Total new cards reviewed', type: 'switch' as const, value: visibility.value.totalNewCards },
      { key: 'totalCardsLearned', label: 'Total cards learned', type: 'switch' as const, value: visibility.value.totalCardsLearned },
    ]
  },
  {
    key: 'avgsGroup',
    label: 'Averages (group)',
    type: 'group' as const,
    value: visibility.value.avgsGroup,
    children: [
      { key: 'avgReviewsPerDay', label: 'Avg. reviews/day', type: 'switch' as const, value: visibility.value.avgReviewsPerDay },
      { key: 'cardsAddedPerDay', label: 'Avg. cards added/day', type: 'switch' as const, value: visibility.value.cardsAddedPerDay },
      { key: 'newCardsPerDay', label: 'Avg. new cards/day', type: 'switch' as const, value: visibility.value.newCardsPerDay },
      { key: 'cardsLearnedPerDay', label: 'Avg. cards learned/day', type: 'switch' as const, value: visibility.value.cardsLearnedPerDay },
    ]
  },
  {
    key: 'timeGroup',
    label: 'Time (group)',
    type: 'group' as const,
    value: visibility.value.timeGroup,
    children: [
      { key: 'totalTimeNewCards', label: 'Total time on new cards', type: 'switch' as const, value: visibility.value.totalTimeNewCards },
      { key: 'avgTimeNewCard', label: 'Avg. time/new card', type: 'switch' as const, value: visibility.value.avgTimeNewCard },
      { key: 'totalTimeReviews', label: 'Total time on reviews', type: 'switch' as const, value: visibility.value.totalTimeReviews },
      { key: 'avgTimeReview', label: 'Avg. time/review', type: 'switch' as const, value: visibility.value.avgTimeReview },
    ]
  },
];
const menuValues = computed(() => ({ periodId: periodId.value, ...visibility.value }));
function updateMenuSettings(newVals: any) {
  if (newVals.periodId && newVals.periodId !== periodId.value) studyStatsStore.setPeriod(newVals.periodId);
  const current = visibility.value;
  const updated: any = { ...current };
  for (const k in updated) { if (k in newVals) updated[k] = !!newVals[k]; }
  studyStatsStore.setVisibilities(updated);
}
</script>

<template>
  <div :[componentHash]="true" class="UiCard -lesson Statistic__card" ref="containerRef">
    <h3 :[componentHash]="true" class="UiTypo UiTypo__heading3 -heading Statistic__title">Study Statistics</h3>
    <div style="padding: 16px; position: relative; min-height: 140px;">
      <template v-if="stats && !isLoading && !error">
        <h4 v-if="visibility.percGroup && (visibility.daysStudiedPercent || visibility.passRate)" :[componentHash]="true" class="UiTypo UiTypo__heading4 -heading">Percentages</h4>
        <div v-if="visibility.percGroup && (visibility.daysStudiedPercent || visibility.passRate)" class="MCS__study-grid">
          <div v-if="visibility.percGroup && visibility.daysStudiedPercent" class="MCS__stat-box">
            <div class="MCS__stat-value">{{ stats.days_studied_percent }}%</div>
            <div class="MCS__stat-label">of days studied</div>
          </div>
          <div v-if="visibility.percGroup && visibility.passRate" class="MCS__stat-box">
            <div class="MCS__stat-value">{{ stats.pass_rate }}%</div>
            <div class="MCS__stat-label">Pass rate</div>
          </div>
        </div>
        <h4 v-if="visibility.totalsGroup && (visibility.totalReviews || visibility.totalCardsAdded || visibility.totalNewCards || visibility.totalCardsLearned)" :[componentHash]="true" class="UiTypo UiTypo__heading4 -heading">Totals</h4>
        <div v-if="visibility.totalsGroup && (visibility.totalReviews || visibility.totalCardsAdded || visibility.totalNewCards || visibility.totalCardsLearned)" class="MCS__study-grid">
          <div v-if="visibility.totalsGroup && visibility.totalReviews" class="MCS__stat-box">
            <div class="MCS__stat-value">{{ stats.total_reviews.toLocaleString() }}</div>
            <div class="MCS__stat-label">Total reviews</div>
          </div>
          <div v-if="visibility.totalsGroup && visibility.totalCardsAdded" class="MCS__stat-box">
            <div class="MCS__stat-value">{{ stats.total_cards_added.toLocaleString() }}</div>
            <div class="MCS__stat-label">Total cards added</div>
          </div>
          <div v-if="visibility.totalsGroup && visibility.totalNewCards" class="MCS__stat-box">
            <div class="MCS__stat-value">{{ stats.total_new_cards.toLocaleString() }}</div>
            <div class="MCS__stat-label">Total new cards reviewed</div>
          </div>
          <div v-if="visibility.totalsGroup && visibility.totalCardsLearned" class="MCS__stat-box">
            <div class="MCS__stat-value">{{ stats.total_cards_learned.toLocaleString() }}</div>
            <div class="MCS__stat-label">Total cards learned</div>
          </div>
        </div>
        <h4 v-if="visibility.avgsGroup && (visibility.avgReviewsPerDay || visibility.cardsAddedPerDay || visibility.newCardsPerDay || visibility.cardsLearnedPerDay)" :[componentHash]="true" class="UiTypo UiTypo__heading4 -heading">Averages</h4>
        <div v-if="visibility.avgsGroup && (visibility.avgReviewsPerDay || visibility.cardsAddedPerDay || visibility.newCardsPerDay || visibility.cardsLearnedPerDay)" class="MCS__study-grid">
          <div v-if="visibility.avgsGroup && visibility.avgReviewsPerDay" class="MCS__stat-box">
            <div class="MCS__stat-value">{{ stats.avg_reviews_per_calendar_day }}</div>
            <div class="MCS__stat-label">Avg. reviews/day</div>
          </div>
          <div v-if="visibility.avgsGroup && visibility.cardsAddedPerDay" class="MCS__stat-box">
            <div class="MCS__stat-value">{{ stats.cards_added_per_day }}</div>
            <div class="MCS__stat-label">Avg. cards added/day</div>
          </div>
          <div v-if="visibility.avgsGroup && visibility.newCardsPerDay" class="MCS__stat-box">
            <div class="MCS__stat-value">{{ stats.new_cards_per_day }}</div>
            <div class="MCS__stat-label">Avg. new cards/day</div>
          </div>
          <div v-if="visibility.avgsGroup && visibility.cardsLearnedPerDay" class="MCS__stat-box">
            <div class="MCS__stat-value">{{ stats.cards_learned_per_day }}</div>
            <div class="MCS__stat-label">Avg. cards learned/day</div>
          </div>
        </div>
        <h4 v-if="visibility.timeGroup && (visibility.totalTimeNewCards || visibility.avgTimeNewCard || visibility.totalTimeReviews || visibility.avgTimeReview)" :[componentHash]="true" class="UiTypo UiTypo__heading4 -heading">Time</h4>
        <div v-if="visibility.timeGroup && (visibility.totalTimeNewCards || visibility.avgTimeNewCard || visibility.totalTimeReviews || visibility.avgTimeReview)" class="MCS__study-grid">
          <div v-if="visibility.timeGroup && visibility.totalTimeNewCards" class="MCS__stat-box">
            <div class="MCS__stat-value">{{ formatTime(stats.total_time_new_cards_seconds) }}</div>
            <div class="MCS__stat-label">Total time on new cards</div>
          </div>
          <div v-if="visibility.timeGroup && visibility.avgTimeNewCard" class="MCS__stat-box">
            <div class="MCS__stat-value">{{ formatTime(stats.avg_time_new_card_seconds) }}</div>
            <div class="MCS__stat-label">Avg. time/new card</div>
          </div>
          <div v-if="visibility.timeGroup && visibility.totalTimeReviews" class="MCS__stat-box">
            <div class="MCS__stat-value">{{ formatTime(stats.total_time_reviews_seconds) }}</div>
            <div class="MCS__stat-label">Total time on reviews</div>
          </div>
          <div v-if="visibility.timeGroup && visibility.avgTimeReview" class="MCS__stat-box">
            <div class="MCS__stat-value">{{ formatTime(stats.avg_time_review_seconds) }}</div>
            <div class="MCS__stat-label">Avg. time/review</div>
          </div>
        </div>
      </template>
      <template v-else-if="isLoading">
        <h4 v-if="visibility.percGroup && (visibility.daysStudiedPercent || visibility.passRate)" :[componentHash]="true" class="UiTypo UiTypo__heading4 -heading">Percentages</h4>
        <div v-if="visibility.percGroup && (visibility.daysStudiedPercent || visibility.passRate)" class="MCS__study-grid">
          <div v-if="visibility.percGroup && visibility.daysStudiedPercent" class="MCS__stat-box">
            <span class="UiSkeleton" style="width: 60%; height: 28px; border-radius: 8px"></span>
            <span class="UiSkeleton" style="width: 70%; height: 14px; margin-top: 8px; border-radius: 8px"></span>
          </div>
          <div v-if="visibility.percGroup && visibility.passRate" class="MCS__stat-box">
            <span class="UiSkeleton" style="width: 60%; height: 28px; border-radius: 8px"></span>
            <span class="UiSkeleton" style="width: 70%; height: 14px; margin-top: 8px; border-radius: 8px"></span>
          </div>
        </div>
        <h4 v-if="visibility.totalsGroup && (visibility.totalReviews || visibility.totalCardsAdded || visibility.totalNewCards || visibility.totalCardsLearned)" :[componentHash]="true" class="UiTypo UiTypo__heading4 -heading">Totals</h4>
        <div v-if="visibility.totalsGroup && (visibility.totalReviews || visibility.totalCardsAdded || visibility.totalNewCards || visibility.totalCardsLearned)" class="MCS__study-grid">
          <div v-if="visibility.totalsGroup && visibility.totalReviews" class="MCS__stat-box">
            <span class="UiSkeleton" style="width: 70%; height: 24px; border-radius: 8px"></span>
            <span class="UiSkeleton" style="width: 60%; height: 14px; margin-top: 8px; border-radius: 8px"></span>
          </div>
          <div v-if="visibility.totalsGroup && visibility.totalCardsAdded" class="MCS__stat-box">
            <span class="UiSkeleton" style="width: 70%; height: 24px; border-radius: 8px"></span>
            <span class="UiSkeleton" style="width: 60%; height: 14px; margin-top: 8px; border-radius: 8px"></span>
          </div>
          <div v-if="visibility.totalsGroup && visibility.totalNewCards" class="MCS__stat-box">
            <span class="UiSkeleton" style="width: 70%; height: 24px; border-radius: 8px"></span>
            <span class="UiSkeleton" style="width: 60%; height: 14px; margin-top: 8px; border-radius: 8px"></span>
          </div>
          <div v-if="visibility.totalsGroup && visibility.totalCardsLearned" class="MCS__stat-box">
            <span class="UiSkeleton" style="width: 70%; height: 24px; border-radius: 8px"></span>
            <span class="UiSkeleton" style="width: 60%; height: 14px; margin-top: 8px; border-radius: 8px"></span>
          </div>
        </div>
        <h4 v-if="visibility.avgsGroup && (visibility.avgReviewsPerDay || visibility.cardsAddedPerDay || visibility.newCardsPerDay || visibility.cardsLearnedPerDay)" :[componentHash]="true" class="UiTypo UiTypo__heading4 -heading">Averages</h4>
        <div v-if="visibility.avgsGroup && (visibility.avgReviewsPerDay || visibility.cardsAddedPerDay || visibility.newCardsPerDay || visibility.cardsLearnedPerDay)" class="MCS__study-grid">
          <div v-if="visibility.avgsGroup && visibility.avgReviewsPerDay" class="MCS__stat-box">
            <span class="UiSkeleton" style="width: 60%; height: 24px; border-radius: 8px"></span>
            <span class="UiSkeleton" style="width: 70%; height: 14px; margin-top: 8px; border-radius: 8px"></span>
          </div>
          <div v-if="visibility.avgsGroup && visibility.cardsAddedPerDay" class="MCS__stat-box">
            <span class="UiSkeleton" style="width: 60%; height: 24px; border-radius: 8px"></span>
            <span class="UiSkeleton" style="width: 70%; height: 14px; margin-top: 8px; border-radius: 8px"></span>
          </div>
          <div v-if="visibility.avgsGroup && visibility.newCardsPerDay" class="MCS__stat-box">
            <span class="UiSkeleton" style="width: 60%; height: 24px; border-radius: 8px"></span>
            <span class="UiSkeleton" style="width: 70%; height: 14px; margin-top: 8px; border-radius: 8px"></span>
          </div>
          <div v-if="visibility.avgsGroup && visibility.cardsLearnedPerDay" class="MCS__stat-box">
            <span class="UiSkeleton" style="width: 60%; height: 24px; border-radius: 8px"></span>
            <span class="UiSkeleton" style="width: 70%; height: 14px; margin-top: 8px; border-radius: 8px"></span>
          </div>
        </div>
        <h4 v-if="visibility.timeGroup && (visibility.totalTimeNewCards || visibility.avgTimeNewCard || visibility.totalTimeReviews || visibility.avgTimeReview)" :[componentHash]="true" class="UiTypo UiTypo__heading4 -heading">Time</h4>
        <div v-if="visibility.timeGroup && (visibility.totalTimeNewCards || visibility.avgTimeNewCard || visibility.totalTimeReviews || visibility.avgTimeReview)" class="MCS__study-grid">
          <div v-if="visibility.timeGroup && visibility.totalTimeNewCards" class="MCS__stat-box">
            <span class="UiSkeleton" style="width: 60%; height: 24px; border-radius: 8px"></span>
            <span class="UiSkeleton" style="width: 70%; height: 14px; margin-top: 8px; border-radius: 8px"></span>
          </div>
          <div v-if="visibility.timeGroup && visibility.avgTimeNewCard" class="MCS__stat-box">
            <span class="UiSkeleton" style="width: 60%; height: 24px; border-radius: 8px"></span>
            <span class="UiSkeleton" style="width: 70%; height: 14px; margin-top: 8px; border-radius: 8px"></span>
          </div>
          <div v-if="visibility.timeGroup && visibility.totalTimeReviews" class="MCS__stat-box">
            <span class="UiSkeleton" style="width: 60%; height: 24px; border-radius: 8px"></span>
            <span class="UiSkeleton" style="width: 70%; height: 14px; margin-top: 8px; border-radius: 8px"></span>
          </div>
          <div v-if="visibility.timeGroup && visibility.avgTimeReview" class="MCS__stat-box">
            <span class="UiSkeleton" style="width: 60%; height: 24px; border-radius: 8px"></span>
            <span class="UiSkeleton" style="width: 70%; height: 14px; margin-top: 8px; border-radius: 8px"></span>
          </div>
        </div>
      </template>
      <template v-else-if="error"><span>{{ error }}</span></template>
      <template v-else><span>Could not load study statistics.</span></template>

      <FloatingMenuButton
        v-if="!isLoading && !error && !cardsStore.isMoveModeActive"
        :settings="menuSettings"
        :modelValue="menuValues"
        @update:modelValue="updateMenuSettings"
        :buttonPos="{ top: 24, right: 24 }"
        :width="350"
      />
    </div>
  </div>
</template>

<style scoped>
.MCS__study-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  gap: 12px;
  margin: 16px 0;
}
.MCS__stat-box {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 16px;
    background: rgba(0, 199, 164, 0.05);
    border-radius: 8px;
}
    
.MCS__stat-value {
    font-size: 24px;
    font-weight: bold;
    margin-bottom: 8px;
}

.MCS__stat-label {
    font-size: 14px;
    text-align: center;
}
</style>
