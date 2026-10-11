/** Thrown for any response the caller didn't expect, with the server's own
 * `error` text when it sent one. */
export class HttpError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}

export interface HttpOptions {
  /** Prefix for every path; '' = same origin (the deploy, or Vite's proxy). */
  baseUrl?: string
  fetch?: typeof globalThis.fetch
}

/** JSON over fetch with the session cookie. The cookie is HttpOnly, so it's
 * never touched here: the browser sends it with every same-origin request. */
export function createRequester(opts: HttpOptions = {}) {
  const baseUrl = opts.baseUrl ?? ''
  const doFetch = opts.fetch ?? ((input, init) => globalThis.fetch(input, init))

  return async function request(method: string, path: string, body?: unknown): Promise<Response> {
    return doFetch(`${baseUrl}${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  }
}

export async function errorFrom(res: Response): Promise<HttpError> {
  let message = `${res.status} ${res.statusText}`.trim()
  try {
    const body = (await res.json()) as { error?: unknown }
    if (typeof body.error === 'string') message = body.error
  } catch {
    // Not JSON: keep the status line.
  }
  return new HttpError(res.status, message)
}
