<script setup lang="ts">
import { computed } from 'vue';
import { useCharacterStatsStore } from '../stores/characterStats';
import { useAppStore } from '../stores/app';

const props = defineProps({
  filterId: { type: Number, default: 0 }
});

const store = useCharacterStatsStore();
const appStore = useAppStore();
const componentHash = computed(() => appStore.componentHash || '');

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

const groupedCharacters = computed((): CharacterGroup[] => {
  if (!store.characterStats) {
    return [];
  }

  const knownSet = new Set(store.characterStats.knownCharacters);
  const learningSet = new Set(store.characterStats.learningCharacters);
  
  const getStatus = (char: string): 'known' | 'learning' | 'unknown' => {
    if (knownSet.has(char)) return 'known';
    if (learningSet.has(char)) return 'learning';
    return 'unknown';
  };

  const allChars = [...knownSet, ...learningSet];
  const characters = allChars.map(char => ({
    character: char,
    status: getStatus(char)
  }));
  
  const knownCount = characters.filter(c => c.status === 'known').length;
  const totalCount = characters.length;
  
  return [{
    label: 'All Characters',
    characters,
    knownCount,
    totalCount
  }];
});

const overallStats = computed(() => {
  if (!store.characterStats) return '';
  const known = groupedCharacters.value.reduce((sum, g) => sum + g.knownCount, 0);
  const total = groupedCharacters.value.reduce((sum, g) => sum + g.totalCount, 0);
  const percentage = total > 0 ? ((known / total) * 100).toFixed(2) : '0.00';
  return `${known}/${total} - ${percentage}%`;
});
</script>

<template>
  <div :class="['MCS__character-grid-wrapper', { 'MCS__character-grid-wrapper--single-group': groupedCharacters.length === 1 }]">
    <div class="MCS__character-grid-header" :[componentHash]="true">
        <h3 class="UiTypo UiTypo__heading3 -heading" :[componentHash]="true">All Characters</h3>
        <p class="UiTypo UiTypo__caption" :[componentHash]="true">{{ overallStats }}</p>
    </div>
    <div 
      v-for="group in groupedCharacters" 
      :key="group.label ?? 'all'"
      class="MCS__character-group"
    >
      <div v-if="group.label && groupedCharacters.length > 1" class="MCS__character-group-header" :[componentHash]="true">
          <h4 class="UiTypo UiTypo__heading4 -heading" :[componentHash]="true">{{ group.label }}</h4>
          <p class="UiTypo UiTypo__caption" :[componentHash]="true">{{ group.knownCount }}/{{ group.totalCount }} - {{ ((group.knownCount / group.totalCount) * 100).toFixed(1) }}%</p>
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

<style scoped>
.MCS__character-grid-wrapper {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
}

.MCS__character-grid-wrapper--single-group {
  overflow-y: auto;
}

.MCS__character-group {
  flex: 1 1 auto;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
}

.MCS__character-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(40px, 1fr));
  gap: 10px;
  padding: 10px;
  flex: 1 1 auto;
  overflow-y: auto;
  margin-bottom: 20px;
}

.MCS__character-grid-header, .MCS__character-group-header {
  text-align: center;
  margin-bottom: 10px;
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