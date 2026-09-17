import { ref } from 'vue'

export interface NewsItem { id: string; type: string; revierId: string; revierName: string; text: string; createdAt: string }

/** Menu sections that can show a news badge, and which news item types belong to them. */
export const NEWS_SECTIONS: Record<string, { path: string; types: string[] }> = {
  karte: { path: '/reviere/karte', types: ['facility'] },
  mitglieder: { path: '/reviere/mitglieder', types: ['mitglied'] },
  einrichtungen: { path: '/reviere/einrichtungen', types: ['facility', 'einrichtungsAufgabe', 'reservierung'] },
  aufgaben: { path: '/reviere/aufgaben', types: ['revierAufgabe', 'einrichtungsAufgabe'] },
}

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8787'
const sectionSeenStorageKey = (section: string) => `jj-news-seen-${section}`

// Module-level singleton so every AppLayout/view instance shares one fetched feed instead of refetching per navigation.
const newsItems = ref<NewsItem[]>([])
const newsCount = ref(0)

/**
 * Fetches the news-since-last-visit feed and updates the shared state (does not mark it as seen).
 * Exported directly (not just via `useNews()`) so it can be triggered outside components too,
 * e.g. from the router's `afterEach` hook – Ionic's IonRouterOutlet keeps previous pages mounted,
 * so a plain `onMounted` refresh per view is not reliable for catching every navigation.
 */
export async function loadNews() {
  const token = localStorage.getItem('accessToken')
  if (!token) return
  try {
    const response = await fetch(`${apiUrl}/neuigkeiten`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
    if (!response.ok) return
    const data = await response.json() as { items: NewsItem[]; count: number }
    newsItems.value = data.items
    newsCount.value = data.count
  } catch {
    // best effort – badge just keeps its previous value on network failure
  }
}

/** Marks the whole feed as seen on the server (used by the notification bell) and clears its badge. */
async function markAllNewsSeen() {
  if (!newsItems.value.length && !newsCount.value) return
  newsCount.value = 0
  const token = localStorage.getItem('accessToken')
  try {
    await fetch(`${apiUrl}/neuigkeiten/gesehen`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
  } catch {
    // best effort – badge stays cleared locally even if the request fails
  }
}

/** Timestamp (ISO) of the last time this section's page was visited; defaults to "never". */
function getSectionSeenAt(section: string) {
  return localStorage.getItem(sectionSeenStorageKey(section)) ?? '1970-01-01T00:00:00.000Z'
}

/** Marks a section as visited now, so its menu badge and "neu"-highlights clear on the next check. */
function markSectionSeen(section: string) {
  localStorage.setItem(sectionSeenStorageKey(section), new Date().toISOString())
}

/** Whether a menu section has any fetched news item newer than the section's last visit. */
function sectionHasNews(section: string) {
  const config = NEWS_SECTIONS[section]
  if (!config) return false
  const seenAt = getSectionSeenAt(section)
  return newsItems.value.some((item) => config.types.includes(item.type) && item.createdAt > seenAt)
}

/** Shared access to the news-since-last-visit feed and per-section "seen" tracking. */
export function useNews() {
  return { newsItems, newsCount, loadNews, markAllNewsSeen, getSectionSeenAt, markSectionSeen, sectionHasNews }
}
