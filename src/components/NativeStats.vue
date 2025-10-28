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
    heatmapCard.style.height = "calc(100% - 250px)";
    heatmapCard.style.overflowY = "scroll";
    heatmapCard.scrollTop = heatmapCard.scrollHeight;
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
