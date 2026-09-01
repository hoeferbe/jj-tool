<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  IonAccordion,
  IonAccordionGroup,
  IonBadge,
  IonButton,
  IonCheckbox,
  IonItem,
  IonLabel,
  IonList,
  IonNote,
} from '@ionic/vue'
import AppLayout from '../components/AppLayout.vue'

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8787'

/** Mirror of the server-side UserRole type for type-safe template bindings. */
type UserRole = 'admin' | 'paechter' | 'bgs' | 'guest'
/** Mirror of the server-side UserPosition type. */
type UserPosition = 'revierleiter' | 'kassenwart' | 'schriftfuehrer'

/** User record returned by GET /admin/users (passwordHash is never included). */
interface User {
  id: string
  username: string
  email: string
  displayName: string
  role: UserRole
  status: 'active' | 'pending'
  position?: UserPosition
  /** True when the user has admin-dashboard access without having role='admin'. */
  isAdmin?: boolean
  lastLoginAt?: string
  createdAt: string
  /** Derived server-side from active sessions; not persisted in auth.json. */
  isOnline: boolean
}

/** Human-readable role labels for badges and select options. */
const ROLE_LABELS: Record<string, string> = {
  guest: 'Gast',
  paechter: 'Pächter',
  bgs: 'BGS',
  admin: 'Admin',
}

/** Ionic colour names for role badges (must match the theme palette). */
const ROLE_COLORS: Record<string, string> = {
  admin: 'primary',
  paechter: 'secondary',
  bgs: 'tertiary',
  guest: 'warning',
}

/** Human-readable position labels. */
const POSITION_LABELS: Record<string, string> = {
  revierleiter: 'Revierleiter',
  kassenwart: 'Kassenwart',
  schriftfuehrer: 'Schriftführer',
}

const users = ref<User[]>([])
const errorMessage = ref('')
/** Tracks which user is currently being approved to disable the button during the request. */
const approvingId = ref<string | null>(null)
/** Per-user role/position/isAdmin selections for the approval form. Keyed by user ID. */
const approvalData = ref<Record<string, { role: string; position: string; isAdmin: boolean }>>({})

const pendingUsers = computed(() => users.value.filter((u) => u.status === 'pending'))
const activeUsers = computed(() => users.value.filter((u) => u.status === 'active'))

/**
 * Fetches the current user list from the API and updates reactive state.
 * Also initialises approvalData entries for any new pending users.
 * cache: 'no-store' prevents the browser from returning stale data.
 */
