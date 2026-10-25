import { beforeEach, expect, test, mock } from 'bun:test';
import { Window } from 'happy-dom';
import { createPinia, setActivePinia } from 'pinia';
const window = new Window();
Object.assign(globalThis, { localStorage: window.localStorage, document: window.document, MutationObserver: window.MutationObserver });
const pending: ((value: any)=>void)[] = [];
mock.module('../src/utils/database', () => ({
  fetchWordStats: () => new Promise(resolve => pending.push(resolve)),
  reloadDatabase: async () => null,
}));
const { useCardsStore } = await import('../src/stores/cards');
const { useWordStatsStore } = await import('../src/stores/wordStats');
const { waitForElement } = await import('../src/utils/observers');
beforeEach(() => {localStorage.clear(); setActivePinia(createPinia()); pending.length = 0; document.body.innerHTML = '';});
test('hiding a card persists across stores and does not mutate defaults', () => {
  let cards = useCardsStore();
  cards.hideCard('WordCount');
  setActivePinia(createPinia());
  expect(useCardsStore().cards.find(c=>c.id==='WordCount')?.visible).toBe(false);
  localStorage.clear();setActivePinia(createPinia());
  expect(useCardsStore().cards.find(c=>c.id==='WordCount')?.visible).toBe(true);
});
test('custom card discovery preserves a saved hidden state', () => {
  const cards=useCardsStore();cards.ensureCard('custom');cards.hideCard('custom');cards.ensureCard('custom');
  expect(cards.cards.find(c=>c.id==='custom')?.visible).toBe(false);
});
test('corrupt saved layout entries do not crash the grid', () => {
  localStorage.setItem('migaku-cards', JSON.stringify([null,{id:'WordCount',item:{w:-1,h:1,x:0,y:0}},{id:'Broken'}]));
  const cards=useCardsStore();
  expect(cards.cards.length).toBe(9);
  expect(cards.layout.every(item=>item.w>0 && Number.isFinite(item.x))).toBe(true);
});
test('slow old requests cannot overwrite a newer deck or clear its loading flag', async () => {
  const store=useWordStatsStore();
  const old=store.fetchWordStatsIfNeeded('ja','1');
  const recent=store.fetchWordStatsIfNeeded('ja','2');
  pending[0]({known_count:1});await old;
  expect(store.isLoading).toBe(true);
  pending[1]({known_count:2});await recent;
  expect(store.wordStats?.known_count).toBe(2);
  expect(store.isLoading).toBe(false);
});
test('a failed request clears stale results and displays an error', async () => {
  const store=useWordStatsStore();store.setWordStats({known_count:9});
  const request=store.fetchWordStatsIfNeeded('ja','2');pending[0](null);await request;
  expect(store.wordStats).toBeNull();expect(store.error).not.toBe('');
});
test('element waits handle delayed insertion and timeout', async () => {
  const found=waitForElement('.late',100);
  const element=document.createElement('div');element.className='late';document.body.append(element);
  expect(await found).toBe(element);
  expect(await waitForElement('.absent',5)).toBeNull();
});
test('newer data remains visible when an older request finishes last', async () => {
  const store=useWordStatsStore();
  const old=store.fetchWordStatsIfNeeded('ja','1');
  const recent=store.fetchWordStatsIfNeeded('ja','2');
  pending[1]({known_count:2});await recent;
  pending[0]({known_count:1});await old;
  expect(store.wordStats?.known_count).toBe(2);
});
test('custom dimensions reject NaN and negative sizes', () => {
  const cards=useCardsStore();cards.ensureCard('custom',{minW:NaN,minH:-1,defaultW:99,defaultH:NaN});
  const item=cards.cards.find(c=>c.id==='custom')!.item;
  expect(item.w).toBe(12);expect(item.h).toBe(5);expect(item.minW).toBe(4);
});
test('a language change resets an incompatible saved deck and normalizes theme', async () => {
  const {useAppStore}=await import('../src/stores/app');
  const app=useAppStore();app.setLanguage('ja');app.setSelectedDeckId('1');app.setLanguage('es');
  expect(app.selectedDeckId).toBe('all');
  app.setTheme('invalid');expect(app.theme).toBe('dark');
  app.setSelectedDeckId('deleted');app.setAvailableDecks([{id:'all',name:'All decks',lang:'all'}]);
  expect(app.selectedDeckId).toBe('all');
});
test('legacy and early-access page adapters choose their own native nodes', async () => {
  const {findStatisticsPage}=await import('../src/utils/pageIntegration');
  document.body.innerHTML='<main class="MIGAKU-SRS"><div><header></header><div class="Statistic"><div class="UiPageLayout__wrapper"><div class="UiPageLayout"><h2 class="Statistic__title">Yearly reviews</h2><div class="UiCard Statistic__card"><div class="Statistic__heatmap"></div></div></div></div></div></div></main>';
  const legacy=findStatisticsPage();
  expect(legacy?.version).toBe('legacy');expect(legacy?.activity.classList.contains('Statistic__card')).toBe(true);expect(legacy?.hero).toBeNull();
  document.body.innerHTML='<div class="StatisticV2"><header></header><div class="UiPageLayout"><div class="StatisticV2__hero">Streak</div><div class="StatisticV2__activityCard">Activity</div></div></div>';
  const modern=findStatisticsPage();
  expect(modern?.version).toBe('modern');expect(modern?.hero?.textContent).toBe('Streak');
});
test('native slots restore both page versions without replacing their DOM nodes', async () => {
  const {findStatisticsPage,parkNativeNode}=await import('../src/utils/pageIntegration');
  for (const version of ['Statistic','StatisticV2']) {
    const cardClass=version==='Statistic'?'Statistic__card':'StatisticV2__activityCard';
    document.body.innerHTML=`<div class="${version}"><div class="UiPageLayout"><div class="${cardClass}"><button>Native button</button></div><footer>After</footer></div></div>`;
    const host=findStatisticsPage()!;const original=host.layout.innerHTML;const button=host.activity.querySelector('button')!;
    let clicks=0;button.addEventListener('click',()=>clicks++);
    const slot=parkNativeNode(host.activity,'test-slot');document.body.append(slot.container);button.click();slot.restore();
    expect(host.layout.innerHTML).toBe(original);expect(host.activity.querySelector('button')).toBe(button);expect(clicks).toBe(1);
  }
});
test('hero migration is only applied once and is unavailable on legacy pages', () => {
  let cards=useCardsStore();const oldY=cards.cards.find(c=>c.id==='WordCount')!.item.y;
  cards.setStreakHeroAvailable(true);
  expect(cards.layout.find(c=>c.i==='StreakHero')?.y).toBe(0);
  expect(cards.cards.find(c=>c.id==='WordCount')!.item.y).toBe(oldY+5);
  cards.hideCard('StreakHero');setActivePinia(createPinia());cards=useCardsStore();cards.setStreakHeroAvailable(true);
  expect(cards.cards.find(c=>c.id==='StreakHero')?.visible).toBe(false);
  expect(cards.cards.find(c=>c.id==='WordCount')!.item.y).toBe(oldY+5);
  cards.setStreakHeroAvailable(false);
  expect(cards.availableCards.some(c=>c.id==='StreakHero')).toBe(false);
  expect(cards.layout.some(c=>c.i==='StreakHero')).toBe(false);
});
