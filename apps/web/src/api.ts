const TOKEN_KEY = 'orpos_token'

export function getToken() {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (!headers.has('Content-Type') && init.body) headers.set('Content-Type', 'application/json')
  const token = getToken()
  if (token) headers.set('Authorization', `Bearer ${token}`)

  let res: Response
  try {
    res = await fetch(path, { ...init, headers })
  } catch {
    throw new Error(
      'Cannot reach API. Start the stack with `npm run dev` (API on :3001, UI on :5173).',
    )
  }
  if (!res.ok) {
    let message = res.statusText || `HTTP ${res.status}`
    try {
      const body = await res.json()
      message = body?.error?.message ?? message
    } catch {
      /* ignore */
    }
    throw new Error(message)
  }
  if (res.headers.get('content-type')?.includes('text/csv')) {
    return (await res.text()) as T
  }
  return res.json() as Promise<T>
}
