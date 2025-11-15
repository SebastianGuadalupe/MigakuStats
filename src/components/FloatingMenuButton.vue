<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from "vue";
import FloatingButton from "./FloatingButton.vue";
import DropdownMenu from "./DropdownMenu.vue";
import UiToggleSwitch from "./UiToggleSwitch.vue";
import UiTextInput from "./UiTextInput.vue";

const props = defineProps<{
  buttonPos?: { top?: number; bottom?: number; left?: number; right?: number };
  settings: Array<{
    key: string;
    label: string;
    type: "dropdown" | "radio" | "switch" | "group" | "number";
    options?: string[];
    value: any;
    displayPrefix?: string;
    min?: number;
    max?: number;
    step?: number;
    children?: Array<{
      key: string;
      label: string;
      type: "dropdown" | "radio" | "switch" | "number";
      options?: string[];
      value: any;
      min?: number;
      max?: number;
      step?: number;
    }>;
  }>;
  modelValue: Record<string, any>;
  width?: number;
}>();

const emit = defineEmits(["update:modelValue"]);
const isOpen = ref(false);
const btnRef = ref<HTMLElement | null>(null);
const wrapperRef = ref<HTMLElement | null>(null);
const popoverRef = ref<HTMLElement | null>(null);
const popoverPos = ref<{ top: number; right: number }>({ top: 0, right: 0 });

function useClickOutside(
  targetRef: any,
  handler: (e: MouseEvent) => void,
  extraRefs: any[] = []
) {
  function listener(event: MouseEvent) {
    const el = targetRef.value;
    const isInTarget = el && el.contains(event.target as Node);
    const isInExtras = extraRefs.some(
      (r) => r?.value && r.value.contains(event.target as Node)
    );
    if (!el || isInTarget || isInExtras) return;
    handler(event);
  }
  onMounted(() => document.addEventListener("mousedown", listener));
  onBeforeUnmount(() => document.removeEventListener("mousedown", listener));
}

useClickOutside(wrapperRef, () => (isOpen.value = false), [popoverRef]);

function computePopoverPosition() {
  const btn = btnRef.value as any;
  const btnEl: HTMLElement | null = btn?.$el
    ? (btn.$el as HTMLElement)
    : (btn as HTMLElement);
  if (!btnEl) return;
  const rect = btnEl.getBoundingClientRect();
  const gap = 12;
  popoverPos.value = {
    top: Math.round(rect.top + rect.height + gap),
    right: Math.round(
      window.innerWidth - rect.right + (props.buttonPos?.right ?? 24)
    ),
  };
}

function openMenu() {
  isOpen.value = !isOpen.value;
  if (isOpen.value) {
    computePopoverPosition();
  }
}

onMounted(() => {
  const handler = () => {
    if (isOpen.value) computePopoverPosition();
  };
  window.addEventListener("resize", handler);
  window.addEventListener("scroll", handler, true);
  onBeforeUnmount(() => {
    window.removeEventListener("resize", handler);
    window.removeEventListener("scroll", handler, true);
  });
});

function updateSetting(key: string, value: any) {
  emit("update:modelValue", { ...props.modelValue, [key]: value });
}
</script>

