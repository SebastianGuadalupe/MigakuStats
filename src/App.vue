<script setup lang="ts">
import {
  ref,
  computed,
  onMounted,
  onUnmounted,
  nextTick,
  onUpdated,
} from "vue";
import draggable from "vuedraggable";
import { logger } from "./utils/logger";
import { setupThemeObserver, setupLanguageObserver } from "./utils/observers";
import { SELECTORS, ATTRIBUTES } from "./utils/constants";
import { useAppStore } from "./stores/app";
import { useCardsStore } from "./stores/cards";
import WordCount from "./components/WordCount.vue";
import NativeStats from './components/NativeStats.vue';

const appStore = useAppStore();
const cardsStore = useCardsStore();
const componentHash = computed(() => appStore.componentHash || "");
const themeObserver = ref<MutationObserver | null>(null);
const languageObserver = ref<MutationObserver | null>(null);
const moveMode = ref(false);

const cardComponents: Record<string, any> = {
  NativeStats,
  WordCount,
  // Add more cards as needed
};

const orderedCards = computed(() => cardsStore.cards);
const visibleCards = computed(() => cardsStore.cards.filter((c) => c.visible));

function setMoveMode(value: boolean) {
  moveMode.value = value;
}

function onReorder(evt: any) {
  const newOrder = evt.to
    ? Array.from(evt.to.children)
        .map((el: any) => el.getAttribute("data-card-id"))
        .filter((x: string | null): x is string => !!x)
    : orderedCards.value.map((c) => c.id);
  cardsStore.setCardsOrder(newOrder);
}

function hideCard(id: string) {
  cardsStore.hideCard(id);
}

onMounted(() => {
  logger.debug("App component mounted! 🎉");
  const mainElement = document.querySelector(SELECTORS.MIGAKU_MAIN);
  if (!mainElement) {
    logger.error("Main Migaku element not found - this should not happen");
    return;
  }
  logger.debug("Setting up observers");
  themeObserver.value = setupThemeObserver((newTheme) => {
    logger.debug(`Theme changed to: ${newTheme}`);
    appStore.setTheme(newTheme);
  });
  languageObserver.value = setupLanguageObserver(mainElement, (newLanguage) => {
    logger.debug(`Language changed to: ${newLanguage}`);
    appStore.setLanguage(newLanguage);
    appStore.resetDeckSelection();
    logger.debug(`Reset deck selection due to language change`);
  });
  const currentTheme = document.documentElement.getAttribute(ATTRIBUTES.THEME);
  const currentLanguage = mainElement.getAttribute(ATTRIBUTES.LANG_SELECTED);
  if (currentTheme) {
    appStore.setTheme(currentTheme);
  }
  if (currentLanguage) {
    appStore.setLanguage(currentLanguage);
  }
  const componentHash = document.querySelector(SELECTORS.STATISTICS_ELEMENT)
    ?.attributes[0].nodeName;
  if (componentHash) {
    appStore.setComponentHash(componentHash);
  }
  logger.debug(`Component hash: ${componentHash}`);
});

onUnmounted(() => {
  logger.debug("Cleaning up observers");
  if (themeObserver.value) {
    themeObserver.value.disconnect();
    themeObserver.value = null;
  }
  if (languageObserver.value) {
    languageObserver.value.disconnect();
    languageObserver.value = null;
  }
});

function renderCardComponent(id: string) {
  return cardComponents[id] || null;
}
</script>

<template>
  <div style="margin-bottom: 12px; display: flex; gap: 12px">
    <button
      :[componentHash]="true"
      @click="setMoveMode(!moveMode)"
      class="UiButton -plain -icon-only -icon-left -floating"
    >
      <div class="UiButton__icon">
        <div class="UiIcon" style="width: 24px;">
          <div class="UiSvg__inner" style="margin: 0; font-size: 24px;">
            {{ moveMode ? "🔒" : "🔀" }}
          </div>
        </div>
      </div>
    </button>
    <template v-if="moveMode">
      <small class="UiTypo">Drag cards to reorder or click hide</small>
    </template>
  </div>
  <draggable
    v-if="moveMode"
    :list="orderedCards"
    group="cards"
    handle=".move-handle"
    item-key="id"
    class="MCS__stats-grid"
    :animation="200"
    @end="onReorder"
  >
    <template #item="{ element }">
      <div class="MCS__stats-card" :data-card-id="element.id">
        <div
          style="
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
            margin-bottom: 4px;
          "
        >
          <span class="move-handle" style="cursor: move; user-select: none"
            >⠿</span
          >
          <button
            @click="hideCard(element.id)"
            class="UiButton UiButton--icon"
            title="Hide card"
          >
            ✖️
          </button>
        </div>
        <component :is="renderCardComponent(element.id)" />
      </div>
    </template>
  </draggable>
  <div v-else class="MCS__stats-grid">
    <div
      v-for="element in visibleCards"
      :key="element.id"
      class="MCS__stats-card"
      :data-card-id="element.id"
    >
      <component :is="renderCardComponent(element.id)" />
    </div>
  </div>
</template>

<style scoped>
.MCS__stats-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 20px;
  width: fit-content;
  max-width: calc(100% - 32px);
}
.MCS__stats-card {
  min-width: 250px;
  max-width: 400px;
}
</style>
