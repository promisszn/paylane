/** The full client page conversation for one job, for you to read on the dashboard. */
export default defineEventHandler(async (event) => {
  const project = await getProject(getRouterParam(event, 'projectId') ?? '')
  return {
    projectId: project.id,
    client: project.client.name,
    project: project.title,
    clientPage: project.portalToken ? `/pay/${project.portalToken}` : null,
    turns: await getChat(project.id),
  }
})
