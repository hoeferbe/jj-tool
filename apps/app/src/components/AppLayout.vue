<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonItem, IonList, IonPage, IonPopover, IonTitle, IonToolbar } from '@ionic/vue'
import { chevronDownOutline, constructOutline, logOutOutline, mapOutline, peopleOutline, settingsOutline, trailSignOutline } from 'ionicons/icons'

const router = useRouter()
const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8787'
const displayName = localStorage.getItem('displayName') ?? ''
const userMenuTriggerId = `user-menu-trigger-${crypto.randomUUID()}`

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

onMounted(() => window.addEventListener('auth-changed', refreshTokenInfo))
onBeforeUnmount(() => window.removeEventListener('auth-changed', refreshTokenInfo))
async function navigate(path: string) {
  await router.push(path)
  const hash = path.split('#')[1]
  if (hash) requestAnimationFrame(() => document.getElementById(hash)?.scrollIntoView({ behavior: 'smooth' }))
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
        <IonTitle>Jagdgruppe</IonTitle>
        <IonButtons slot="end">
          <IonButton :id="userMenuTriggerId" aria-label="Benutzermenü">
            {{ displayName || 'Menü' }}
            <IonIcon slot="end" :icon="chevronDownOutline" />
          </IonButton>
        </IonButtons>
      </IonToolbar>
      <IonPopover :trigger="userMenuTriggerId" trigger-action="click" dismiss-on-select>
        <IonList lines="none">
          <IonItem button @click="navigate('/reviere/karte')">
            <IonIcon slot="start" :icon="mapOutline" />
            Revierkarte
          </IonItem>
          <IonItem button @click="navigate('/reviere/mitglieder')">
            <IonIcon slot="start" :icon="peopleOutline" />
            Reviermitglieder
          </IonItem>
          <IonItem button @click="navigate('/reviere/einrichtungen')">
            <IonIcon slot="start" :icon="constructOutline" />
            Reviereinrichtungen
          </IonItem>
          <IonItem button @click="navigate('/reviere/strecke')">
            <IonIcon slot="start" :icon="trailSignOutline" />
            Streckeneinträge
          </IonItem>
          <IonItem v-if="isAdmin" button @click="navigate('/dashboard')">
            <IonIcon slot="start" :icon="settingsOutline" />
            Administration
          </IonItem>
          <IonItem button @click="logout">
            <IonIcon slot="start" :icon="logOutOutline" />
            Abmelden
          </IonItem>
        </IonList>
      </IonPopover>
    </IonHeader>
    <IonContent>
      <slot />
    </IonContent>
  </IonPage>
</template>
