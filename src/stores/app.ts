import { defineStore } from 'pinia';
import { ref, watch } from 'vue';
import { APP_SETTINGS } from '../utils/constants';

interface AppState {
  selectedDeckId: string;
}

const STORAGE_KEY = 'migaku-custom-stats';

export const useAppStore = defineStore('app', () => {
  const language = ref<string | null>(null);
  const theme = ref<string | null>(null);
  const selectedDeckId = ref<string>(APP_SETTINGS.DEFAULT_DECK_ID);
  const componentHash = ref<string | null>(null);

  function loadFromStorage() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const data: AppState = JSON.parse(stored);
        if (data.selectedDeckId) selectedDeckId.value = data.selectedDeckId;
      }
    } catch (error) {
      console.error('Failed to load app state from localStorage:', error);
    }
  }

  function saveToStorage() {
    try {
      const data: AppState = {
        selectedDeckId: selectedDeckId.value,
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
      console.error('Failed to save app state to localStorage:', error);
    }
  }

  watch(selectedDeckId, saveToStorage);

  function setLanguage(newLanguage: string | null) {
    language.value = newLanguage;
  }

  function setTheme(newTheme: string | null) {
    theme.value = newTheme;
  }

  function setSelectedDeckId(newDeckId: string) {
    selectedDeckId.value = newDeckId;
  }

  function setComponentHash(hash: string) {
    componentHash.value = hash;
  }

  function resetDeckSelection() {
    selectedDeckId.value = 'all';
  }

  return {
    // State
    language,
    theme,
    selectedDeckId,
    componentHash,
    // Actions
    setLanguage,
    setTheme,
    setSelectedDeckId,
    setComponentHash,
    resetDeckSelection,
    loadFromStorage,
  };
});
