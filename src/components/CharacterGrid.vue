<script setup lang="ts">
import { computed, watch, ref } from 'vue';
import { useCharacterStatsStore } from '../stores/characterStats';
import { useAppStore } from '../stores/app';
import { fetchFilteredKanji, FILTER_OPTIONS } from '../utils/kanjiDatabase';

const props = defineProps({
  filterId: { type: Number, default: 0 }
});

const store = useCharacterStatsStore();
const appStore = useAppStore();
const componentHash = computed(() => appStore.componentHash || '');
const gridCellWidth = computed(() => store.gridCellWidth);

const filteredKanji = ref<Array<{ character: string; level: number }>>([]);
const isLoadingFilter = ref(false);

interface CharacterWithStatus {
  character: string;
  status: 'known' | 'learning' | 'unknown';
}

interface CharacterGroup {
  label: string | null;
  characters: CharacterWithStatus[];
  knownCount: number;
  totalCount: number;
}

watch([() => props.filterId, () => store.characterStats], async ([newFilterId, stats]) => {
  if (!stats) return;
  
  isLoadingFilter.value = true;
  try {
    const result = await fetchFilteredKanji(
      newFilterId,
      stats.knownCharacters,
      stats.learningCharacters
    );
    filteredKanji.value = result;
  } catch (error) {
    console.error('Error loading filtered kanji:', error);
    filteredKanji.value = [];
  } finally {
    isLoadingFilter.value = false;
  }
}, { immediate: true });

const groupedCharacters = computed((): CharacterGroup[] => {
  if (!store.characterStats || filteredKanji.value.length === 0) {
    return [];
  }

  const knownSet = new Set(store.characterStats.knownCharacters);
  const learningSet = new Set(store.characterStats.learningCharacters);
  
  const getStatus = (char: string): 'known' | 'learning' | 'unknown' => {
    if (knownSet.has(char)) return 'known';
    if (learningSet.has(char)) return 'learning';
    return 'unknown';
  };

  const filter = FILTER_OPTIONS[props.filterId];
  if (!filter) {
    return [];
  }
  
  const groupMap = new Map<string | number, CharacterGroup>();
  const orderedLevels: (string | number)[] = [];

  for (const { character, level } of filteredKanji.value) {
    const levelLabel = filter.levelLabel(level) ?? 0;
    
    if (!groupMap.has(levelLabel)) {
      orderedLevels.push(levelLabel);
      groupMap.set(levelLabel, {
        label: typeof levelLabel === 'string' ? levelLabel : null,
        characters: [],
        knownCount: 0,
        totalCount: 0
      });
    }

    const group = groupMap.get(levelLabel)!;
    const status = getStatus(character);
    
    group.characters.push({ character, status });
    group.totalCount++;
    if (status === 'known') {
      group.knownCount++;
    }
  }


  const groups = orderedLevels.map(level => groupMap.get(level)!);

  return groups;
});

const overallStats = computed(() => {
  if (!store.characterStats) return '';
  const known = groupedCharacters.value.reduce((sum, g) => sum + g.knownCount, 0);
  const total = groupedCharacters.value.reduce((sum, g) => sum + g.totalCount, 0);
  const percentage = total > 0 ? ((known / total) * 100).toFixed(2) : '0.00';
  return `${known}/${total} - ${percentage}%`;
});

const filterLabel = computed(() => FILTER_OPTIONS[props.filterId]?.label || 'All Characters');
</script>

<template>
  <div class="MCS__character-grid-wrapper">
    <div v-if="isLoadingFilter" class="MCS__character-grid-loading" :[componentHash]="true">
      <p class="UiTypo UiTypo__caption" :[componentHash]="true">Loading character data...</p>
    </div>
    <template v-else>
      <div class="MCS__character-grid-header" :[componentHash]="true">
        <h3 class="UiTypo UiTypo__heading3 -heading" :[componentHash]="true">{{ filterLabel }}</h3>
        <p class="UiTypo UiTypo__caption" :[componentHash]="true">{{ overallStats }}</p>
      </div>
      <div class="MCS__character-groups-wrapper">
        <div 
          v-for="group in groupedCharacters" 
          :key="group.label ?? 'all'"
          :class="['MCS__character-group', { 'MCS__character-group--single': groupedCharacters.length === 1 }]"
        >
          <div v-if="group.label && groupedCharacters.length > 1" class="MCS__character-group-header" :[componentHash]="true">
            <h4 class="UiTypo UiTypo__heading4 -heading" :[componentHash]="true">{{ group.label }}</h4>
            <p class="UiTypo UiTypo__caption" :[componentHash]="true">{{ group.knownCount }}/{{ group.totalCount }} - {{ ((group.knownCount / group.totalCount) * 100).toFixed(2) }}%</p>
          </div>
          <div class="MCS__character-grid">
            <div
              v-for="char in group.characters"
              :key="char.character"
              :class="['MCS__character', `MCS__character--${char.status}`]"
            >
              {{ char.character }}
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.MCS__character-grid-wrapper {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.MCS__character-grid-loading {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 20px;
  text-align: center;
}

.MCS__character-groups-wrapper {
  flex: 1 1 auto;
  overflow-y: scroll;
  scrollbar-gutter: stable;
  display: flex;
  flex-direction: column;
}

.MCS__character-group {
  flex-shrink: 0;
  margin-bottom: 20px;
}

.MCS__character-group--single {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
}

.MCS__character-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, v-bind('gridCellWidth + "px"'));
  gap: 10px;
  padding: 10px;
  overflow-y: auto;
  scrollbar-gutter: stable;
  box-sizing: border-box;
  width: 100%;
  max-height: 400px;
  justify-content: center;
}

.MCS__character-group--single .MCS__character-grid {
  max-height: none;
  flex: 1 1 auto;
}

.MCS__character-grid-header, .MCS__character-group-header {
  text-align: center;
  margin-bottom: 10px;
  flex-shrink: 0;
}

.MCS__character {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 10px;
  font-size: 1.5rem;
  border-radius: 5px;
  user-select: text;
}

.MCS__character--known {
  background-color: #00c7a4;
}

.MCS__character--learning {
  background-color: #ff9345;
}

.MCS__character--unknown {
  background-color: #fe4670;
}
</style>