<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from "vue";

const domSlotRef = ref<HTMLElement | null>(null);
let targetNode: HTMLElement | null = null;
let originalParent: Node | null = null;
let originalNext: Node | null = null;

function getCardIdFromContainer(el: HTMLElement | null): string | null {
  let node: HTMLElement | null = el;
  while (node) {
    if (node.classList && node.classList.contains("MCS__stats-card")) {
      const id = node.getAttribute("data-card-id");
      return id || null;
    }
    node = node.parentElement;
  }
  return null;
}

function moveCustomNode() {
  const hostId = getCardIdFromContainer(domSlotRef.value);
  if (!hostId) {
    return;
  }
  const found = document.querySelector(`[custom-stat="${CSS.escape(hostId)}"]`);
  if (found && found instanceof HTMLElement && domSlotRef.value) {
    targetNode = found;
    targetNode.style.height = "100%";
    if (!originalParent) {
      originalParent = targetNode.parentNode;
      originalNext = targetNode.nextSibling;
    }
    domSlotRef.value.appendChild(targetNode);
    targetNode.style.display = "";

    const foundTitle = found.querySelector(
      ".UiTypo.UiTypo__heading2.-heading.Statistic__title"
    );
    if (foundTitle && foundTitle instanceof HTMLElement) {
      foundTitle.remove();
    }

    const foundCard = found.querySelector(".UiCard.-lesson.Statistic__card");
    if (foundCard && foundCard instanceof HTMLElement) {
      let parent = foundCard.parentElement;
      while (parent && parent instanceof HTMLElement) {
        if (parent.getAttribute("custom-stat")) {
          break;
        }
        console.log(parent);
        parent.style.margin = "0";
        parent.style.height = "100%";
        parent = parent.parentElement;
      }
      foundCard.style.margin = "0";
    }
  }
}

function restoreNode() {
  if (targetNode && originalParent) {
    if (originalNext) {
      originalParent.insertBefore(targetNode, originalNext);
    } else {
      originalParent.appendChild(targetNode);
    }
  }
}

onMounted(() => {
  moveCustomNode();
});

onBeforeUnmount(() => {
  restoreNode();
});
</script>

<template>
  <div class="CustomStatCard" ref="domSlotRef"></div>
</template>

<style scoped>
.CustomStatCard {
  background: transparent;
  border: none;
  box-shadow: none;
  padding: 0;
  height: 100%;
}
</style>
