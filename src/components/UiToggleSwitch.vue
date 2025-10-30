<script setup lang="ts">
defineProps<{
  modelValue: boolean,
  id?: string,
  ariaLabel?: string,
}>();
const emit = defineEmits(['update:modelValue']);
function onChange(e: Event) {
  emit('update:modelValue', (e.target as HTMLInputElement).checked);
}
</script>

<template>
  <div class="UiToggle" :class="{ '-toggled': !!modelValue }">
    <input
      :id="id"
      class="UiToggle__input"
      type="checkbox"
      :aria-label="ariaLabel"
      :checked="!!modelValue"
      @change="onChange"
    >
    <div class="UiToggle__interface">
      <div class="UiToggle__spacer"></div>
      <div class="UiToggle__circle"></div>
    </div>
  </div>
</template>
