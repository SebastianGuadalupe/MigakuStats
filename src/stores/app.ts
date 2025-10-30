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
        if (data.theme) theme.value = data.theme;
        if (data.selectedDeckId) selectedDeckId.value = data.selectedDeckId;
        if (data.componentHash) componentHash.value = data.componentHash;
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
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
      console.error('Failed to save app state to localStorage:', error);
    }
  }

  watch([language, theme, selectedDeckId, componentHash], saveToStorage);

  function setLanguage(newLanguage: string | null) { language.value = newLanguage; }
  function setTheme(newTheme: string | null) { theme.value = newTheme; }
  function setSelectedDeckId(newDeckId: string) { selectedDeckId.value = newDeckId; }
  function setAvailableDecks(newAvailableDecks: Deck[]) { availableDecks.value = newAvailableDecks; }
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
