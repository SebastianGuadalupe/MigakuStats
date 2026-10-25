import { createApp } from 'vue';
import { createPinia, disposePinia } from 'pinia';
import App from './App.vue';
import { SELECTORS, ROUTES, ATTRIBUTES } from './utils/constants';
import { logger } from './utils/logger';
import { useAppStore } from './stores/app';
import { clearDatabaseCache } from './utils/database';
import './integration.css';
import { findStatisticsPage, parkNativeNode } from './utils/pageIntegration';
import { useCardsStore } from './stores/cards';
import { getStudyDate, getChartDayNumber, getNextStudyRollover } from './utils/studyDay';

let mounted: { app: ReturnType<typeof createApp>; pinia: ReturnType<typeof createPinia>;
  container: HTMLElement; layout: HTMLElement; slots: ReturnType<typeof parkNativeNode>[];
  cleanupStyles: () => void;
  studyDay: number; originalWidth: string } | null = null;

function unmountApp() {
  if (!mounted) return;
  const state = mounted;
  mounted = null;
  state.app.unmount();
  disposePinia(state.pinia);
  state.cleanupStyles();
  for (const slot of state.slots) slot.restore();
  state.container.remove();
  state.layout.style.maxWidth = state.originalWidth;
  clearDatabaseCache();
}

function reconcile() {
  const onStats = window.location.pathname.replace(/\/$/, '') === ROUTES.STATS_ROUTE;
  if (mounted && (!onStats || !mounted.container.isConnected || mounted.studyDay !== getChartDayNumber(getStudyDate()))) unmountApp();
  if (!onStats || mounted) return;
  const host = findStatisticsPage();
  if (!host || document.getElementById(SELECTORS.VUE_CONTAINER_ID)) return;
  const { layout, activity, hero } = host;
  const pinia = createPinia();
  const app = createApp(App).use(pinia);
  const store = useAppStore(pinia);
  store.loadFromStorage();
  store.setLanguage(document.querySelector(SELECTORS.MIGAKU_MAIN)?.getAttribute(ATTRIBUTES.LANG_SELECTED) ?? null);
  store.setTheme(document.documentElement.getAttribute(ATTRIBUTES.THEME));
  store.setComponentHash('data-mcs');
  const cards = useCardsStore(pinia);
  cards.setStreakHeroAvailable(!!hero);
  const slots = [parkNativeNode(activity, 'original-stats-card-container')];
  if (hero) slots.push(parkNativeNode(hero, 'original-streak-hero-container'));
  const container = document.createElement('div');
  container.id = SELECTORS.VUE_CONTAINER_ID;
  container.dataset.mcsPage = host.version;
  layout.append(container);
  // Match the native activity card at this viewport, including theme changes.
  const syncStyles = () => {
    if (host.version !== 'modern') return;
    const style = getComputedStyle(activity);
    container.style.setProperty('--mcs-card-radius', style.borderRadius);
    container.style.setProperty('--mcs-card-padding', style.padding);
    container.style.setProperty('--mcs-card-shadow', style.boxShadow);
  };
  syncStyles();
  window.addEventListener('resize', syncStyles);
  const styleObserver = new MutationObserver(syncStyles);
  styleObserver.observe(document.documentElement, { attributes: true, attributeFilter: [ATTRIBUTES.THEME] });
  const title = host.page.querySelector<HTMLElement>('.AppHeaderV2__title');
  const originalTitle = title?.textContent ?? '';
  const updateTitle = () => {
    if (title && title.textContent !== 'Stats') title.textContent = 'Stats';
  };
  const titleObserver = new MutationObserver(updateTitle);
  if (title) {
    updateTitle();
    titleObserver.observe(title, { childList: true, characterData: true, subtree: true });
  }
  const cleanupStyles = () => {
    window.removeEventListener('resize', syncStyles);
    styleObserver.disconnect();
    titleObserver.disconnect();
    if (title) title.textContent = originalTitle;
  };
  mounted = { app, pinia, container, layout, slots, cleanupStyles, studyDay: getChartDayNumber(getStudyDate()), originalWidth: layout.style.maxWidth };
  layout.style.maxWidth = '1080px';
  try { app.mount(container); }
  catch (error) { logger.error('Could not mount custom statistics', error); unmountApp(); }
}

let queued = false;
function scheduleReconcile() {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => { queued = false; reconcile(); });
}
for (const method of ['pushState', 'replaceState'] as const) {
  const original = history[method];
  history[method] = function (...args: Parameters<History['pushState']>) {
    original.apply(this, args);
    scheduleReconcile();
  };
}
window.addEventListener('popstate', scheduleReconcile);
window.addEventListener('hashchange', scheduleReconcile);
// Retry when the route finishes rendering, or its root is replaced.
new MutationObserver(scheduleReconcile).observe(document.body, { childList: true, subtree: true });
scheduleReconcile();

// Refresh date-dependent queries even if this tab stays open overnight.
function scheduleStudyRollover() {
  window.setTimeout(() => {
    scheduleReconcile();
    scheduleStudyRollover();
  }, Math.max(1, getNextStudyRollover().getTime() - Date.now()));
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) scheduleReconcile();
});
scheduleStudyRollover();
