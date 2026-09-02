<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  IonButton,
  IonCard,
  IonCardContent,
  IonCardHeader,
  IonCardTitle,
  IonContent,
  IonHeader,
  IonInput,
  IonItem,
  IonList,
  IonNote,
  IonPage,
  IonSegment,
  IonSegmentButton,
  IonSelect,
  IonSelectOption,
  IonTitle,
  IonToolbar,
} from '@ionic/vue'

/** Which sub-view is currently active inside the auth page. */
type View = 'login' | 'register' | 'forgot' | 'reset'

/** Shape of every API response on this page (all fields are optional by design). */
interface ApiResult {
  message?: string
  accessToken?: string
  previousLoginAt?: string
  sessionId?: string
  user?: { id: string; displayName: string; accountType: string; memberships: Array<{ isAdmin: boolean }> }
}

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8787'
const router = useRouter()
// If the URL contains ?set-password=TOKEN the page opens directly in reset mode.
const initialToken = new URLSearchParams(window.location.search).get('set-password')
const invitationToken = new URLSearchParams(window.location.search).get('invite')
const view = ref<View>(initialToken ? 'reset' : invitationToken ? 'register' : 'login')
const message = ref('')
const isSubmitting = ref(false)
const login = ref({ identifier: '', password: '' })
const registration = ref({ username: '', displayName: '', email: '', revierId: '', invitationToken: invitationToken ?? '' })
const publicReviere = ref<Array<{ id: string; name: string; municipalityName: string }>>([])
const invitedRevierName = ref('')
const forgotEmail = ref('')
const resetPassword = ref('')
const registrationSubmitted = ref(false)

// Hide the login/register segment tabs while the password-reset form is shown.
const showNavigation = computed(() => view.value !== 'reset')

/**
 * Sends a POST request and parses the JSON response.
 * Throws if the server returns a non-JSON body or a non-2xx status.
 */
