export type StatisticsPage = {
  version: 'legacy' | 'modern';
  page: HTMLElement;
  layout: HTMLElement;
  activity: HTMLElement;
  hero: HTMLElement | null;
};

export function findStatisticsPage(root: ParentNode = document): StatisticsPage | null {
  for (const version of ['modern', 'legacy'] as const) {
    const page = root.querySelector<HTMLElement>(version === 'modern' ? '.StatisticV2' : '.Statistic');
    if (!page) continue;
    const layout = page.matches('.UiPageLayout') ? page : page.querySelector<HTMLElement>('.UiPageLayout');
    const activity = layout?.querySelector<HTMLElement>(version === 'modern' ? '.StatisticV2__activityCard' : '.Statistic__card');
    if (layout && activity) return { version, page, layout, activity,
      hero: version === 'modern' ? layout.querySelector<HTMLElement>('.StatisticV2__hero') : null };
  }
  return null;
}

export function parkNativeNode(node: HTMLElement, id: string) {
  const marker = document.createComment(`Migaku Custom Stats: ${id}`);
  node.before(marker);
  const container = document.createElement('div');
  container.id = id;
  marker.after(container);
  container.append(node);
  return { container, restore() {
    if (marker.parentNode) marker.before(node);
    container.remove();
    marker.remove();
  } };
}
