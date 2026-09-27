// Shared state for the Collection compare drawer (TaxonDrawer.vue, mounted once
// in App.vue). A taxon clicked in any card's prediction table opens the drawer
// with that specimen's photos beside reference photos of the taxon.
import { reactive } from 'vue'

const state = reactive({
  open: false,
  item: null,       // the collection row (CAM_ID, URLd, URLv, ...)
  pred: null,       // its model prediction
  taxon: '',        // selected genus / species / subspecies
  recorded: null,   // { species, subspecies } of the database record
  returnFocus: null,
})

export function useTaxonDrawer() {
  function openDrawer({ item, pred, taxon, recorded }) {
    state.returnFocus = typeof document !== 'undefined' ? document.activeElement : null
    Object.assign(state, { item, pred, taxon, recorded, open: true })
  }
  function setTaxon(taxon) { state.taxon = taxon }
  function closeDrawer() {
    if (!state.open) return
    state.open = false
    const el = state.returnFocus
    state.returnFocus = null
    el?.focus?.()
  }
  return { state, openDrawer, setTaxon, closeDrawer }
}
