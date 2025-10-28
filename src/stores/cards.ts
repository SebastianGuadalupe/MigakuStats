import { defineStore } from 'pinia';
import { ref, watch } from 'vue';

export interface CardState {
  id: string;
  visible: boolean;
}
const STORAGE_KEY = 'migaku-cards';
const DEFAULT_CARDS: CardState[] = [
  { id: 'NativeStats', visible: true },
  { id: 'WordCount', visible: true },
  // Add more cards as needed
];

export const useCardsStore = defineStore('cards', () => {
  const cards = ref<CardState[]>([...DEFAULT_CARDS]);

  function loadFromStorage() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        if (Array.isArray(data)) cards.value = data;
      }
    } catch (error) {
      console.error('Failed to load cards from localStorage:', error);
    }
  }

  function saveToStorage() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cards.value));
    } catch (error) {
      console.error('Failed to save cards to localStorage:', error);
    }
  }

  watch(cards, saveToStorage, { deep: true });

  function setCardsOrder(newOrder: string[]) {
    cards.value = newOrder.map(id => {
      const existing = cards.value.find(c => c.id === id);
      return existing || { id, visible: true };
    });
  }
  function hideCard(id: string) {
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
  return {
    cards,
    setCardsOrder,
    hideCard,
    showCard,
    toggleCardVisibility,
    loadFromStorage
  };
});
