<script setup>
// Reference-photo gallery for the AI ID results, modelled on the ithomiini_maps
// gallery: one large hero image + a thumbnail strip grouped per candidate taxon.
// Self-contained (no map stores). Anti-hammer: each group lazy-loads its photos
// only when first shown, capped at MAX_PER_GROUP; collapsed groups load a single
// preview thumb. Sanger photos first, GBIF (museum-first) fallback — never the
// scraped training images.
import { ref, watch, computed } from 'vue'
import { referencesFor } from '../utils/aiReference.js'
import { getBoxes } from '../composables/useCurationData.js'
import AIPhotoView from './AIPhotoView.vue'

const props = defineProps({
  // Ordered candidate groups: [{ id, label, sublabel, taxon }]
  //   taxon  = trinomial/binomial to fetch reference photos for
  //   label  = species/subspecies name shown on the group header
  groups: { type: Array, default: () => [] },
})

const MAX_PER_GROUP = 6
const PREVIEW = 1

// id -> { state:'idle'|'loading'|'ready'|'empty', photos:[], source, level, max }
const loaded = ref({})
const collapsed = ref(new Set())
const hero = ref(null)            // active { photo, groupId, index }
const heroBoxes = ref([])         // wing boxes for the hero (Sanger only), for zoom-to-wings

const sourceLabel = (s) => (s === 'sanger' ? 'Sanger / Ikiam collection' : s === 'gbif' ? 'GBIF' : '')

async function loadGroup(g, max) {
  const cur = loaded.value[g.id]
  if (cur && (cur.state === 'loading' || (cur.state !== 'idle' && cur.max >= max))) return
  loaded.value = { ...loaded.value, [g.id]: { ...(cur || {}), state: 'loading', photos: cur?.photos || [], max } }
  try {
    const r = await referencesFor(g.taxon, max)
    loaded.value = {
      ...loaded.value,
      [g.id]: { state: r.photos.length ? 'ready' : 'empty', photos: r.photos, source: r.source, level: r.level, max },
    }
  } catch {
    loaded.value = { ...loaded.value, [g.id]: { state: 'empty', photos: [], source: 'none', level: 'none', max } }
  }
}

async function setHero(groupId, index) {
  const grp = loaded.value[groupId]
  if (!grp?.photos?.length) return
  const i = Math.max(0, Math.min(index, grp.photos.length - 1))
  const photo = grp.photos[i]
  hero.value = { photo, groupId, index: i }
  // Sanger photos carry a wing_boxes key -> enable "zoom to wings" on the hero.
  heroBoxes.value = []
  if (photo.boxKey) {
    try { heroBoxes.value = await getBoxes(photo.boxKey) } catch { heroBoxes.value = [] }
  }
}

async function expand(g) {
  const set = new Set(collapsed.value)
  if (set.has(g.id)) {
    set.delete(g.id)
    collapsed.value = set
    await loadGroup(g, MAX_PER_GROUP)
    setHero(g.id, 0)
  } else {
    set.add(g.id)
    collapsed.value = set
  }
}

function pickPhoto(groupId, index) {
  // expand the group if collapsed, then select
  const g = props.groups.find((x) => x.id === groupId)
  if (g && collapsed.value.has(groupId)) expand(g)
  setHero(groupId, index)
}

// hero prev/next within the active group
const activeGroup = computed(() => (hero.value ? loaded.value[hero.value.groupId] : null))
const hasPrev = computed(() => !!hero.value && hero.value.index > 0)
const hasNext = computed(() => !!hero.value && activeGroup.value && hero.value.index < activeGroup.value.photos.length - 1)
const heroStep = (d) => { if (hero.value) setHero(hero.value.groupId, hero.value.index + d) }

const isReady = (id) => loaded.value[id]?.state === 'ready'
const previewThumb = (id) => loaded.value[id]?.photos?.[0]
const groupState = (id) => loaded.value[id]?.state || 'idle'

// (Re)initialise whenever the candidate set changes: first group open + loaded,
// the rest collapsed with a single preview thumb.
watch(() => props.groups.map((g) => g.id).join('|'), async () => {
  loaded.value = {}
  hero.value = null
  if (!props.groups.length) { collapsed.value = new Set(); return }
  collapsed.value = new Set(props.groups.slice(1).map((g) => g.id))
  await loadGroup(props.groups[0], MAX_PER_GROUP)
  setHero(props.groups[0].id, 0)
  for (const g of props.groups.slice(1)) loadGroup(g, PREVIEW)   // lazy preview thumbs
}, { immediate: true })
</script>

