<script setup lang="ts">
import { defineProps, defineEmits, computed } from 'vue';

const props = defineProps({
  icon: { type: Object, default: null },
  label: { type: String, default: '' },
  top: { type: Number, default: undefined },
  bottom: { type: Number, default: undefined },
  left: { type: Number, default: undefined },
  right: { type: Number, default: undefined },
  colorClass: { type: String, default: 'UiButton -plain -icon-only -icon-left -floating' },
  customClass: { type: String, default: '' }
});

const emit = defineEmits(['click']);

const styleObject = computed(() => ({
  position: 'fixed' as const,
  top: props.top !== undefined ? `${props.top}px` : undefined,
  bottom: props.bottom !== undefined ? `${props.bottom}px` : undefined,
  left: props.left !== undefined ? `${props.left}px` : undefined,
  right: props.right !== undefined ? `${props.right}px` : undefined,
  zIndex: 1000,
}));
</script>

<template>
  <button
    :class="[colorClass, customClass]"
    :style="styleObject"
    :aria-label="label"
    type="button"
    @click="$emit('click', $event)"
  >
    <div class="UiButton__icon">
      <slot name="icon">
        <component v-if="icon" :is="icon" />
      </slot>
    </div>
    <slot />
  </button>
</template>

<style scoped>
.UiButton__icon {
  width: 24px;
  height: 24px;
}
</style>
