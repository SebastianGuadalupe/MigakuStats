<script setup lang="ts">
import { defineProps, defineEmits } from 'vue';

interface ActionSheetItem {
  id: string;
  label: string;
  icon?: any;
  selected?: boolean;
}

withDefaults(defineProps<{
  actions: ActionSheetItem[];
  visible?: boolean;
  desktop?: boolean;
  bottomSheetProps?: any;
  popoverStyle?: Record<string, string>;
  disableIcons?: boolean;
}>(), {
  visible: true,
  desktop: true,
  bottomSheetProps: () => ({}),
  popoverStyle: () => ({})
});

const emit = defineEmits<{
  (e: 'select', payload: { action: ActionSheetItem, idx: number }): void;
}>();
</script>

<template>
  <div
    v-if="visible"
    class="UiPopover -visible"
    role="dialog"
    tabindex="-1"
    :style="popoverStyle"
  >
    <ul class="UiActionSheet" :class="{ '-desktop': desktop }" :bottom-sheet-props="bottomSheetProps">
      <li
        v-for="(action, idx) in actions"
        :key="idx"
        class="UiActionSheet__item"
        :style="{ borderBottomWidth: idx !== actions.length-1 ? '1px' : 0 }"
        :class="{ 'selected': action.selected }"
      >
        <button
          type="button"
          class="UiActionSheet__button UiActionSheet__action"
          :aria-label="`ID:UiActionSheet.item.${idx}`"
          @click="$emit('select', { action, idx })"
        >
          <div v-if="!disableIcons" class="UiIcon UiActionSheet__icon" style="width: 24px;">
            <slot name="icon" :icon="action.icon" :action="action">
              <component v-if="action.icon" :is="action.icon" class="UiIcon__svg" />
            </slot>
          </div>
          <div class="UiActionSheet__item__textContainer">
            <span class="UiTypo UiTypo__body -emphasis UiActionSheet__item__text">
              {{ action.label }}
            </span>
          </div>
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped lang="scss">
.selected {
  background-color: var(--grey-5);
}
</style>