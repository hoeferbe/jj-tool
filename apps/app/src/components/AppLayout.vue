<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { IonBadge, IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonInput, IonItem, IonLabel, IonList, IonModal, IonNote, IonPage, IonPopover, IonTitle, IonToolbar } from '@ionic/vue'
import { addCircleOutline, chevronDownOutline, clipboardOutline, constructOutline, logOutOutline, mapOutline, notificationsOutline, peopleOutline, personCircleOutline, settingsOutline, trailSignOutline } from 'ionicons/icons'
import { useNews } from '../composables/useNews'
import { useOfflineQueue } from '../composables/useOfflineQueue'

const router = useRouter()
const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8787'
const displayName = ref(localStorage.getItem('displayName') ?? '')
const showProfile = ref(false)
const profile = ref({ username: '', displayName: '', email: '' })
const profileSaving = ref(false)
const profileError = ref('')

const { newsItems, newsCount, loadNews, markAllNewsSeen, sectionHasNews } = useNews()
const { pendingCount, flushOfflineQueue } = useOfflineQueue()

const uuid =
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now()}-${Math.random().toString(36).slice(2)}`

const userMenuTriggerId = `user-menu-trigger-${uuid}`
const newsMenuTriggerId = `news-menu-trigger-${uuid}`

//const userMenuTriggerId = `user-menu-trigger-${crypto.randomUUID()}`

/**
 * Reads role and isAdmin out of the JWT payload stored in localStorage.
 * No signature verification – used only to decide which nav items to show.
 */
function decodeTokenInfo(): { accountType: string; hasRevierAdminAccess?: boolean } | null {
  const token = localStorage.getItem('accessToken')
  if (!token) return null
  try {
    return JSON.parse(atob(token.split('.')[1])) as { accountType: string; hasRevierAdminAccess?: boolean }
  } catch { return null }
}

const tokenInfo = ref(decodeTokenInfo())
// Show the dashboard navigation link for users with full admin access.
const isAdmin = computed(() => tokenInfo.value
  ? tokenInfo.value.accountType === 'systemAdmin' || tokenInfo.value.hasRevierAdminAccess === true
  : false)

function refreshTokenInfo() {
  tokenInfo.value = decodeTokenInfo()
}

/** Formats a news item's timestamp as a short localized date/time string. */
function formatNewsTime(value: string) {
  return new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
}

onMounted(() => window.addEventListener('auth-changed', refreshTokenInfo))
onMounted(loadNews)
onBeforeUnmount(() => window.removeEventListener('auth-changed', refreshTokenInfo))
/** Navigates to a menu target and, if it has a `#hash`, smooth-scrolls to that element afterwards. */
async function navigate(path: string) {
  await router.push(path)
  const hash = path.split('#')[1]
  if (hash) requestAnimationFrame(() => document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth' }))
}

/** Loads the current user's profile fields into the edit modal. */
async function openProfile() {
  profileError.value = ''
  const token = localStorage.getItem('accessToken')
  const response = await fetch(`${apiUrl}/auth/me`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
  const data = await response.json() as { user?: { username: string; displayName: string; email: string }; message?: string }
  if (!response.ok || !data.user) {
    profileError.value = data.message ?? 'Profildaten konnten nicht geladen werden.'
    showProfile.value = true
    return
  }
  profile.value = data.user
  showProfile.value = true
}

/** Saves the edited display name/e-mail and updates the cached display name shown in the toolbar. */
async function saveProfile() {
  profileSaving.value = true
  profileError.value = ''
  const token = localStorage.getItem('accessToken')
  try {
    const response = await fetch(`${apiUrl}/auth/me`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ displayName: profile.value.displayName, email: profile.value.email }),
    })
    const data = await response.json() as { user?: { displayName: string; email: string }; message?: string }
    if (!response.ok || !data.user) throw new Error(data.message ?? 'Profil konnte nicht gespeichert werden.')
    displayName.value = data.user.displayName
    localStorage.setItem('displayName', data.user.displayName)
    showProfile.value = false
  } catch (error) {
    profileError.value = error instanceof Error ? error.message : 'Profil konnte nicht gespeichert werden.'
  } finally {
    profileSaving.value = false
  }
}

/**
 * Logs the user out: sends the JWT to the server to delete all sessions,
 * clears localStorage, and navigates to the login page.
 */
async function logout() {
  const mapLayer = localStorage.getItem('jj-revier-map-layer')
  try {
    const token = localStorage.getItem('accessToken')
    await fetch(`${apiUrl}/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token ?? ''}` },
    })
  } catch {
    // best effort – still clear local session on network failure
  }
  localStorage.clear()
  if (mapLayer) localStorage.setItem('jj-revier-map-layer', mapLayer)
  router.replace('/')
}
</script>

