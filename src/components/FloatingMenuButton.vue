<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import FloatingButton from './FloatingButton.vue';
import DropdownMenu from './DropdownMenu.vue';

const props = defineProps<{
  buttonPos?: {top?: number, bottom?: number, left?: number, right?: number},
  settings: Array<{
    key: string;
    label: string;
    type: 'dropdown' | 'radio' | 'switch';
    options?: string[];
    value: any;
  }>,
  modelValue: Record<string, any>,
}>();

const emit = defineEmits(['update:modelValue']);
const isOpen = ref(false);
const btnRef = ref<HTMLElement|null>(null);
const wrapperRef = ref<HTMLElement|null>(null);
const popoverRef = ref<HTMLElement|null>(null);
const popoverPos = ref<{ top: number; right: number }>({ top: 0, right: 0 });

function useClickOutside(targetRef: any, handler: (e: MouseEvent) => void, extraRefs: any[] = []) {
  function listener(event: MouseEvent) {
    const el = targetRef.value;
    const isInTarget = el && el.contains(event.target as Node);
    const isInExtras = extraRefs.some(r => r?.value && r.value.contains(event.target as Node));
    if (!el || isInTarget || isInExtras) return;
    handler(event);
  }
  onMounted(() => document.addEventListener('mousedown', listener));
  onBeforeUnmount(() => document.removeEventListener('mousedown', listener));
}

useClickOutside(wrapperRef, () => isOpen.value = false, [popoverRef]);

function computePopoverPosition() {
  const btn = (btnRef.value as any);
  const btnEl: HTMLElement | null = btn?.$el ? btn.$el as HTMLElement : (btn as HTMLElement);
  if (!btnEl) return;
  const rect = btnEl.getBoundingClientRect();
  const gap = 12;
  popoverPos.value = {
    top: Math.round(rect.top + rect.height + gap),
    right: Math.round(window.innerWidth - rect.right + (props.buttonPos?.right ?? 24))
  };
}

function openMenu() {
  isOpen.value = !isOpen.value;
  if (isOpen.value) {
    computePopoverPosition();
  }
}

onMounted(() => {
  const handler = () => { if (isOpen.value) computePopoverPosition(); };
  window.addEventListener('resize', handler);
  window.addEventListener('scroll', handler, true);
  onBeforeUnmount(() => {
    window.removeEventListener('resize', handler);
    window.removeEventListener('scroll', handler, true);
  });
});

function updateSetting(key: string, value: any) {
  emit('update:modelValue', { ...props.modelValue, [key]: value });
}
</script>

<template>
  <div ref="wrapperRef" style="position: absolute; top: 0; right: 0;">
    <FloatingButton
      ref="btnRef"
      :bottom="props.buttonPos?.bottom"
      :top="props.buttonPos?.top"
      :left="props.buttonPos?.left"
      :right="props.buttonPos?.right"
      :label="'Open settings menu'"
      :customClass="'MCS__menu-fab'"
      @click="openMenu"
      style="z-index: 1201;"
    >
      <template #icon>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="12" cy="5" r="1.8" fill="currentColor"/>
          <circle cx="12" cy="12" r="1.8" fill="currentColor"/>
          <circle cx="12" cy="19" r="1.8" fill="currentColor"/>
        </svg>
      </template>
    </FloatingButton>
    <teleport to="body">
      <div
        v-if="isOpen"
        class="MCS__menu-popover UiActionSheet -desktop"
        ref="popoverRef"
        :style="{ minWidth: '220px', position: 'fixed', zIndex: 9999, top: popoverPos.top + 'px', right: popoverPos.right + 'px' }"
      >
        <form class="MCS__menu-settings">
          <div v-for="setting in props.settings" :key="setting.key" class="MCS__menu-setting-row">
            <label class="MCS__menu-setting-label">{{ setting.label }}:</label>
            <DropdownMenu
              v-if="setting.type === 'dropdown'"
              :items="setting.options?.map(val => ({ id: val, name: val })) ?? []"
              :modelValue="modelValue[setting.key]"
              @update:modelValue="val => updateSetting(setting.key, val)"
              :width="180"
              :placeholder="'Select an option'"
            />
            <div v-else>Not implemented :(</div>
          </div>
        </form>
      </div>
    </teleport>
  </div>
</template>

<style scoped>
.MCS__menu-popover {
  padding: 20px 14px 14px 14px;
  margin-bottom: 8px;
  overflow: visible;
}
.MCS__menu-settings {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.MCS__menu-setting-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
}
.MCS__menu-setting-label {
  font-weight: 600;
  display: block;
  margin-right: 16px;
}
.MCS__menu-radio-group {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.MCS__menu-radio-label {
  cursor: pointer;
}
.MCS__menu-switch {
  display: inline-flex;
  align-items: center;
}
.MCS__switch-slider {
  margin-left: 8px;
  width: 32px;
  height: 18px;
  background: #444;
  border-radius: 16px;
  position: relative;
  display: inline-block;
  transition: background .25s;
}
.MCS__menu-switch input[type="checkbox"]:checked + .MCS__switch-slider {
  background: #13ae7a;
}
.MCS__switch-slider:before {
  content: '';
  position: absolute;
  left: 2px;
  top: 2px;
  width: 14px;
  height: 14px;
  background: #fff;
  border-radius: 50%;
  transition: left .25s;
}
.MCS__menu-switch input[type="checkbox"]:checked + .MCS__switch-slider:before {
  left: 16px;
}
</style>
