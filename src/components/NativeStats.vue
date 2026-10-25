<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue';
const props = withDefaults(defineProps<{ containerId?: string; hero?: boolean }>(), { containerId: 'original-stats-card-container', hero: false });
const domSlotRef = ref<HTMLElement | null>(null);
let nativeNode: HTMLElement | null = null;
let placeholder: Comment | null = null;
onMounted(() => {
  nativeNode = document.getElementById(props.containerId);
  if (!nativeNode || !domSlotRef.value) return;
  placeholder = document.createComment('native statistics slot');
  nativeNode.before(placeholder);
  domSlotRef.value.append(nativeNode);
  nativeNode.style.display = '';
});
onBeforeUnmount(() => {
  if (nativeNode && placeholder?.parentNode) placeholder.replaceWith(nativeNode);
});
</script>
<template><div class="NativeStatsCard" :class="{ 'NativeStatsCard--hero': hero }" ref="domSlotRef"></div></template>
<style scoped>
.NativeStatsCard { height: 100%; overflow: auto; border-radius: 16px; }
.NativeStatsCard :deep(.StatisticV2__activityCard),
.NativeStatsCard :deep(.Statistic__card) { width: 100%; max-width: none; margin: 0; }
.NativeStatsCard--hero { background: transparent; border: none; box-shadow: none; border-radius: 0; }
.NativeStatsCard--hero :deep(.StatisticV2__hero) { min-height: 100%; box-sizing: border-box; justify-content: center; }
</style>
