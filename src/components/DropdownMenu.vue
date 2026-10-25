<script lang="ts" setup>
import { ref, computed, watch, onBeforeUnmount, defineProps, defineEmits, defineExpose, useId } from 'vue';

const props = defineProps({
  items: {
    type: Array as () => any[],
    required: true
  },
  modelValue: {
    type: [String, Number, Object],
    default: null
  },
  itemKey: {
    type: String,
    default: 'id'
  },
  itemLabel: {
    type: [String, Function] as any,
    default: 'name'
  },
  placeholder: {
    type: String,
    default: 'Select an option'
  },
  width: {
    type: Number,
    default: 250
  },
  componentHash: {
    type: String,
    default: undefined
  }
});

const emit = defineEmits(['update:modelValue']);
const isDropdownOpen = ref(false);
const componentHash = computed(() => props.componentHash || "");
const rootRef = ref<HTMLElement|null>(null);
const listId = useId();
const activeIndex = ref(0);
const opensUpward = ref(false);
const menuMaxHeight = ref(300);

function openDropdown() {
  rootRef.value?.focus({ preventScroll: true });
  const rect = rootRef.value?.getBoundingClientRect();
  if (rect) {
    const below = window.innerHeight - rect.bottom - 8;
    const above = rect.top - 8;
    opensUpward.value = below < Math.min(300, props.items.length * 40) && above > below;
    menuMaxHeight.value = Math.max(40, Math.min(300, opensUpward.value ? above : below));
  }
  activeIndex.value = Math.max(0, props.items.findIndex(item => getItemKey(item) === props.modelValue));
  isDropdownOpen.value = true;
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && !isDropdownOpen.value) return;
  if (event.key === 'Tab') { isDropdownOpen.value = false; return; }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' ', 'Escape'].includes(event.key)) return;
  event.preventDefault();
  event.stopPropagation();
  if (event.key === 'Escape') { isDropdownOpen.value = false; return; }
  if (!isDropdownOpen.value) { openDropdown(); return; }
  if (event.key === 'Enter' || event.key === ' ') {
    if (props.items[activeIndex.value]) selectItem(props.items[activeIndex.value]);
  } else {
    if (event.key === 'Home') activeIndex.value = 0;
    else if (event.key === 'End') activeIndex.value = props.items.length - 1;
    else activeIndex.value = Math.max(0, Math.min(props.items.length - 1, activeIndex.value + (event.key === 'ArrowDown' ? 1 : -1)));
    rootRef.value?.querySelectorAll('[role="option"]')[activeIndex.value]?.scrollIntoView({ block: 'nearest' });
  }
}

defineExpose({ rootRef, isDropdownOpen });

const selectedItemLabel = computed(() => {
  const selectedItem = props.items.find(item => getItemKey(item) === props.modelValue);
  return selectedItem ? getItemLabel(selectedItem) : props.placeholder;
});

function toggleDropdown(event: MouseEvent) {
  event.stopPropagation();
  if (isDropdownOpen.value) isDropdownOpen.value = false;
  else openDropdown();
}

function selectItem(item: any, event?: MouseEvent) {
  event?.stopPropagation();
  const itemKeyVal = getItemKey(item);
  if (props.modelValue !== itemKeyVal) {
    emit('update:modelValue', itemKeyVal);
  }
  isDropdownOpen.value = false;
}

function getItemKey(item: any) {
  return item[props.itemKey];
}

function getItemLabel(item: any) {
  if (typeof props.itemLabel === 'function') {
    return props.itemLabel(item);
  }
  return item[props.itemLabel];
}

let cleanupClick: (() => void) | null = null;

watch(isDropdownOpen, (open) => {
  if (open) {
    const handler = (event: Event) => {
      if (!rootRef.value) return;
      if (rootRef.value.contains(event.target as Node)) return;
      isDropdownOpen.value = false;
    };
    // Capture sees interactions even inside the settings form's stopPropagation.
    document.addEventListener('pointerdown', handler, true);
    document.addEventListener('focusin', handler, true);
    cleanupClick = () => {
      document.removeEventListener('pointerdown', handler, true);
      document.removeEventListener('focusin', handler, true);
    };
  } else {
    if (cleanupClick) {
      cleanupClick();
      cleanupClick = null;
    }
  }
});

