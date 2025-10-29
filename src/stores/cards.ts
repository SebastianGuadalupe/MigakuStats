import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { Layout, GridItemProps } from 'grid-layout-plus';

export interface CardState {
  id: string;
  visible: boolean;
  item: GridItemProps;
}
const STORAGE_KEY = 'migaku-cards';
const DEFAULT_CARDS: CardState[] = [
  { id: 'NativeStats', visible: true, item: { i: 'NativeStats', x: 0, y: 0, w: 6, h: 17, minW: 6, maxW: 12, minH: 5, maxH: Infinity } },
  { id: 'WordCount', visible: true, item: { i: 'WordCount', x: 6, y: 0, w: 6, h: 5, minW: 4, maxW: 12, minH: 5, maxH: 8 } },
  { id: 'CardsDue', visible: true, item: { i: 'CardsDue', x: 6, y: 5, w: 6, h: 6, minW: 4, maxW: 12, minH: 5, maxH: 8 } },
  { id: 'ReviewHistory', visible: true, item: { i: 'ReviewHistory', x: 6, y: 11, w: 6, h: 6, minW: 4, maxW: 12, minH: 5, maxH: 8 } }
];

export const useCardsStore = defineStore('cards', () => {
  const cards = ref<CardState[]>([...DEFAULT_CARDS]);
  const isMoveModeActive = ref(false);

  function loadFromStorage() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const loaded = JSON.parse(stored);
        if (Array.isArray(loaded)) {
          const merged = loaded.map((userCard: any) => {
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
              merged.push(defaultCard);
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
          h: card.item.h
        }
      }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
      console.error('Failed to save cards to localStorage:', error);
    }
  }

  function hideCard(id: string) {
    console.log('hideCard', id);
    const card = cards.value.find(c => c.id === id);
    if (card) card.visible = false;
  }
  function showCard(id: string) {
    const card = cards.value.find(c => c.id === id);
    if (card) card.visible = true;
  }
  function toggleCardVisibility(id: string) {
    const card = cards.value.find(c => c.id === id);
    if (card) card.visible = !card.visible;
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
    cards.value.filter((card: CardState) => card.visible).map(card => card.item)
  );

  function setMoveMode(value: boolean) {
    isMoveModeActive.value = value;
  }

  return {
    cards,
    layout,
    isMoveModeActive,
    hideCard,
    showCard,
    toggleCardVisibility,
    loadFromStorage,
    updateLayout,
    setMoveMode
  };
});
