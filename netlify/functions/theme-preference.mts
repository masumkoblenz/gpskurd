import { getDatabase } from '@netlify/database'

const browserIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const responseHeaders = { 'Cache-Control': 'no-store' }

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...responseHeaders, 'Content-Type': 'application/json' },
  })
}

export default async (request: Request) => {
  if (request.method === 'GET') {
    const browserId = new URL(request.url).searchParams.get('browserId')
    if (!browserId || !browserIdPattern.test(browserId)) return jsonResponse({ error: 'Invalid browser id' }, 400)

    try {
      const database = getDatabase()
      const preferences = await database.sql`
        SELECT dark_mode
        FROM reber_browser_preferences
        WHERE browser_id = ${browserId}
        LIMIT 1
      `
      return jsonResponse({ darkMode: preferences[0]?.dark_mode ?? null })
    } catch {
      return jsonResponse({ error: 'Theme preference is unavailable' }, 503)
    }
  }

  if (request.method === 'POST') {
    let body: { browserId?: unknown; darkMode?: unknown } | null = null
    try {
      body = await request.json()
    } catch {
      return jsonResponse({ error: 'Invalid request body' }, 400)
    }
    if (!body || typeof body.browserId !== 'string' || !browserIdPattern.test(body.browserId) || typeof body.darkMode !== 'boolean') {
      return jsonResponse({ error: 'Invalid theme preference' }, 400)
    }

    try {
      const database = getDatabase()
      await database.sql`
        INSERT INTO reber_browser_preferences (browser_id, dark_mode, updated_at)
        VALUES (${body.browserId}, ${body.darkMode}, NOW())
        ON CONFLICT (browser_id)
        DO UPDATE SET dark_mode = EXCLUDED.dark_mode, updated_at = NOW()
      `
      return new Response(null, { status: 204, headers: responseHeaders })
    } catch {
      return jsonResponse({ error: 'Theme preference could not be saved' }, 503)
    }
  }

  return new Response(null, { status: 405, headers: { ...responseHeaders, Allow: 'GET, POST' } })
}
