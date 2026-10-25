import { saveSetting } from '../utils/storage';
import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import { APP_SETTINGS } from '../utils/constants';
import { Deck } from '../types/Deck';

const STORAGE_KEY = 'migaku-app';

export const useAppStore = defineStore('app', () => {
  const language = ref<string | null>(null);
  const theme = ref<string | null>(null);
  const availableDecks = ref<Deck[]>([{ id: APP_SETTINGS.DEFAULT_DECK_ID, name: 'All decks', lang: 'all' }]);
  const selectedDeckId = ref<string>(APP_SETTINGS.DEFAULT_DECK_ID);
  const componentHash = ref<string | null>(null);

  function loadFromStorage() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const data = JSON.parse(stored);
        if (data.language) language.value = data.language;
        if (['light', 'dark'].includes(data.theme)) theme.value = data.theme;
        if (data.selectedDeckId) selectedDeckId.value = data.selectedDeckId;
        // Component scope belongs to the running build, not persisted host markup.
      }
    } catch (error) {
      console.error('Failed to load app state from localStorage:', error);
    }
  }

  function saveToStorage() {
    try {
      const data = {
        language: language.value,
        theme: theme.value,
        selectedDeckId: selectedDeckId.value,
        componentHash: componentHash.value,
      };
      saveSetting(STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
      console.error('Failed to save app state to localStorage:', error);
    }
  }

  watch([language, theme, selectedDeckId, componentHash], saveToStorage);

  function setLanguage(newLanguage: string | null) {
    if (language.value !== newLanguage) resetDeckSelection();
    language.value = newLanguage;
  }
  function setTheme(newTheme: string | null) { theme.value = newTheme === 'light' ? 'light' : 'dark'; }
  function setSelectedDeckId(newDeckId: string) { selectedDeckId.value = newDeckId; }
  function setAvailableDecks(newAvailableDecks: Deck[]) {
    availableDecks.value = newAvailableDecks;
    if (!newAvailableDecks.some(deck => deck.id === selectedDeckId.value && (deck.lang === language.value || deck.lang === 'all'))) resetDeckSelection();
  }
  function setComponentHash(hash: string) { componentHash.value = hash; }
  function resetDeckSelection() { selectedDeckId.value = APP_SETTINGS.DEFAULT_DECK_ID; }

  return {
    language,
    theme,
    selectedDeckId,
    availableDecks,
    componentHash,
    setLanguage,
    setTheme,
    setSelectedDeckId,
    setAvailableDecks,
    setComponentHash,
    resetDeckSelection,
    loadFromStorage
  };
});
