<script setup>
import { computed } from 'vue'

const props = defineProps({
  page: { type: Number, required: true },
  total: { type: Number, required: true },
  size: { type: Number, default: 10 },
})
const emit = defineEmits(['update:page'])

const pages = computed(() => Math.max(1, Math.ceil(props.total / props.size)))

function go(p) {
  if (p >= 1 && p <= pages.value && p !== props.page) emit('update:page', p)
}
</script>

<template>
  <nav v-if="pages > 1" class="pager" aria-label="Pagination">
    <button :disabled="page === 1" @click="go(page - 1)">Previous</button>
    <button
      v-for="p in pages"
      :key="p"
      :class="{ on: p === page }"
      :aria-current="p === page ? 'page' : null"
      @click="go(p)"
    >
      {{ p }}
    </button>
    <button :disabled="page === pages" @click="go(page + 1)">Next</button>
  </nav>
</template>

<style scoped>
.pager { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 32px; }
.pager button {
  font: inherit; font-size: 0.95rem; font-weight: 500; min-width: 40px; padding: 6px 14px;
  color: var(--accent); background: transparent; border: 1.5px solid var(--accent); border-radius: 8px; cursor: pointer;
}
.pager button:hover:not(:disabled):not(.on) { background: var(--alt); }
.pager button.on { background: var(--accent); color: var(--paper); }
.pager button:disabled { opacity: 0.4; cursor: default; }
</style>