async function request(path: string, body: Record<string, string>) {
  const response = await fetch(`${apiUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  // Guard against plain-text error responses (e.g. 500 Internal Server Error).
  if (!response.headers.get('content-type')?.includes('application/json')) {
    throw new Error('Die Anfrage konnte nicht verarbeitet werden.')
  }
  const result = (await response.json()) as ApiResult
  if (!response.ok) {
    throw new Error(result.message ?? 'Die Anfrage konnte nicht verarbeitet werden.')
  }
  return result
}

onMounted(async () => {
  try {
    const response = await fetch(`${apiUrl}/public/reviere`)
    if (response.ok) {
      publicReviere.value = ((await response.json()) as { reviere: typeof publicReviere.value }).reviere
    }
    if (invitationToken) {
      const invitationResponse = await fetch(`${apiUrl}/auth/invitations/${encodeURIComponent(invitationToken)}`)
      const result = await invitationResponse.json() as {
        message?: string
        invitation?: { email: string; revierId: string; revierName: string }
      }
      if (!invitationResponse.ok || !result.invitation) throw new Error(result.message ?? 'Einladung konnte nicht geladen werden.')
      registration.value.email = result.invitation.email
      registration.value.revierId = result.invitation.revierId
      invitedRevierName.value = result.invitation.revierName
    }
  } catch (error) {
    message.value = error instanceof Error ? error.message : 'Registrierungsdaten konnten nicht geladen werden.'
  }
})

/**
 * Wraps an async action with loading state and error handling.
 * Sets `message` to the returned string on success, or to the error message on failure.
 */
async function submit(action: () => Promise<string>) {
  isSubmitting.value = true
  message.value = ''
  try {
    message.value = await action()
  } catch (error) {
    message.value = error instanceof Error ? error.message : 'Ein unerwarteter Fehler ist aufgetreten.'
  } finally {
    isSubmitting.value = false
  }
}

function submitLogin() {
  return submit(async () => {
    const result = await request('/auth/login', login.value)
    if (result.accessToken && result.user) {
      localStorage.setItem('accessToken', result.accessToken)
      localStorage.setItem('displayName', result.user.displayName)
      localStorage.setItem('sessionId', result.sessionId ?? '')
      if (result.previousLoginAt) {
        localStorage.setItem('previousLoginAt', result.previousLoginAt)
      } else {
        localStorage.removeItem('previousLoginAt')
      }
      const hasAdminAccess = result.user.accountType === 'systemAdmin'
        || result.user.memberships.some((membership) => membership.isAdmin)
      await router.replace(hasAdminAccess ? '/dashboard' : '/reviere/karte')
    }
    return result.message ?? ''
  })
}

function submitRegistration() {
  return submit(async () => {
    const payload: Record<string, string> = {
      username: registration.value.username,
      displayName: registration.value.displayName,
      email: registration.value.email,
    }
    if (registration.value.revierId) payload.revierId = registration.value.revierId
    if (registration.value.invitationToken) payload.invitationToken = registration.value.invitationToken
    await request('/auth/register', payload)
    registrationSubmitted.value = true
    return ''
  })
}

function submitForgotPassword() {
  return submit(async () => (await request('/auth/password/forgot', { email: forgotEmail.value })).message ?? '')
}

function submitResetPassword() {
  return submit(async () => {
    if (!initialToken) {
      throw new Error('Der Passwort-Link ist unvollstaendig.')
    }
    const result = await request('/auth/password/reset', { token: initialToken, password: resetPassword.value })
    view.value = 'login'
    window.history.replaceState({}, '', window.location.pathname)
    return result.message ?? ''
  })
}
</script>

<template>
  <IonPage>
    <IonHeader>
      <IonToolbar>
        <IonTitle>Jagdgruppe</IonTitle>
      </IonToolbar>
    </IonHeader>
    <IonContent class="ion-padding">
      <IonSegment v-if="showNavigation" :value="view" @ion-change="view = $event.detail.value as View">
        <IonSegmentButton value="login">Anmelden</IonSegmentButton>
        <IonSegmentButton value="register">Registrieren</IonSegmentButton>
      </IonSegment>

      <IonList v-if="view === 'login'">
        <IonItem>
          <IonInput v-model="login.identifier" label="Benutzername oder E-Mail" label-placement="stacked" autocomplete="username" />
        </IonItem>
        <IonItem>
          <IonInput v-model="login.password" type="password" label="Passwort" label-placement="stacked" autocomplete="current-password" />
        </IonItem>
        <IonButton expand="block" :disabled="isSubmitting" @click="submitLogin">Anmelden</IonButton>
        <IonButton fill="clear" expand="block" @click="view = 'forgot'">Passwort vergessen</IonButton>
      </IonList>

      <IonCard v-else-if="view === 'register' && registrationSubmitted" class="registration-success">
        <IonCardHeader>
          <IonCardTitle>Bitte prüfe dein Postfach</IonCardTitle>
        </IonCardHeader>
        <IonCardContent>
          <p>Nach der Freigabe erhältst du eine E-Mail von der Jagd-App.</p>
          <p>Öffne den Link in dieser E-Mail, um dein Passwort festzulegen. Prüfe bitte auch deinen Spam-Ordner.</p>
          <IonButton expand="block" fill="outline" @click="view = 'login'">Zur Anmeldung</IonButton>
        </IonCardContent>
      </IonCard>

      <IonList v-else-if="view === 'register'">
        <IonItem><IonInput v-model="registration.displayName" label="Name" label-placement="stacked" autocomplete="name" /></IonItem>
        <IonItem><IonInput v-model="registration.username" label="Benutzername" label-placement="stacked" autocomplete="username" /></IonItem>
        <IonItem><IonInput v-model="registration.email" type="email" label="E-Mail-Adresse" label-placement="stacked" autocomplete="email" /></IonItem>
        <IonItem v-if="invitedRevierName">
          <IonNote>Einladung für {{ invitedRevierName }}</IonNote>
        </IonItem>
        <IonItem v-else>
          <IonSelect v-model="registration.revierId" label="Revier" label-placement="stacked" interface="popover" placeholder="Kein Revier ausgewählt">
            <IonSelectOption value="">Kein Revier / Systemanfrage</IonSelectOption>
            <IonSelectOption v-for="revier in publicReviere" :key="revier.id" :value="revier.id">
              {{ revier.name }} · Gemeinde {{ revier.municipalityName }}
            </IonSelectOption>
          </IonSelect>
        </IonItem>
        <IonButton expand="block" :disabled="isSubmitting" @click="submitRegistration">Registrierung senden</IonButton>
      </IonList>

      <IonList v-else-if="view === 'forgot'">
        <IonItem><IonInput v-model="forgotEmail" type="email" label="E-Mail-Adresse" label-placement="stacked" autocomplete="email" /></IonItem>
        <IonButton expand="block" :disabled="isSubmitting" @click="submitForgotPassword">Passwort-Link senden</IonButton>
        <IonButton fill="clear" expand="block" @click="view = 'login'">Zurueck zur Anmeldung</IonButton>
      </IonList>

      <IonList v-else>
        <IonItem><IonInput v-model="resetPassword" type="password" :minlength="12" label="Neues Passwort" label-placement="stacked" helper-text="Mindestens 12 Zeichen" autocomplete="new-password" /></IonItem>
        <IonButton expand="block" :disabled="isSubmitting" @click="submitResetPassword">Passwort setzen</IonButton>
      </IonList>

      <IonNote v-if="message" class="ion-padding-top">{{ message }}</IonNote>
    </IonContent>
  </IonPage>
</template>
