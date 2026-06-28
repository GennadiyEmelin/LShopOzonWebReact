export function getApiErrorMessage(errorText: string, fallback: string) {
  if (!errorText.trim()) {
    return fallback
  }

  try {
    const data = JSON.parse(errorText) as { detail?: string; title?: string; message?: string }
    return data.detail || data.message || data.title || fallback
  } catch {
    return errorText.length > 180 ? `${errorText.slice(0, 180)}...` : errorText
  }
}

export async function parseApiErrorMessage(response: Response, fallback: string) {
  const errorText = await response.text()
  return getApiErrorMessage(errorText, fallback)
}

export function authHeaders(token: string | null | undefined): HeadersInit {
  return token ? { Authorization: `Bearer ${token}` } : {}
}

export async function apiFetch(
  input: RequestInfo | URL,
  token: string | null | undefined,
  init: RequestInit = {},
) {
  const headers = new Headers(init.headers)
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  return fetch(input, {
    ...init,
    headers,
  })
}
