<script setup>
// Minimalist floating progress notification for the AI Identifier run. Purely
// presentational: the parent computes the current phase (waking / loading / queued /
// analyzing) and an optional 0..1 progress fraction, this just renders it.
//
//   kind     -> drives the accent + which short label shows
//   title    -> primary line (e.g. "Loading the model")
//   detail   -> secondary line (e.g. "2 requests ahead of you")
//   progress -> 0..1 for a determinate bar, or null for an animated indeterminate one
import { computed } from 'vue'

const props = defineProps({
  show: { type: Boolean, default: false },
  kind: { type: String, default: 'analyzing' }, // waking | loading | queued | analyzing
  title: { type: String, default: '' },
  detail: { type: String, default: '' },
  progress: { type: Number, default: null },    // null = indeterminate
})

const pct = computed(() =>
  props.progress == null ? null : Math.max(0, Math.min(100, Math.round(props.progress * 100))),
)
</script>

<template>
  <Transition name="ip-pop">
    <div v-if="show" class="ip" role="status" aria-live="polite" :data-kind="kind">
      <div v-if="kind !== 'ready'" class="ip-spin" aria-hidden="true"></div>
      <div v-else class="ip-check" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
          stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5" /></svg>
      </div>
      <div class="ip-body">
        <div class="ip-title">{{ title }}</div>
        <div v-if="detail" class="ip-detail">{{ detail }}</div>
        <div class="ip-bar" :class="{ indet: pct === null }">
          <div class="ip-fill" :style="pct === null ? null : { width: pct + '%' }"></div>
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.ip {
  position: fixed;
  z-index: 1090;
  right: 1rem;
  bottom: 1rem;
  width: 320px;
  max-width: calc(100vw - 2rem);
  display: flex;
  gap: .75rem;
  align-items: center;
  padding: .8rem .9rem;
  background: #fff;
  border: 1px solid #e6eaf0;
  border-radius: 14px;
  box-shadow: 0 10px 30px rgba(15, 23, 42, .14), 0 2px 6px rgba(15, 23, 42, .06);
}
/* accent per phase */
.ip[data-kind="waking"]   { --accent: #f59e0b; }
.ip[data-kind="loading"]  { --accent: #6366f1; }
.ip[data-kind="queued"]   { --accent: #0ea5e9; }
.ip[data-kind="analyzing"]{ --accent: #16a34a; }
.ip[data-kind="ready"]    { --accent: #16a34a; }

.ip-spin {
  flex: 0 0 auto;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: conic-gradient(var(--accent) 0 25%, transparent 25% 100%);
  -webkit-mask: radial-gradient(closest-side, transparent 64%, #000 66%);
  mask: radial-gradient(closest-side, transparent 64%, #000 66%);
  animation: ip-rot .8s linear infinite;
}
.ip-check {
  flex: 0 0 auto;
  width: 26px;
  height: 26px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--accent);
  animation: ip-pop-in .25s ease;
}
@keyframes ip-pop-in { from { transform: scale(.5); opacity: 0; } to { transform: scale(1); opacity: 1; } }
.ip-body { flex: 1 1 auto; min-width: 0; }
.ip-title {
  font-size: .9rem;
  font-weight: 600;
  color: #0f172a;
  line-height: 1.2;
}
.ip-detail {
  font-size: .78rem;
  color: #64748b;
  margin-top: .12rem;
  line-height: 1.25;
}
.ip-bar {
  position: relative;
  height: 4px;
  margin-top: .55rem;
  border-radius: 999px;
  background: #eef1f6;
  overflow: hidden;
}
.ip-fill {
  position: absolute;
  inset: 0 auto 0 0;
  height: 100%;
  border-radius: 999px;
  background: var(--accent);
  transition: width .35s ease;
}
.ip-bar.indet .ip-fill {
  width: 38%;
  animation: ip-slide 1.15s ease-in-out infinite;
}
@keyframes ip-rot { to { transform: rotate(360deg); } }
@keyframes ip-slide {
  0%   { left: -40%; }
  100% { left: 100%; }
}
/* entrance / exit */
.ip-pop-enter-active, .ip-pop-leave-active { transition: opacity .2s ease, transform .2s ease; }
.ip-pop-enter-from, .ip-pop-leave-to { opacity: 0; transform: translateY(10px); }

@media (max-width: 576px) {
  .ip { left: .75rem; right: .75rem; bottom: .75rem; width: auto; }
}
@media (prefers-reduced-motion: reduce) {
  .ip-spin, .ip-bar.indet .ip-fill { animation-duration: 2.4s; }
}
</style>
