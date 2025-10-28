import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { waitForElement } from './utils/observers';
import { SELECTORS } from './utils/constants';
import { logger } from './utils/logger';
import { useAppStore } from './stores/app';

const VUE_CONTAINER_ID = SELECTORS.VUE_CONTAINER_ID;
const STATS_ROUTE = '/statistic';

let vueAppInstance: ReturnType<typeof createApp> | null = null;
let vueContainer: HTMLElement | null = null;
let isMounting = false;

async function mountApp() {
  if (isMounting || vueAppInstance || (vueContainer && document.getElementById(VUE_CONTAINER_ID))) {
    logger.debug('Vue app already mounting or mounted.');
    return;
  }
  isMounting = true;
  try {
    logger.debug('Waiting for main Migaku element...');
    const mainElement = await waitForElement(SELECTORS.MIGAKU_MAIN);
    if (!mainElement) {
      logger.error('Main Migaku element not found. App will not mount.');
      return;
    }
    logger.debug('Main element found. Creating Vue app.');
    const app = createApp(App);
    const pinia = createPinia();
    app.use(pinia);
    const appStore = useAppStore();
    appStore.loadFromStorage();
    const statisticsDiv = await waitForElement(SELECTORS.STATISTICS_ELEMENT);
    if (!statisticsDiv) {
      logger.error("Statistics element not found, cannot display stats.");
      return;
    }
    const componentHash = statisticsDiv.attributes[0].nodeName;
    appStore.setComponentHash(componentHash);
    logger.debug(`Component hash set to: ${componentHash}`);
    const statsContainer = await waitForElement(SELECTORS.TARGET_ELEMENT);
    if (!statsContainer || !(statsContainer instanceof HTMLElement)) {
      logger.error("Target container not found, cannot display stats.");
      return;
    }
    const children = statsContainer.children;
    const newDiv = document.createElement("div");
    newDiv.classList.add("MCS__stats-container");
    Array.from(children).forEach(child => {
      newDiv.appendChild(child);
    });
    statsContainer.appendChild(newDiv);
    statsContainer.style.display = "grid";
    statsContainer.style.gridTemplateColumns = "repeat(auto-fit, minmax(250px, 1fr))";
    statsContainer.style.gap = "20px";
    statsContainer.style.width = "fit-content";
    statsContainer.style.maxWidth = "calc(100% - 32px)";
    statsContainer.parentElement!.style.maxWidth = "100vw";
    logger.debug("Target element confirmed for display");
    logger.debug("Mounting Vue app to container");
    vueContainer = document.createElement('div');
    vueContainer.id = VUE_CONTAINER_ID;
    statsContainer.appendChild(vueContainer);
    vueAppInstance = app;
    vueAppInstance.mount(vueContainer);
  } finally {
    isMounting = false;
  }
}

function unmountApp() {
  if (vueAppInstance && vueContainer) {
    logger.debug('Unmounting Vue app.');
    vueAppInstance.unmount();
    if (vueContainer.parentNode) {
      vueContainer.parentNode.removeChild(vueContainer);
    }
    vueAppInstance = null;
    vueContainer = null;
  }
  isMounting = false;
}

function handleRouteChange() {
  if (window.location.pathname === STATS_ROUTE) {
    mountApp();
  } else {
    unmountApp();
  }
}

function monkeyPatchHistoryMethods() {
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  history.pushState = function (...args) {
    const ret = originalPushState.apply(this, args);
    window.dispatchEvent(new Event('locationchange'));
    return ret;
  };
  history.replaceState = function (...args) {
    const ret = originalReplaceState.apply(this, args);
    window.dispatchEvent(new Event('locationchange'));
    return ret;
  };
}

function setupRouteListener() {
  monkeyPatchHistoryMethods();
  window.addEventListener('popstate', handleRouteChange);
  window.addEventListener('locationchange', handleRouteChange);
  window.addEventListener('hashchange', handleRouteChange);
}

setupRouteListener();
handleRouteChange();