async function loadUsers() {
  const token = localStorage.getItem('accessToken')
  try {
    const response = await fetch(`${apiUrl}/admin/users`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
    if (!response.ok) {
      errorMessage.value = 'Benutzer konnten nicht geladen werden.'
      return
    }
    const data = (await response.json()) as { users: User[] }
    users.value = data.users
    // Seed approvalData for every pending user that doesn't have an entry yet.
    for (const user of data.users.filter((u) => u.status === 'pending')) {
      if (!approvalData.value[user.id]) {
        approvalData.value[user.id] = { role: 'paechter', position: '', isAdmin: false }
      }
    }
  } catch {
    errorMessage.value = 'API-Server nicht erreichbar. Bitte Server starten und erneut versuchen.'
  }
}

/**
 * Approves a pending registration using the role/position/isAdmin chosen in the form.
 * On success the server sends the password-setup e-mail to the user.
 */
async function approveUser(userId: string) {
  approvingId.value = userId
  const token = localStorage.getItem('accessToken')
  const ad = approvalData.value[userId] ?? { role: 'paechter', position: '', isAdmin: false }
  // Only include position and isAdmin in the payload when they are set.
  const body: Record<string, string | boolean> = { role: ad.role }
  if (ad.position) body.position = ad.position
  if (ad.isAdmin) body.isAdmin = true
  const response = await fetch(`${apiUrl}/admin/users/${userId}/approve`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  approvingId.value = null
  if (response.ok) {
    await loadUsers()
  } else {
    const data = (await response.json()) as { message?: string }
    errorMessage.value = data.message ?? 'Freigabe fehlgeschlagen.'
  }
}

/**
 * Permanently removes a pending registration (reject).
 * This cannot be undone; the user would need to re-register.
 */
async function rejectUser(userId: string) {
  const token = localStorage.getItem('accessToken')
  const response = await fetch(`${apiUrl}/admin/users/${userId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
  if (response.ok) {
    await loadUsers()
  } else {
    const data = (await response.json()) as { message?: string }
    errorMessage.value = data.message ?? 'Ablehnung fehlgeschlagen.'
  }
}

/**
 * Updates an existing member's role, position, and/or isAdmin flag via PATCH.
 * Only fields that are explicitly set are sent in the request body.
 * @param isAdmin - Pass `undefined` to leave the existing value unchanged.
 */
async function updateUserRoleAndPosition(userId: string, role: string, position: string, isAdmin?: boolean) {
  const token = localStorage.getItem('accessToken')
  const body: Record<string, string | boolean> = { role }
  if (position) body.position = position
  // Only send isAdmin when the caller explicitly passes a value.
  if (isAdmin !== undefined) body.isAdmin = isAdmin
  const response = await fetch(`${apiUrl}/admin/users/${userId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (response.ok) {
    await loadUsers()
  } else {
    const data = (await response.json()) as { message?: string }
    errorMessage.value = data.message ?? 'Aktualisierung fehlgeschlagen.'
  }
}

/** Handles native <select> change for the role field; preserves the current position. */
function onUserRoleChange(userId: string, position: string | undefined, e: Event) {
  const role = (e.target as HTMLSelectElement).value
  updateUserRoleAndPosition(userId, role, position ?? '')
}

/** Handles native <select> change for the position field; preserves the current role. */
function onUserPositionChange(userId: string, role: string, e: Event) {
  updateUserRoleAndPosition(userId, role, (e.target as HTMLSelectElement).value)
}

/** Handles the IonCheckbox change event for the admin-rights toggle. */
function onAdminFlagChange(userId: string, role: string, position: string | undefined, e: Event) {
  const isAdmin = (e as CustomEvent<{ checked: boolean }>).detail.checked
  updateUserRoleAndPosition(userId, role, position ?? '', isAdmin)
}

/** Formats an ISO timestamp for display in German locale; returns 'Noch nie' if absent. */
function formatDate(iso?: string) {
  if (!iso) return 'Noch nie'
  return new Date(iso).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })
}

onMounted(loadUsers)
</script>

<template>
  <AppLayout>
    <div class="ion-padding-horizontal ion-padding-top">
      <IonButton fill="outline" size="small" @click="loadUsers">Aktualisieren</IonButton>
    </div>
    <p v-if="errorMessage" class="ion-padding" style="color: var(--ion-color-danger)">{{ errorMessage }}</p>
    <IonAccordionGroup :multiple="true" :value="['pending', 'members']">

      <IonAccordion value="pending">
        <IonItem slot="header" color="light">
          <IonLabel>Ausstehende Registrierungen</IonLabel>
          <IonBadge v-if="pendingUsers.length" slot="end" color="warning">{{ pendingUsers.length }}</IonBadge>
        </IonItem>
        <IonList slot="content">
          <IonItem v-if="!pendingUsers.length">
            <IonLabel><IonNote>Keine ausstehenden Registrierungen.</IonNote></IonLabel>
          </IonItem>
          <IonItem v-for="user in pendingUsers" :key="user.id">
            <IonLabel>
              <h3>{{ user.displayName }}</h3>
              <p>{{ user.username }} · {{ user.email }}</p>
              <p>Registriert: {{ formatDate(user.createdAt) }}</p>
              <div v-if="approvalData[user.id]" class="controls-row">
                <div class="field-group">
                  <span class="field-label">Rolle</span>
                  <select v-model="approvalData[user.id].role" class="native-select">
                    <option value="guest">Gast</option>
                    <option value="paechter">Pächter</option>
                    <option value="bgs">BGS</option>
                  </select>
                </div>
                <div class="field-group">
                  <span class="field-label">Funktion</span>
                  <select v-model="approvalData[user.id].position" class="native-select">
                    <option value="">Keine</option>
                    <option value="revierleiter">Revierleiter</option>
                    <option value="kassenwart">Kassenwart</option>
                    <option value="schriftfuehrer">Schriftführer</option>
                  </select>
                </div>
                <IonCheckbox
                  v-model="approvalData[user.id].isAdmin"
                  :disabled="approvalData[user.id].role === 'guest'"
                  class="admin-checkbox"
                >Admin-Rechte</IonCheckbox>
              </div>
            </IonLabel>
            <div slot="end" class="action-buttons">
              <IonButton size="small" :disabled="approvingId === user.id" @click="approveUser(user.id)">Freigeben</IonButton>
              <IonButton size="small" color="danger" fill="outline" @click="rejectUser(user.id)">Ablehnen</IonButton>
            </div>
          </IonItem>
        </IonList>
      </IonAccordion>

      <IonAccordion value="members">
        <IonItem slot="header" color="light">
          <IonLabel>Mitglieder</IonLabel>
          <IonBadge v-if="activeUsers.length" slot="end">{{ activeUsers.length }}</IonBadge>
        </IonItem>
        <IonList slot="content">
          <IonItem v-if="!activeUsers.length">
            <IonLabel><IonNote>Keine aktiven Mitglieder.</IonNote></IonLabel>
          </IonItem>
          <IonItem v-for="user in activeUsers" :key="user.id">
            <span
              slot="start"
              :style="{
                display: 'inline-block',
                width: '10px',
                height: '10px',
                borderRadius: '50%',
                flexShrink: 0,
                alignSelf: 'center',
                boxSizing: 'border-box',
                backgroundColor: user.isOnline ? 'var(--ion-color-success)' : 'transparent',
                border: user.isOnline ? 'none' : '2px solid var(--ion-color-medium)',
              }"
            ></span>
            <IonLabel>
              <div class="member-row">
                <div class="member-info">
                  <h3>{{ user.displayName }}</h3>
                  <p>
                    <IonBadge :color="ROLE_COLORS[user.role]">{{ ROLE_LABELS[user.role] }}</IonBadge>
                    <IonBadge v-if="user.isAdmin" color="danger" style="margin-left: 4px">Admin</IonBadge>
                    <span v-if="user.position"> · {{ POSITION_LABELS[user.position] ?? user.position }}</span>
                  </p>
                  <p>{{ user.username }} · {{ user.email }}</p>
                  <p>Zuletzt aktiv: {{ formatDate(user.lastLoginAt) }}</p>
                </div>
                <div v-if="user.role !== 'admin'" class="member-controls">
                  <div class="field-group">
                    <span class="field-label">Rolle</span>
                    <select class="native-select" :value="user.role" @change="onUserRoleChange(user.id, user.position, $event)">
                      <option value="guest">Gast</option>
                      <option value="paechter">Pächter</option>
                      <option value="bgs">BGS</option>
                    </select>
                  </div>
                  <div class="field-group">
                    <span class="field-label">Funktion</span>
                    <select class="native-select" :value="user.position ?? ''" @change="onUserPositionChange(user.id, user.role, $event)">
                      <option value="">Keine</option>
                      <option value="revierleiter">Revierleiter</option>
                      <option value="kassenwart">Kassenwart</option>
                      <option value="schriftfuehrer">Schriftführer</option>
                    </select>
                  </div>
                  <div v-if="user.role !== 'guest'" class="field-group">
                    <IonCheckbox :checked="user.isAdmin ?? false" class="admin-checkbox" @ion-change="onAdminFlagChange(user.id, user.role, user.position, $event)">Admin-Rechte</IonCheckbox>
                  </div>
                </div>
              </div>
            </IonLabel>
          </IonItem>
        </IonList>
      </IonAccordion>

    </IonAccordionGroup>
  </AppLayout>
</template>

<style scoped>
/* Member item: info and controls side by side, no gap on wide screens */
.member-row {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  flex-wrap: wrap;
  padding-block: 4px;
}
.member-info { flex: 1; min-width: 180px; }
.member-controls {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-top: 2px;
}

/* Inline label + select */
.field-group {
  display: flex;
  align-items: center;
  gap: 6px;
}
.field-label {
  font-size: 0.78em;
  color: var(--ion-color-medium-shade);
  min-width: 48px;
  text-align: right;
}
.native-select {
  border: 1px solid var(--ion-color-medium);
  border-radius: 4px;
  padding: 2px 22px 2px 6px;
  font-size: 0.85em;
  background-color: var(--ion-background-color, #f8f8f2);
  color: var(--ion-color-dark, #222);
  -webkit-appearance: none;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%23666'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 5px center;
  cursor: pointer;
  min-width: 85px;
  max-width: 130px;
  line-height: 1.4;
}
.native-select:focus {
  outline: none;
  border-color: var(--ion-color-primary);
}

/* Approval controls (pending users) */
.controls-row {
  display: flex;
  gap: 8px;
  margin-top: 6px;
  flex-wrap: wrap;
  align-items: center;
}
.admin-checkbox { font-size: 0.85em; }

.action-buttons {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-self: flex-start;
  padding-top: 4px;
}
</style>