onBeforeUnmount(() => {
  if (cleanupClick) cleanupClick();
});
</script>

<template>
  <div
    ref="rootRef"
    :[componentHash]="true"
    tabindex="0"
    class="multiselect multiselect--right"
    :class="{ '-has-value': modelValue !== null, 'multiselect--active': isDropdownOpen }"
    role="combobox"
    aria-haspopup="listbox"
    :aria-expanded="isDropdownOpen"
    :aria-controls="listId"
    :aria-activedescendant="isDropdownOpen ? `${listId}-${activeIndex}` : undefined"
    @keydown="onKeydown"
    :style="{ width: width + 'px', zIndex: isDropdownOpen ? 10001 : undefined }"
    @click="toggleDropdown"
  >
    <div class="UiIcon multiselect__caret" style="width: 24px;">
      <div class="UiIcon__inner">
        <div class="UiSvg UiIcon__svg" name="ChevronDownSmall" gradient="false" spin="false">
          <div class="UiSvg__inner">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" role="img">
              <path fill="currentColor" fill-rule="evenodd" d="M7.116 10.116a1.25 1.25 0 0 1 1.768 0L12 13.232l3.116-3.116a1.25 1.25 0 0 1 1.768 1.768l-4 4a1.25 1.25 0 0 1-1.768 0l-4-4a1.25 1.25 0 0 1 0-1.768" clip-rule="evenodd"></path>
            </svg>
          </div>
        </div>
      </div>
    </div>
    <div class="multiselect__tags">
      <slot name="trigger" :selectedLabel="selectedItemLabel">
        <span class="multiselect__single">
          <span class="UiTypo UiTypo__caption -no-wrap multiselect__single__text">{{ selectedItemLabel }}</span>
        </span>
      </slot>
    </div>
    <div
      class="multiselect__content-wrapper"
      tabindex="-1"
      :style="{ display: isDropdownOpen ? 'block' : 'none', maxHeight: menuMaxHeight + 'px', top: opensUpward ? 'auto' : '100%', bottom: opensUpward ? '100%' : 'auto' }"
    >
      <ul :id="listId" class="multiselect__content" role="listbox" style="z-index: 1000;">
        <li class="multiselect__element" role="option" v-for="(item, index) in items" :key="getItemKey(item)" :id="`${listId}-${index}`" :aria-selected="getItemKey(item) === modelValue">
          <span
            class="multiselect__option"
            :class="{ 'multiselect__option--highlight': index === activeIndex, 'multiselect__option--selected': getItemKey(item) === modelValue }"
            @click="selectItem(item, $event)"
          >
            <slot name="item" :item="item" :isSelected="getItemKey(item) === modelValue">
              <div class="multiselect__optionWrapper" :style="{ width: width - 40 + 'px' }">
                <span
                  class="UiTypo UiTypo__caption"
                  :class="{ '-emphasis': getItemKey(item) === modelValue }"
                  style="overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
                >
                  {{ getItemLabel(item) }}
                </span>
                <div class="UiIcon multiselect__checkIcon" style="width: 24px;">
                  <div v-if="getItemKey(item) === modelValue" class="UiIcon__inner">
                    <div class="UiSvg UiIcon__svg" name="Check" gradient="true" spin="false">
                      <div class="UiSvg__inner UiIcon__gradient" :style="'clip-path: url(#checkmark-dd-' + getItemKey(item) + ');'">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" role="img">
                          <defs>
                            <clipPath :id="'checkmark-dd-' + getItemKey(item)" data-dont-prefix-id="" transform="scale(1)">
                              <path fill="currentColor" fill-rule="evenodd" d="M19.83 7.066a1.25 1.25 0 0 1 .104 1.764l-8 9a1.25 1.25 0 0 1-1.818.054l-5-5a1.25 1.25 0 0 1 1.768-1.768l4.063 4.063 7.119-8.01a1.25 1.25 0 0 1 1.765-.103" clip-rule="evenodd">
                              </path>
                            </clipPath>
                          </defs>
                        </svg>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </slot>
          </span>
        </li>
      </ul>
    </div>
  </div>
</template>