<template>
  <div ref="wrapperRef" style="position: absolute; top: 0; right: 0">
    <FloatingButton
      ref="btnRef"
      :bottom="props.buttonPos?.bottom"
      :top="props.buttonPos?.top"
      :left="props.buttonPos?.left"
      :right="props.buttonPos?.right"
      :label="'Open settings menu'"
      :customClass="'MCS__menu-fab'"
      @click="openMenu"
      style="z-index: 1201"
    >
      <template #icon>
        <svg
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <circle cx="12" cy="5" r="1.8" fill="currentColor" />
          <circle cx="12" cy="12" r="1.8" fill="currentColor" />
          <circle cx="12" cy="19" r="1.8" fill="currentColor" />
        </svg>
      </template>
    </FloatingButton>
    <teleport to="body">
      <div
        v-if="isOpen"
        class="MCS__menu-popover UiActionSheet -desktop"
        ref="popoverRef"
        @mousedown.stop
        @click.stop
        :style="{
          minWidth: props.width ? props.width + 'px' : '220px',
          width: props.width ? props.width + 'px' : 'auto',
          maxWidth: props.width ? props.width + 'px' : 'auto',
          position: 'fixed',
          zIndex: 9999,
          top: popoverPos.top + 'px',
          right: popoverPos.right + 'px',
        }"
      >
        <form class="MCS__menu-settings -compact" @mousedown.stop @click.stop>
          <div
            v-for="setting in props.settings"
            :key="setting.key"
            class="MCS__menu-setting-row"
            :class="{ '-active': !!modelValue[setting.key] && setting.type === 'group' }"
          >
            <label class="MCS__menu-setting-label">{{ setting.label }}:</label>
            <template v-if="setting.type === 'group'">
              <UiToggleSwitch
                :id="'toggle-' + setting.key"
                :aria-label="'ID:' + setting.key"
                :modelValue="!!modelValue[setting.key]"
                @update:modelValue="(val) => updateSetting(setting.key, val)"
              />
            </template>
            <DropdownMenu
              v-else-if="setting.type === 'dropdown'"
              :items="
                setting.options?.map((val) => ({ id: val, name: val })) ?? []
              "
              :modelValue="modelValue[setting.key]"
              @update:modelValue="(val) => updateSetting(setting.key, val)"
              :width="180"
              :placeholder="'Select an option'"
            >
              <template #trigger="{ selectedLabel }">
                <span class="multiselect__single">
                  <span
                    class="UiTypo UiTypo__caption -no-wrap multiselect__single__text"
                  >
                    {{
                      setting.displayPrefix && selectedLabel !== "All time"
                        ? setting.displayPrefix + selectedLabel
                        : selectedLabel
                    }}
                  </span>
                </span>
              </template>
            </DropdownMenu>
            <UiToggleSwitch
              v-else-if="setting.type === 'switch'"
              :id="'toggle-' + setting.key"
              :aria-label="'ID:' + setting.key"
              :modelValue="!!modelValue[setting.key]"
              @update:modelValue="(val) => updateSetting(setting.key, val)"
            />
            <UiTextInput
              v-else-if="setting.type === 'number'"
              type="number"
              :min="setting.min"
              :max="setting.max"
              :step="setting.step ?? 1"
              :modelValue="modelValue[setting.key]"
              @update:modelValue="(val) => updateSetting(setting.key, val)"
              :id="'input-' + setting.key"
              style="width: 100px;"
            />
            <div v-else>Not implemented :(</div>
            <div
              v-if="
                setting.type === 'group' &&
                setting.children &&
                modelValue[setting.key]
              "
              class="MCS__menu-setting-row-group"
            >
              <div
                v-for="child in setting.children"
                :key="child.key"
                class="MCS__menu-setting-row -indented"
              >
                <label class="MCS__menu-setting-label"
                  >{{ child.label }}:</label
                >
                <DropdownMenu
                  v-if="child.type === 'dropdown'"
                  :items="
                    child.options?.map((val) => ({ id: val, name: val })) ?? []
                  "
                  :modelValue="modelValue[child.key]"
                  @update:modelValue="(val) => updateSetting(child.key, val)"
                  :width="180"
                  :placeholder="'Select an option'"
                />
                <UiToggleSwitch
                  v-else-if="child.type === 'switch'"
                  :id="'toggle-' + child.key"
                  :aria-label="'ID:' + child.key"
                  :modelValue="!!modelValue[child.key]"
                  @update:modelValue="(val) => updateSetting(child.key, val)"
                />
                <UiTextInput
                  v-else-if="child.type === 'number'"
                  type="number"
                  :min="child.min"
                  :max="child.max"
                  :step="child.step ?? 1"
                  :modelValue="modelValue[child.key]"
                  @update:modelValue="(val) => updateSetting(child.key, val)"
                  :id="'input-' + child.key"
                  style="width: 100px;"
                />
                <div v-else>Not implemented :(</div>
              </div>
            </div>
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
.MCS__menu-settings.-compact {
  gap: 8px;
}
.MCS__menu-setting-row {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  width: 100%;

  &.-active {
    display:grid;
    grid-template-areas: "label value" "group group";
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
    width: 100%;
  }

  :nth-child(2) {
    margin-left: auto;
  }

  .-indented {
    display: flex;
    flex-direction: row;
    align-items: center;
    margin-bottom: 0px;
    gap: 4px;
  }

  label {
    flex: 1;
  }

  :deep(.UiToggle) {
    height: 40px;
  }
}
.MCS__menu-setting-row-group {
  grid-area: group;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding-left: 24px;

  :deep(.UiToggle) {
    height: 30px;
  }
}
.MCS__menu-setting-label {
  font-weight: 600;
  display: block;
  margin-right: 8px;
}
</style>
