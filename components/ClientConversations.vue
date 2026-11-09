<script setup lang="ts">
/** Every client page that has a conversation, newest first. Open one to read it all or reply. */
const { data, openConversation } = useDashboard()
const list = computed(() => data.value?.conversations ?? [])

const who = (role: string, client: string) => (role === 'client' ? client : role === 'agent' ? 'Agent' : 'You')
const ago = (iso: string) => {
  const mins = Math.round((Date.now() - Date.parse(iso)) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} h ago`
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}
</script>

<template>
  <section class="talk" aria-labelledby="talk-heading">
    <h2 id="talk-heading" class="talk__title">Client pages</h2>
    <p v-if="!list.length" class="talk__empty">
      Every invoice email links to a page where your client can pay and talk to your agent. Conversations show up here.
    </p>
    <ul v-else class="talk__list">
      <li v-for="c in list" :key="c.projectId">
        <button type="button" class="talk__item" @click="openConversation(c.projectId)">
          <span class="talk__top">
            <span class="talk__who">{{ c.client }}, {{ c.project }}</span>
            <time class="talk__when" :datetime="c.lastAt">{{ ago(c.lastAt) }}</time>
          </span>
          <span class="talk__last"><strong>{{ who(c.lastRole, c.client) }}:</strong> {{ c.lastText }}</span>
        </button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.talk__title {
  font-size: var(--t-lg);
}
.talk__empty {
  margin-top: 0.5rem;
  color: var(--ink-soft);
}
.talk__list {
  list-style: none;
  margin: 0.9rem 0 0;
  padding: 0;
  display: grid;
  gap: 0.5rem;
}
.talk__item {
  width: 100%;
  display: grid;
  gap: 0.2rem;
  text-align: left;
  padding: 0.7rem 0.85rem;
  border: 0;
  border-radius: 12px;
  background: var(--paper-pure);
  box-shadow: var(--shadow-sheet);
  color: var(--ink);
  font: var(--t-xs) / 1.45 var(--font-ui);
  cursor: pointer;
  transition:
    transform var(--dur-press) var(--ease-out),
    background-color var(--dur-press) var(--ease-out);
}
.talk__item:active {
  transform: scale(0.99);
}
@media (hover: hover) and (pointer: fine) {
  .talk__item:hover {
    background: #fbfbfd;
  }
}
.talk__top {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
}
.talk__who {
  font-weight: 600;
  font-size: var(--t-sm);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.talk__when {
  color: var(--ink-faint);
  white-space: nowrap;
}
.talk__last {
  color: var(--ink-soft);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.talk__last strong {
  color: var(--ink);
  font-weight: 600;
}
</style>
