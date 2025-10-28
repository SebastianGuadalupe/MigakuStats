<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { GridLayout, Layout } from "grid-layout-plus";
import { logger } from "./utils/logger";
import { setupThemeObserver, setupLanguageObserver } from "./utils/observers";
import { SELECTORS, ATTRIBUTES } from "./utils/constants";
import { useAppStore } from "./stores/app";
import { useCardsStore } from "./stores/cards";
import WordCount from "./components/WordCount.vue";
import NativeStats from "./components/NativeStats.vue";
import CardsDue from "./components/CardsDue.vue";

import { watch } from "vue";

const appStore = useAppStore();
const cardsStore = useCardsStore();
const componentHash = computed(() => appStore.componentHash || "");
const themeObserver = ref<MutationObserver | null>(null);
const languageObserver = ref<MutationObserver | null>(null);
const moveMode = ref(false);
const layout = ref<Layout>(cardsStore.layout);

watch(
  () => cardsStore.cards.map(card => ({
    id: card.id,
    visible: card.visible,
    ...card.item
  })),
  () => {
    layout.value = cardsStore.layout;
  },
  { deep: true }
);

const cardComponents: Record<string, any> = {
  NativeStats,
  WordCount,
  CardsDue
};


function setMoveMode(value: boolean) {
  moveMode.value = value;
}

function hideCard(id: string) {
  cardsStore.hideCard(id);
}

function saveLayout(newLayout: Layout) {
  cardsStore.updateLayout(newLayout);
}

function undoLayout() {
  cardsStore.loadFromStorage();
  layout.value = cardsStore.layout;
  setMoveMode(false);
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

watch(
  () => {
    const card = cardsStore.cards.find(c => c.id === 'NativeStats');
    return card ? card.visible : true;
  },
  (visible) => {
    const node = document.getElementById('original-stats-card-container');
    if (node) {
      node.style.display = visible ? '' : 'none';
    }
  },
  { immediate: true }
);
</script>

<template>
  <div class="MCS_wrapper">
    <div style="margin-bottom: 12px; display: flex; gap: 12px">
      <button
        :[componentHash]="true"
        @click="setMoveMode(!moveMode); saveLayout(layout);"
        class="UiButton -plain -icon-only -icon-left -floating MCS__shuffle-button"
      >
        <div class="UiButton__icon">
          <div class="UiIcon" style="width: 24px">
            <div class="UiSvg__inner" style="margin: 0; font-size: 24px">
              <svg
                v-if="moveMode"
                width="100%"
                height="100%"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M17 10V8C17 5.23858 14.7614 3 12 3C9.23858 3 7 5.23858 7 8V10M12 14.5V16.5M8.8 21H15.2C16.8802 21 17.7202 21 18.362 20.673C18.9265 20.3854 19.3854 19.9265 19.673 19.362C20 18.7202 20 17.8802 20 16.2V14.8C20 13.1198 20 12.2798 19.673 11.638C19.3854 11.0735 18.9265 10.6146 18.362 10.327C17.7202 10 16.8802 10 15.2 10H8.8C7.11984 10 6.27976 10 5.63803 10.327C5.07354 10.6146 4.6146 11.0735 4.32698 11.638C4 12.2798 4 13.1198 4 14.8V16.2C4 17.8802 4 18.7202 4.32698 19.362C4.6146 19.9265 5.07354 20.3854 5.63803 20.673C6.27976 21 7.11984 21 8.8 21Z"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
              <svg
                v-else
                width="100%"
                height="100%"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M18 15L21 18M21 18L18 21M21 18H18.5689C17.6297 18 17.1601 18 16.7338 17.8705C16.3564 17.7559 16.0054 17.5681 15.7007 17.3176C15.3565 17.0348 15.096 16.644 14.575 15.8626L14.3333 15.5M18 3L21 6M21 6L18 9M21 6H18.5689C17.6297 6 17.1601 6 16.7338 6.12945C16.3564 6.24406 16.0054 6.43194 15.7007 6.68236C15.3565 6.96523 15.096 7.35597 14.575 8.13744L9.42496 15.8626C8.90398 16.644 8.64349 17.0348 8.29933 17.3176C7.99464 17.5681 7.64357 17.7559 7.2662 17.8705C6.83994 18 6.37033 18 5.43112 18H3M3 6H5.43112C6.37033 6 6.83994 6 7.2662 6.12945C7.64357 6.24406 7.99464 6.43194 8.29933 6.68236C8.64349 6.96523 8.90398 7.35597 9.42496 8.13744L9.66667 8.5"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </div>
          </div>
        </div>
      </button>
      <button
        v-if="moveMode"
        :[componentHash]="true"
        @click="undoLayout"
        class="UiButton -plain -icon-only -icon-left -floating MCS__undo-button"
      >
        <div class="UiButton__icon">
          <div class="UiIcon" style="width: 24px">
            <div class="UiSvg__inner" style="margin: 0; font-size: 24px">
              <svg
                width="100%"
                height="100%"
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M3 9H16.5C18.9853 9 21 11.0147 21 13.5C21 15.9853 18.9853 18 16.5 18H12M3 9L7 5M3 9L7 13"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                />
              </svg>
            </div>
          </div>
        </div>
      </button>
    </div>
    <GridLayout
      v-model:layout="layout"
      :col-num="12"
      :row-height="50"
      :is-draggable="moveMode"
      :is-resizable="moveMode"
      vertical-compact
      use-css-transforms
    >
      <template #item="{ item }">
        <div class="MCS__stats-card" :data-card-id="item.i">
          <div
            style="
              position: relative;
              display: flex;
              align-items: center;
              justify-content: space-between;
            "
          >
            <span
              v-if="moveMode"
              class="move-handle"
              style="
                position: absolute;
                left: 8px;
                top: 8px;
                cursor: move;
                user-select: none;
                font-size: 24px;
              "
              >⠿</span
            >
            <div style="position: absolute; right: 8px; top: 8px">
              <button
                v-if="moveMode"
                @click="hideCard(String(item.i))"
                class="UiButton UiButton--icon"
                title="Hide card"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  style="width: 24px; height: 24px"
                >
                  <path
                    d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
                  />
                </svg>
              </button>
            </div>
          </div>
          <component :is="renderCardComponent(String(item.i))" />
        </div>
      </template>
    </GridLayout>
  </div>
</template>

<style scoped>
.MCS_wrapper {
  max-width: 1080px;
  margin: 0 auto;
}

.MCS__stats-card {
  height: 100%;
}

.MCS__shuffle-button {
  position: fixed;
  bottom: 24px;
  left: 24px;
  z-index: 1000;
}

.MCS__undo-button {
  position: fixed;
  bottom: 24px;
  left: 72px;
  z-index: 1000;
}

.vgl-layout {
  --vgl-placeholder-bg: rgb(0, 182, 0);
}
</style>

<style lang="scss">
.vgl-item--placeholder {
  border-radius: 16px;
}
.vgl-item__resizer {
  &:before {
    border-color: var(--text-color);
    width: 12px;
    height: 12px;
  }
}
</style>
