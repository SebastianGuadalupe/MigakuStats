<script setup lang="ts">
const props = defineProps<{
  modelValue: string | number;
  type?: "text" | "number" | "email" | "password" | "tel" | "url";
  id?: string;
  name?: string;
  placeholder?: string;
  required?: boolean;
  min?: number;
  max?: number;
  step?: number;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string | number];
}>();

function onInput(e: Event) {
  const target = e.target as HTMLInputElement;
  const value = props.type === "number" ? Number(target.value) : target.value;
  emit("update:modelValue", value);
}
</script>

<template>
  <div class="UiTextInput" style="width: 100%;">
    <input
      :id="id"
      :name="name"
      :type="type ?? 'text'"
      :required="required"
      :placeholder="placeholder"
      :value="modelValue"
      :min="min"
      :max="max"
      :step="step"
      class="UiTextInput__input"
      :style="{textAlign: type === 'number' ? 'right' : 'left', height: '40px'}"
      @input="onInput"
    />
  </div>
</template>
