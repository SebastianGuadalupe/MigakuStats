<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from "vue";

const domSlotRef = ref<HTMLElement | null>(null);
let nativeNode: HTMLElement | null = null;
let originalParent: Node | null = null;
let originalNext: Node | null = null;

function moveNativeNode() {
  nativeNode = document.getElementById('original-stats-card-container');
  if (nativeNode && domSlotRef.value) {
    if (!originalParent) {
      originalParent = nativeNode.parentNode;
      originalNext = nativeNode.nextSibling;
    }
    domSlotRef.value.appendChild(nativeNode);
    nativeNode.style.display = '';
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

onMounted(() => {
  moveNativeNode();
});

onBeforeUnmount(() => {
  restoreNativeNode();
});
</script>
<template>
  <div class="NativeStatsCard" ref="domSlotRef" style="min-width:250px;min-height:100px;">
  </div>
</template>

<style scoped>
.NativeStatsCard {
  background: transparent;
  border: none;
  box-shadow: none;
  padding: 0;
}
</style>
