import { saveSetting } from '../utils/storage';
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { Layout, GridItemProps } from 'grid-layout-plus';

export interface CardState {
  id: string;
  visible: boolean;
  item: GridItemProps;
}
function validSize(value: number | undefined, fallback: number, maximum = 1000): number {
  return Number.isFinite(value) && value! > 0 ? Math.min(maximum, Math.ceil(value!)) : fallback;
}
const STORAGE_KEY = 'migaku-cards';
const DEFAULT_CARDS: CardState[] = [
  { id: 'NativeStats', visible: true, item: { i: 'NativeStats', x: 0, y: 0, w: 6, h: 17, minW: 6, maxW: 12, minH: 5, maxH: Infinity } },
  { id: 'WordCount', visible: true, item: { i: 'WordCount', x: 6, y: 0, w: 6, h: 5, minW: 4, maxW: 12, minH: 5, maxH: 8 } },
  { id: 'CardsDue', visible: true, item: { i: 'CardsDue', x: 6, y: 5, w: 6, h: 6, minW: 4, maxW: 12, minH: 5, maxH: 8 } },
  { id: 'ReviewHistory', visible: true, item: { i: 'ReviewHistory', x: 0, y: 17, w: 6, h: 6, minW: 4, maxW: 12, minH: 5, maxH: 8 } },
  { id: 'ReviewIntervals', visible: true, item: { i: 'ReviewIntervals', x: 6, y: 11, w: 6, h: 6, minW: 4, maxW: 12, minH: 5, maxH: 8 } },
  { id: 'StudyStatistics', visible: true, item: { i: 'StudyStatistics', x: 6, y: 17, w: 6, h: 16, minW: 4, maxW: 12, minH: 5, maxH: Infinity } },
  { id: 'TimeChart', visible: true, item: { i: 'TimeChart', x: 0, y: 23, w: 6, h: 6, minW: 4, maxW: 12, minH: 5, maxH: 8 } },
  { id: 'KnownWordHistory', visible: true, item: { i: 'KnownWordHistory', x: 0, y: 29, w: 6, h: 6, minW: 4, maxW: 12, minH: 5, maxH: 8 } },
  { id: 'CharacterStats', visible: true, item: { i: 'CharacterStats', x: 0, y: 34, w: 12, h: 14, minW: 6, maxW: 12, minH: 5, maxH: Infinity } }
];

export const useCardsStore = defineStore('cards', () => {
  const cards = ref<CardState[]>(DEFAULT_CARDS.map(card => ({ ...card, item: { ...card.item } })));
  const isMoveModeActive = ref(false);
  const streakHeroAvailable = ref(false);
  function setStreakHeroAvailable(available: boolean) {
    streakHeroAvailable.value = available;
    if (!available || cards.value.some(card => card.id === 'StreakHero')) return;
    // Migrate existing layouts once, making room above the current cards.
    for (const card of cards.value) card.item.y += 5;
    cards.value.unshift({ id: 'StreakHero', visible: true,
      item: { i: 'StreakHero', x: 0, y: 0, w: 12, h: 5, minW: 4, maxW: 12, minH: 5, maxH: Infinity } });
    saveToStorage();
  }
  const availableCards = computed(() => cards.value.filter(card => card.id !== 'StreakHero' || streakHeroAvailable.value));

  function loadFromStorage() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const loaded = JSON.parse(stored);
        if (Array.isArray(loaded)) {
          const merged = loaded.filter((card: any) => card && typeof card.id === 'string' && card.item && ['x', 'y', 'w', 'h'].every(key => Number.isFinite(card.item[key])) && card.item.w > 0 && card.item.h > 0).map((userCard: any) => {
            const defaultCard = DEFAULT_CARDS.find(d => d.id === userCard.id);
            if (defaultCard) {
              return {
                ...defaultCard,
                ...userCard,
                item: {
                  ...defaultCard.item,
                  ...(userCard.item || {})
                }
              };
            } else {
              return userCard;
            }
          });
          for (const defaultCard of DEFAULT_CARDS) {
            if (!merged.some((c: any) => c.id === defaultCard.id)) {
              merged.push({ ...defaultCard, item: { ...defaultCard.item } });
            }
          }
          cards.value = merged;
        }
      }
    } catch (error) {
      console.error('Failed to load cards from localStorage:', error);
    }
  }

  loadFromStorage();

  function saveToStorage() {
    try {
      const data = cards.value.map(card => ({
        id: card.id,
        visible: card.visible,
        item: {
          i: card.item.i,
          x: card.item.x,
          y: card.item.y,
          w: card.item.w,
          h: card.item.h,
        }
      }));
      saveSetting(STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
      console.error('Failed to save cards to localStorage:', error);
    }
  }

  function hideCard(id: string) {
    const card = cards.value.find(c => c.id === id);
    if (card) { card.visible = false; saveToStorage(); }
  }
  function showCard(id: string) {
    const card = cards.value.find(c => c.id === id);
    if (card) { card.visible = true; saveToStorage(); }
  }
  function toggleCardVisibility(id: string) {
    const card = cards.value.find(c => c.id === id);
    if (card) { card.visible = !card.visible; saveToStorage(); }
  }

  function updateLayout(layoutArr: Layout): void {
    for (const layoutItem of layoutArr) {
      const card = cards.value.find(c => c.item.i === layoutItem.i);
      if (card) {
        card.item.x = layoutItem.x;
        card.item.y = layoutItem.y;
        card.item.w = layoutItem.w;
        card.item.h = layoutItem.h;
      }
    }
    saveToStorage();
  }

  const layout = computed(() =>
    availableCards.value.filter((card: CardState) => card.visible).map(card => card.item)
  );

  function setMoveMode(value: boolean) {
    isMoveModeActive.value = value;
  }

  function ensureCard(id: string, opts?: Partial<GridItemProps> & { minW?: number; minH?: number, defaultW?: number, defaultH?: number }): void {
    let card = cards.value.find(c => c.id === id);
    if (!card) {
      const minW = validSize(opts?.minW, 4, 12);
      const minH = validSize(opts?.minH, 5);
      const w = Math.max(minW, validSize(opts?.w ?? opts?.defaultW, minW, 12));
      const h = Math.max(minH, validSize(opts?.h ?? opts?.defaultH, minH));
      const x = opts?.x ?? 0;
      const y = opts?.y ?? 1000;
      const item: GridItemProps = {
        i: id,
        x,
        y,
        w,
        h,
        minW,
        minH,
      } as any;
      card = { id, visible: true, item };
      cards.value.push(card);
    } else {
      if (opts?.minW !== undefined) card.item.minW = validSize(opts.minW, 4, 12);
      if (opts?.minH !== undefined) card.item.minH = validSize(opts.minH, 5);
    }
    saveToStorage();
  }

  return {
    cards,
    availableCards,
    setStreakHeroAvailable,
    layout,
    isMoveModeActive,
    hideCard,
    showCard,
    toggleCardVisibility,
    loadFromStorage,
    updateLayout,
    setMoveMode,
    ensureCard
  };
});
