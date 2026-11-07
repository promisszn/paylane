import fsDriver from 'unstorage/drivers/fs'
import redisDriver from 'unstorage/drivers/redis'

/**
 * Where Paylane keeps its projects and activity log (the "db" store used by store.ts).
 *
 * - Locally: JSON files in ./.data/db, so the project runs with zero external services.
 * - Hosted: a host's disk is usually wiped on every deploy, so when REDIS_URL is set
 *   (Render Key Value, Upstash or any Redis) the same store lives in Redis instead.
 *
 * Read at runtime, so one build works in both places. store.ts doesn't change either way.
 */
export default defineNitroPlugin(() => {
  const redisUrl = process.env.REDIS_URL
  useStorage().mount(
    'db',
    redisUrl ? redisDriver({ url: redisUrl, base: 'paylane' }) : fsDriver({ base: './.data/db' }),
  )
  console.info(`[paylane] storage: ${redisUrl ? 'Redis (REDIS_URL)' : 'local files in ./.data/db'}`)
})
