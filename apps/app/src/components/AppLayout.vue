<script setup lang="ts">
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { IonButton, IonButtons, IonContent, IonHeader, IonPage, IonTitle, IonToolbar } from '@ionic/vue'

const route = useRoute()
const router = useRouter()
const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8787'
const displayName = localStorage.getItem('displayName') ?? ''

/**
 * Reads role and isAdmin out of the JWT payload stored in localStorage.
 * No signature verification – used only to decide which nav items to show.
 */
function decodeTokenInfo(): { role: string; isAdmin?: boolean } | null {
  const token = localStorage.getItem('accessToken')
  if (!token) return null
  try {
    return JSON.parse(atob(token.split('.')[1])) as { role: string; isAdmin?: boolean }
  } catch { return null }
}

const tokenInfo = decodeTokenInfo()
// Show the dashboard navigation link for users with full admin access.
const isAdmin = tokenInfo ? (tokenInfo.role === 'admin' || tokenInfo.isAdmin === true) : false
// Used to swap the header button between 'Dashboard' and 'Meine Seite'.
const onDashboard = computed(() => route.path === '/dashboard')

/**
 * Logs the user out: sends the JWT to the server to delete all sessions,
 * clears localStorage, and navigates to the login page.
 */
async function logout() {
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
  router.replace('/')
}
</script>

<template>
  <IonPage>
    <IonHeader>
      <IonToolbar>
        <IonTitle>Jagdgruppe</IonTitle>
        <IonButtons slot="end">
          <template v-if="isAdmin">
            <IonButton v-if="onDashboard" fill="clear" @click="router.push('/welcome')">Meine Seite</IonButton>
            <IonButton v-else fill="clear" @click="router.push('/dashboard')">Dashboard</IonButton>
          </template>
          <IonButton @click="logout">{{ displayName }} · Abmelden</IonButton>
        </IonButtons>
      </IonToolbar>
    </IonHeader>
    <IonContent>
      <slot />
    </IonContent>
  </IonPage>
</template>
