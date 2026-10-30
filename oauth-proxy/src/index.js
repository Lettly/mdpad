/**
 * CORS relay for GitHub's OAuth device flow.
 *
 * github.com/login/device/code and github.com/login/oauth/access_token answer
 * without Access-Control-Allow-Origin, so a static page cannot read them. This
 * worker forwards those two POSTs and adds the header. It holds no secret: the
 * device flow needs only a public client id.
 *
 *   POST /device/code     -> https://github.com/login/device/code
 *   POST /access_token    -> https://github.com/login/oauth/access_token
 */

const UPSTREAM = {
  '/device/code': 'https://github.com/login/device/code',
  '/access_token': 'https://github.com/login/oauth/access_token',
}

const MAX_BODY = 2048

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') ?? ''
    const allowed = (env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean)
    const allowedOrigin = allowed.includes(origin) ? origin : null

    const cors = {
      'access-control-allow-origin': allowedOrigin ?? 'null',
      'access-control-allow-methods': 'POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '86400',
      vary: 'origin',
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: allowedOrigin ? 204 : 403, headers: cors })
    }

    if (!allowedOrigin) return fail('origin_not_allowed', 403, cors)
    if (request.method !== 'POST') return fail('method_not_allowed', 405, cors)

    const target = UPSTREAM[new URL(request.url).pathname]
    if (!target) return fail('not_found', 404, cors)

    const body = await request.text()
    if (body.length > MAX_BODY) return fail('body_too_large', 413, cors)

    let upstream
    try {
      upstream = await fetch(target, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded',
          'user-agent': 'mdpad-oauth-relay',
        },
        body,
      })
    } catch {
      return fail('upstream_unreachable', 502, cors)
    }

    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: {
        ...cors,
        'content-type': 'application/json',
        'cache-control': 'no-store',
      },
    })
  },
}

function fail(error, status, headers) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { ...headers, 'content-type': 'application/json' },
  })
}
