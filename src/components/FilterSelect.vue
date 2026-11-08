<script setup>
import { ref, computed, inject, useId, onMounted, onUpdated } from 'vue'
import VueMultiselect from 'vue-multiselect'

const props = defineProps({
  label: String,
  modelValue: [String, Array, Object, null],
  options: { type: Array, default: () => [] },
  placeholder: { type: String, default: 'All' },
  multiple: { type: Boolean, default: false }
})

const emit = defineEmits(['update:modelValue'])

// A filter with nothing to pick (e.g. Family, empty in every collection record) is hidden,
// with its grid column, once the tab's data has loaded; a set value keeps it visible.
const dataReady = inject('filterDataReady', computed(() => true))
const hasValue = computed(() => (Array.isArray(props.modelValue) ? props.modelValue.length > 0 : !!props.modelValue))
const isEmpty = computed(() => dataReady.value && !props.options.length && !hasValue.value)
const updateValue = (val) => {
  emit('update:modelValue', val)
}

// The visible label names the control: its search input gets the id the <label> points
// at, and the combobox, input and list are labelled by it (vue-multiselect would name the
// input "<name>-searchbox").
const uid = `fs-${useId()}`
const labelId = `${uid}-label`
const root = ref(null)
const nameParts = () => {
  const el = root.value
  if (!el) return
  for (const part of el.querySelectorAll('.multiselect, .multiselect__input, .multiselect__content')) {
    part.removeAttribute('aria-label')
    part.setAttribute('aria-labelledby', labelId)
  }
}
onMounted(nameParts)
onUpdated(nameParts)
</script>

<template>
  <div ref="root" class="filter-wrapper" :hidden="isEmpty">
    <label :id="labelId" class="form-label small fw-bold" :for="uid">{{ label }}</label>
    <VueMultiselect
      :id="uid"
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
/* form-select metrics for the multiselect live in src/style.css */
/* long names (e.g. "Mechanitis polymnia" in a half-width phone column) wrap instead of being cut */
:deep(.multiselect__tag) {
  white-space: normal;
  text-overflow: clip;
  line-height: 1.2;
}
</style>
