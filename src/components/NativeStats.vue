<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from "vue";
import { waitForElement } from "../utils/observers";
import { SELECTORS } from "../utils/constants";
import { watch } from "vue";
import { useAppStore } from "../stores/app";

const appStore = useAppStore();

const domSlotRef = ref<HTMLElement | null>(null);
let nativeNode: HTMLElement | null = null;
let originalParent: Node | null = null;
let originalNext: Node | null = null;

function addDayLabels(heatmapContainer: HTMLElement) {
  // Find all heatmap day squares
  const daySquares = heatmapContainer.querySelectorAll('.Statistic__heatmap__day');
  if (!daySquares || daySquares.length === 0) return;

  // Days of the week (starting with Monday)
  const days = ['M', 'T', 'W', 'TH', 'F', 'S', 'SU'];
  
  // Get the component hash for styling
  const componentHash = appStore.componentHash || nativeNode?.querySelector('.UiTypo')?.attributes[0].nodeName;
  
  daySquares.forEach((square, index) => {
    // Skip if label already exists
    if (square.querySelector('.MCS__day-label')) return;
    
    const dayOfWeek = index % 7;
    const dayLabel = days[dayOfWeek];
    
    // Create label element
    const labelElement = document.createElement('div');
    labelElement.className = 'MCS__day-label';
    if (componentHash) labelElement.setAttribute(componentHash, '');
    labelElement.textContent = dayLabel;
    
    // Make the square position relative if it isn't
    if (square instanceof HTMLElement) {
      square.style.position = 'relative';
      square.appendChild(labelElement);
    }
  });
}

async function moveNativeNode() {
  nativeNode = document.getElementById('original-stats-card-container');
  if (nativeNode && domSlotRef.value) {
    if (!originalParent) {
      originalParent = nativeNode.parentNode;
      originalNext = nativeNode.nextSibling;
    }
    domSlotRef.value.appendChild(nativeNode);
    nativeNode.style.display = '';
    const h2Title = nativeNode.querySelector('h2');
    if (h2Title) {
      h2Title.remove();
    }
  }

  const heatmapCard = await waitForElement(SELECTORS.HEATMAP);
  if (heatmapCard && (heatmapCard instanceof HTMLElement)) {
    heatmapCard.style.height = "calc(100% - 256px)";
    heatmapCard.style.overflowY = "scroll";
    heatmapCard.scrollTop = heatmapCard.scrollHeight;
    
    // Add day-of-week labels to each square
    addDayLabels(heatmapCard);
  }

  const averageReviewsPerDayValue = nativeNode?.querySelector('#average-reviews-per-day-value')?.textContent || nativeNode?.querySelector('.UiTypo.UiTypo__heading3.-heading')?.textContent;
  const componentHash = nativeNode?.querySelector('.UiTypo.UiTypo__heading3.-heading')?.attributes[0].nodeName;
  const footer = nativeNode?.querySelector('.Statistic__card__footer');
  if (averageReviewsPerDayValue && footer && componentHash) {
    nativeNode?.querySelector('#average-reviews-per-day')?.remove();
    nativeNode?.querySelector('.Statistic__card__header')?.remove();
    nativeNode?.querySelector('#review-heatmap-header')?.remove();

    const newFooterElement = document.createElement('div');
    newFooterElement.id = 'average-reviews-per-day';
    newFooterElement.setAttribute(componentHash, '');

    const firstSpan = document.createElement('span');
    firstSpan.textContent = 'Average reviews per day: ';
    firstSpan.setAttribute(componentHash, '');
    firstSpan.classList.add('UiTypo', 'UiTypo__caption', '-inline');
    newFooterElement.appendChild(firstSpan);

    const secondSpan = document.createElement('span');
    secondSpan.id = 'average-reviews-per-day-value';
    secondSpan.textContent = averageReviewsPerDayValue || '';
    secondSpan.setAttribute(componentHash, '');
    secondSpan.classList.add('UiTypo', 'UiTypo__heading4', '-heading', '-inline');
    newFooterElement.appendChild(secondSpan);

    footer.insertBefore(newFooterElement, footer.firstChild);

    const newHeaderElement = document.createElement('h3');
    newHeaderElement.textContent = 'Review Heatmap';
    newHeaderElement.setAttribute(componentHash, '');
    newHeaderElement.classList.add('UiTypo', 'UiTypo__heading3', '-heading', 'Statistic__title');
    newHeaderElement.id = 'review-heatmap-header';
    const card = nativeNode?.querySelector('.UiCard.-lesson.Statistic__card');
    card?.insertBefore(newHeaderElement, card?.firstChild);
  }
}

function restoreNativeNode() {
  if (nativeNode && originalParent) {
    if (originalNext) {
      originalParent.insertBefore(nativeNode, originalNext);
    } else {
      originalParent.appendChild(nativeNode);
    }
  }
}

onMounted(async () => {
  await moveNativeNode();
});

onBeforeUnmount(() => {
  restoreNativeNode();
});

watch(() => appStore.language, async() => {
  await moveNativeNode();
}, { deep: true });

</script>
<template>
  <div class="NativeStatsCard" ref="domSlotRef">
  </div>
</template>

<style scoped>
.NativeStatsCard {
  background: transparent;
  border: none;
  box-shadow: none;
  padding: 0;
  height: 100%;
}
</style>

<style>
.MCS__day-label {
  position: absolute;
  top: 2px;
  left: 50%;
  transform: translateX(-50%);
  font-size: 10px;
  font-weight: 700;
  color: rgba(255, 255, 255, 0.9);
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.3);
  pointer-events: none;
  user-select: none;
  z-index: 10;
  line-height: 1;
}
</style>
