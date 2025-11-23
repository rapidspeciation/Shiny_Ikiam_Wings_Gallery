<script setup>
import VueMultiselect from 'vue-multiselect'

defineProps({
  label: String,
  modelValue: [String, Array, Object, null],
  options: { type: Array, default: () => [] },
  placeholder: { type: String, default: 'All' },
  multiple: { type: Boolean, default: false }
})

const emit = defineEmits(['update:modelValue'])

const updateValue = (val) => {
  emit('update:modelValue', val)
}
</script>

<template>
  <div class="filter-wrapper">
    <label class="form-label small fw-bold">{{ label }}</label>
    <VueMultiselect
      :model-value="modelValue"
      @update:model-value="updateValue"
      :options="options"
      :placeholder="placeholder"
      :multiple="multiple"
      :close-on-select="!multiple"
      :searchable="true"
      :show-labels="false"
    />
  </div>
</template>

<style scoped>
/* Bootstrap alignment fix for VueMultiselect */
:deep(.multiselect__tags) {
  min-height: 38px;
  padding-top: 6px;
  border-radius: 0.375rem; /* Bootstrap rounded */
  border: 1px solid #dee2e6;
}
</style>
