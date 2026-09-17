import { computed, ref } from 'vue'

export interface QueuedRequest {
  id: string
  url: string
  method: 'POST' | 'PUT' | 'PATCH'
  body: string
  description: string
  createdAt: string
}

const STORAGE_KEY = 'jj-offline-queue'

function loadQueue(): QueuedRequest[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return stored ? JSON.parse(stored) as QueuedRequest[] : []
  } catch {
    return []
  }
}

// Module-level singleton so the queue and its pending count are shared across all components.
const queue = ref<QueuedRequest[]>(loadQueue())
const pendingCount = computed(() => queue.value.length)

function persistQueue() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(queue.value))
}

function token() {
  return localStorage.getItem('accessToken') ?? ''
}

/** A thrown (not just non-2xx) fetch failure means the request never reached the server at all. */
function isNetworkError(error: unknown) {
  return error instanceof TypeError
}

/**
 * Sends a JSON write request (POST/PUT/PATCH). If the fetch itself fails (no connectivity), the
 * request is queued in localStorage for a later automatic retry instead of losing the user's input.
 * A real server response (including validation errors) is returned as-is and never queued.
 */
export async function submitOrQueue(input: { url: string; method: QueuedRequest['method']; body: string; description: string }): Promise<{ queued: false; response: Response } | { queued: true }> {
  try {
    const response = await fetch(input.url, {
      method: input.method,
      headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
      body: input.body,
    })
    return { queued: false, response }
  } catch (error) {
    if (!isNetworkError(error)) throw error
    queue.value = [...queue.value, { ...input, id: crypto.randomUUID(), createdAt: new Date().toISOString() }]
    persistQueue()
    return { queued: true }
  }
}

/**
 * Retries queued requests in order (oldest first). Stops at the first request that still can't
 * reach the server, so the queue keeps its order and is retried again on the next flush.
 * Any actual server response (success or rejection) resolves that entry either way.
 */
export async function flushOfflineQueue() {
  while (queue.value.length) {
    const next = queue.value[0]!
    try {
      await fetch(next.url, {
        method: next.method,
        headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' },
        body: next.body,
      })
      queue.value = queue.value.slice(1)
      persistQueue()
    } catch {
      break
    }
  }
}

/** Shared access to the pending offline write queue (used for the "wird synchronisiert" banner). */
export function useOfflineQueue() {
  return { queue, pendingCount, submitOrQueue, flushOfflineQueue }
}
