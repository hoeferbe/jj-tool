<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  IonApp,
  IonButton,
  IonContent,
  IonHeader,
  IonInput,
  IonItem,
  IonList,
  IonNote,
  IonSegment,
  IonSegmentButton,
  IonTitle,
  IonToolbar,
} from '@ionic/vue'

type View = 'login' | 'register' | 'forgot' | 'reset'

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8787'
const initialToken = new URLSearchParams(window.location.search).get('set-password')
const view = ref<View>(initialToken ? 'reset' : 'login')
const message = ref('')
const isSubmitting = ref(false)
const login = ref({ identifier: '', password: '' })
const registration = ref({ username: '', displayName: '', email: '' })
const forgotEmail = ref('')
const resetPassword = ref('')

const showNavigation = computed(() => view.value !== 'reset')

async function request(path: string, body: Record<string, string>) {
  const response = await fetch(`${apiUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const result = (await response.json()) as { message?: string; accessToken?: string }
  if (!response.ok) {
    throw new Error(result.message ?? 'Die Anfrage konnte nicht verarbeitet werden.')
  }
  return result
}

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
    if (result.accessToken) {
      sessionStorage.setItem('accessToken', result.accessToken)
      return 'Anmeldung erfolgreich.'
    }
    return result.message ?? ''
  })
}

function submitRegistration() {
  return submit(async () => (await request('/auth/register', registration.value)).message ?? '')
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
  <IonApp>
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

      <IonList v-else-if="view === 'register'">
        <IonItem><IonInput v-model="registration.displayName" label="Name" label-placement="stacked" autocomplete="name" /></IonItem>
        <IonItem><IonInput v-model="registration.username" label="Benutzername" label-placement="stacked" autocomplete="username" /></IonItem>
        <IonItem><IonInput v-model="registration.email" type="email" label="E-Mail-Adresse" label-placement="stacked" autocomplete="email" /></IonItem>
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
  </IonApp>
</template>