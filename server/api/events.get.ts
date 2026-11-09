/** Live updates for the dashboard: every change, plus what the agent is doing on client pages. */
export default defineEventHandler((event) => streamLive(event))