<template>
  <IonPage>
    <IonHeader>
      <IonToolbar>
        <IonTitle>Mein Jagdrevier</IonTitle>
        <IonButtons slot="end">
          <IonButton :id="newsMenuTriggerId" aria-label="Neuigkeiten" class="news-button">
            <IonIcon slot="icon-only" :icon="notificationsOutline" />
            <IonBadge v-if="newsCount" color="danger" class="news-badge">{{ newsCount }}</IonBadge>
          </IonButton>
          <IonButton :id="userMenuTriggerId" aria-label="Benutzermenü">
            {{ displayName || 'Menü' }}
            <IonIcon slot="end" :icon="chevronDownOutline" />
          </IonButton>
        </IonButtons>
      </IonToolbar>
      <IonPopover :trigger="newsMenuTriggerId" trigger-action="click" @did-present="markAllNewsSeen">
        <IonList lines="full" class="news-list">
          <IonNote v-if="!newsItems.length" class="news-empty">Keine neuen Ereignisse seit deinem letzten Besuch.</IonNote>
          <IonItem v-for="item in newsItems" :key="item.id">
            <IonLabel class="ion-text-wrap">
              <p>{{ item.text }}</p>
              <p class="news-meta">{{ item.revierName }} · {{ formatNewsTime(item.createdAt) }}</p>
            </IonLabel>
          </IonItem>
        </IonList>
      </IonPopover>
      <IonPopover :trigger="userMenuTriggerId" trigger-action="click" dismiss-on-select>
        <IonList lines="none">
          <IonItem button @click="navigate('/reviere/karte')">
            <IonIcon slot="start" :icon="mapOutline" />
            Revierkarte
            <IonBadge v-if="sectionHasNews('karte')" color="danger" class="menu-item-badge">•</IonBadge>
          </IonItem>
          <IonItem button @click="navigate('/reviere/mitglieder')">
            <IonIcon slot="start" :icon="peopleOutline" />
            Reviermitglieder
            <IonBadge v-if="sectionHasNews('mitglieder')" color="danger" class="menu-item-badge">•</IonBadge>
          </IonItem>
          <IonItem button @click="navigate('/reviere/einrichtungen')">
            <IonIcon slot="start" :icon="constructOutline" />
            Reviereinrichtungen
            <IonBadge v-if="sectionHasNews('einrichtungen')" color="danger" class="menu-item-badge">•</IonBadge>
          </IonItem>
          <IonItem button @click="navigate('/reviere/strecke')">
            <IonIcon slot="start" :icon="trailSignOutline" />
            Streckeneinträge
          </IonItem>
          <IonItem button @click="navigate('/reviere/aufgaben')">
            <IonIcon slot="start" :icon="clipboardOutline" />
            Revieraufgaben
            <IonBadge v-if="sectionHasNews('aufgaben')" color="danger" class="menu-item-badge">•</IonBadge>
          </IonItem>
          <div class="user-menu-divider" role="separator"></div>
          <IonItem button @click="navigate('/reviere/karte?action=new-revier')">
            <IonIcon slot="start" :icon="addCircleOutline" />
            Neues Revier
          </IonItem>
          <div class="user-menu-divider" role="separator"></div>
          <IonItem button @click="openProfile">
            <IonIcon slot="start" :icon="personCircleOutline" />
            Mein Profil
          </IonItem>
          <IonItem v-if="isAdmin" button @click="navigate('/dashboard')">
            <IonIcon slot="start" :icon="settingsOutline" />
            Administration
          </IonItem>
          <div class="user-menu-divider" role="separator"></div>
          <IonItem button @click="logout">
            <IonIcon slot="start" :icon="logOutOutline" />
            Abmelden
          </IonItem>
        </IonList>
      </IonPopover>
    </IonHeader>
    <IonContent>
      <div class="motd" role="status">Diese App befindet sich noch in der Entwicklung.</div>
      <div v-if="pendingCount" class="offline-banner" role="status">
        <span>{{ pendingCount }} {{ pendingCount === 1 ? 'Änderung wartet' : 'Änderungen warten' }} auf eine Verbindung und werden automatisch gesendet.</span>
        <IonButton size="small" fill="clear" @click="flushOfflineQueue">Jetzt erneut versuchen</IonButton>
      </div>
      <slot />
    </IonContent>
    <IonModal :is-open="showProfile" @did-dismiss="showProfile = false">
      <IonHeader>
        <IonToolbar>
          <IonTitle>Mein Profil</IonTitle>
          <IonButtons slot="end"><IonButton @click="showProfile = false">Schließen</IonButton></IonButtons>
        </IonToolbar>
      </IonHeader>
      <IonContent class="ion-padding">
        <form class="profile-form" @submit.prevent="saveProfile">
          <IonItem><IonInput :value="profile.username" label="Login-Name" label-placement="stacked" readonly /></IonItem>
          <IonItem><IonInput v-model="profile.displayName" label="Name" label-placement="stacked" autocomplete="name" required /></IonItem>
          <IonItem><IonInput v-model="profile.email" type="email" label="E-Mail" label-placement="stacked" autocomplete="email" required /></IonItem>
          <IonNote v-if="profileError" color="danger">{{ profileError }}</IonNote>
          <IonButton type="submit" expand="block" :disabled="profileSaving">
            {{ profileSaving ? 'Speichern...' : 'Speichern' }}
          </IonButton>
        </form>
      </IonContent>
    </IonModal>
  </IonPage>
</template>

<style scoped>
.motd { padding: 7px 16px; border-bottom: 1px solid #d3d8c7; background: #eef1e7; color: #536142; font-size: 0.85rem; text-align: center; }
.offline-banner { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 8px; padding: 7px 16px; border-bottom: 1px solid #f2c94c; background: #fdf3d6; color: #6b5300; font-size: 0.85rem; text-align: center; }
.profile-form { display: grid; gap: 16px; max-width: 560px; margin: 0 auto; }
.news-button { position: relative; }
.news-badge { position: absolute; top: 2px; right: 2px; font-size: 0.6rem; padding: 2px 5px; }
.news-empty { display: block; padding: 12px 16px; }
.news-meta { color: var(--ion-color-medium-shade); font-size: 0.8rem; }
.menu-item-badge { margin-left: 6px; padding: 3px 6px; font-size: 0.65rem; }
:global(.news-list) { min-width: 280px; max-width: min(360px, 90vw); }
:global(.user-menu-divider) { height: 1px; margin: 0; background: var(--ion-color-light-shade, #d7d8da); }
</style>
