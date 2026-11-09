/** Live updates for one client page: only this job's changes and the agent's progress on it. */
export default defineEventHandler(async (event) => {
  const project = await projectForToken(getRouterParam(event, 'token'))
  return streamLive(event, (e) => e.projectId === project.id || (e.type === 'change' && !e.projectId))
})