<template>
  <div class="ai-gal" v-if="groups.length">
    <!-- Hero -->
    <div class="hero">
      <div v-if="hero" class="hero-img-wrap">
        <AIPhotoView :key="hero.photo.url" :src="hero.photo.url" :boxes="heroBoxes"
          :used-index="-1" :show-masks="false" dark :alt="hero.photo.caption" />
        <button v-if="hasPrev" class="hnav hprev" @click="heroStep(-1)" aria-label="Previous reference photo">‹</button>
        <button v-if="hasNext" class="hnav hnext" @click="heroStep(1)" aria-label="Next reference photo">›</button>
        <div class="hero-cap">
          <span class="hcap">{{ hero.photo.caption }}</span>
          <a v-if="hero.photo.link" :href="hero.photo.link" target="_blank" rel="noopener noreferrer" class="hcredit src-link">{{ hero.photo.credit }} ↗</a>
          <span v-else class="hcredit">{{ hero.photo.credit }}</span>
        </div>
      </div>
      <div v-else class="hero-empty text-muted small">No reference photo found yet.</div>
    </div>

    <!-- Grouped thumbnail strip -->
    <div class="strip">
      <div v-for="g in groups" :key="g.id" class="grp" :class="{ active: hero && hero.groupId === g.id }">
        <button class="grp-head" :title="g.taxon" @click="expand(g)">
          <span class="chev" :class="{ collapsed: collapsed.has(g.id) }">▾</span>
          <span class="grp-label"><em>{{ g.label }}</em><span v-if="g.sublabel" class="grp-sub"> · {{ g.sublabel }}</span></span>
          <span v-if="isReady(g.id)" class="grp-count">{{ loaded[g.id].photos.length }}</span>
        </button>

        <!-- collapsed: single preview thumb -->
        <div v-if="collapsed.has(g.id)" class="thumbs">
          <button v-if="previewThumb(g.id)" class="thumb preview" @click="pickPhoto(g.id, 0)" :title="g.label">
            <img :src="previewThumb(g.id).thumb || previewThumb(g.id).url" alt="" loading="lazy" referrerpolicy="no-referrer" />
            <span class="more">+</span>
          </button>
          <span v-else-if="groupState(g.id) === 'loading'" class="ph"><span class="spinner-border spinner-border-sm" /></span>
          <span v-else class="ph small text-muted">—</span>
        </div>

        <!-- expanded: full (capped) set -->
        <div v-else class="thumbs">
          <button
            v-for="(p, i) in (loaded[g.id]?.photos || [])" :key="i"
            class="thumb" :class="{ active: hero && hero.groupId === g.id && hero.index === i }"
            @click="setHero(g.id, i)" :title="p.caption">
            <img :src="p.thumb || p.url" alt="" loading="lazy" referrerpolicy="no-referrer" />
          </button>
          <span v-if="groupState(g.id) === 'loading'" class="ph"><span class="spinner-border spinner-border-sm" /></span>
          <span v-else-if="groupState(g.id) === 'empty'" class="ph small text-muted">none</span>
        </div>
      </div>
    </div>
    <div v-if="hero" class="src-note text-muted">
      {{ sourceLabel(activeGroup?.source) }}<span v-if="activeGroup?.level === 'species'"> · species-level</span>
    </div>
  </div>
</template>

<style scoped>
.ai-gal { display: flex; flex-direction: column; gap: 0.5rem; }

/* Hero */
.hero { background: #0f172a; border-radius: 8px; overflow: hidden; }
/* No fixed height: AIPhotoView wraps the image tightly so "zoom to wings" frames
   the actual pixels. .ai-photo caps itself at max-height and clips overflow. */
.hero-img-wrap { position: relative; min-height: 200px; }
.hero-img-wrap > :deep(.ai-photo) { margin-bottom: 0; border-radius: 8px; }
.hnav, .hero-cap { z-index: 3; }
.src-link { color: #93c5fd; text-decoration: none; }
.src-link:hover { text-decoration: underline; }
.hero-empty { height: 200px; display: flex; align-items: center; justify-content: center; background: #f1f5f9; border-radius: 8px; }
.hnav { position: absolute; top: 50%; transform: translateY(-50%); width: 38px; height: 64px; border: none; background: rgba(0,0,0,.4); color: #fff; font-size: 1.6rem; line-height: 1; cursor: pointer; }
.hnav:hover { background: rgba(0,0,0,.65); }
.hprev { left: 0; border-radius: 0 6px 6px 0; }
.hnext { right: 0; border-radius: 6px 0 0 6px; }
.hero-cap { position: absolute; left: 0; right: 0; bottom: 0; padding: 4px 8px; background: linear-gradient(transparent, rgba(0,0,0,.7)); color: #e2e8f0; font-size: 0.7rem; display: flex; justify-content: space-between; gap: 8px; }
.hero-cap .hcap { font-weight: 600; }

/* Strip */
.strip { display: flex; gap: 4px; overflow-x: auto; padding-bottom: 4px; }
.grp { display: flex; flex-direction: column; flex-shrink: 0; border-left: 3px solid #cbd5e1; background: #f8fafc; border-radius: 0 4px 4px 0; }
.grp.active { border-left-color: #16a34a; }
.grp-head { display: flex; align-items: center; gap: 4px; padding: 3px 8px; border: none; background: #eef2f7; color: #334155; font-size: 0.72rem; cursor: pointer; white-space: nowrap; border-radius: 0 4px 0 0; }
.grp-head:hover { background: #e2e8f0; }
.chev { font-size: 0.7rem; transition: transform .15s; }
.chev.collapsed { transform: rotate(-90deg); }
.grp-label { max-width: 200px; overflow: hidden; text-overflow: ellipsis; }
.grp-sub { font-style: normal; color: #64748b; }
.grp-count { margin-left: auto; padding: 0 5px; background: #94a3b8; color: #fff; border-radius: 3px; font-size: 0.6rem; font-weight: 700; }
.thumbs { display: flex; gap: 3px; padding: 3px; }
.thumb { position: relative; flex-shrink: 0; width: 70px; height: 70px; padding: 0; border: 2px solid transparent; border-radius: 4px; background: #e2e8f0; overflow: hidden; cursor: pointer; }
.thumb img { width: 100%; height: 100%; object-fit: cover; }
.thumb:hover { border-color: #94a3b8; }
.thumb.active { border-color: #16a34a; box-shadow: 0 0 0 1px #16a34a; }
.thumb .more { position: absolute; bottom: 2px; right: 2px; width: 18px; height: 18px; line-height: 18px; text-align: center; background: rgba(0,0,0,.7); color: #fff; border-radius: 3px; font-weight: 700; font-size: 12px; }
.ph { width: 70px; height: 70px; display: flex; align-items: center; justify-content: center; }
.src-note { font-size: 0.7rem; }
@media (max-width: 575px) {
  .thumb, .ph { width: 60px; height: 60px; }
}
</style>
