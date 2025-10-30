<script lang="ts" setup>
import { ref, computed, watch, onBeforeUnmount, defineProps, defineEmits, defineExpose } from 'vue';

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

defineExpose({ rootRef, isDropdownOpen });

const selectedItemLabel = computed(() => {
  const selectedItem = props.items.find(item => getItemKey(item) === props.modelValue);
  return selectedItem ? getItemLabel(selectedItem) : props.placeholder;
});

function toggleDropdown(event: MouseEvent) {
  event.stopPropagation();
  isDropdownOpen.value = !isDropdownOpen.value;
}

function selectItem(item: any, event: MouseEvent) {
  event.stopPropagation();
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
    const handler = (event: MouseEvent) => {
      if (!rootRef.value) return;
      if (rootRef.value.contains(event.target as Node)) return;
      isDropdownOpen.value = false;
    };
    document.addEventListener('mousedown', handler);
    cleanupClick = () => document.removeEventListener('mousedown', handler);
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
    :style="{ width: width + 'px' }"
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
      style="max-height: 300px;"
      :style="{ display: isDropdownOpen ? 'block' : 'none' }"
    >
      <ul class="multiselect__content" role="listbox" style="z-index: 1000;">
        <li class="multiselect__element" role="option" v-for="item in items" :key="getItemKey(item)">
          <span
            class="multiselect__option"
            :class="{ 'multiselect__option--highlight multiselect__option--selected': getItemKey(item) === modelValue }"
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
