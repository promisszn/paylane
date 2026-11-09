/** The client page's data: this job's invoices, schedule and conversation. Public, by secret link. */
export default defineEventHandler(async (event) => {
  const project = await projectForToken(getRouterParam(event, 'token'))
  setHeader(event, 'Cache-Control', 'no-store')
  setHeader(event, 'X-Robots-Tag', 'noindex')
  return portalView(project)
})
