<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { IonBadge, IonButton, IonItem, IonList, IonNote, IonSelect, IonSelectOption } from '@ionic/vue'
import AppLayout from '../components/AppLayout.vue'
import SatelliteThumbnail from '../components/SatelliteThumbnail.vue'
import StreckeneintragDialog, { type Streckeneintrag } from '../components/StreckeneintragDialog.vue'
import StreckeneintragDetailDialog from '../components/StreckeneintragDetailDialog.vue'
import { useNews } from '../composables/useNews'

interface GeoJsonFeatureCollection {
  type: 'FeatureCollection'
  features: Array<{
    type: 'Feature'
    properties?: Record<string, unknown>
    geometry: { type: string; coordinates: unknown }
  }>
}

interface Revier {
  id: string
  name: string
  municipalityName: string
  center?: { lat: number; lng: number }
  boundary?: GeoJsonFeatureCollection
}

interface CurrentUser {
  id: string
  accountType: 'systemAdmin' | 'member'
  memberships: Array<{ revierId: string; status: 'active' | 'pending'; isAdmin: boolean }>
}

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8787'
const reviere = ref<Revier[]>([])
const entries = ref<Streckeneintrag[]>([])
const selectedRevierId = ref(localStorage.getItem('jj-member-selected-revier') ?? '')
const loading = ref(true)
const errorMessage = ref('')
const successMessage = ref('')
const currentUser = ref<CurrentUser | null>(null)

const isDialogOpen = ref(false)
const isDetailOpen = ref(false)
const editingEntry = ref<Streckeneintrag | null>(null)
const selectedEntryForDetail = ref<Streckeneintrag | null>(null)
const deletingId = ref<string | null>(null)
const { getSectionSeenAt, markSectionSeen } = useNews()
const newSince = getSectionSeenAt('strecke')

const selectedRevier = computed(() => reviere.value.find((revier) => revier.id === selectedRevierId.value) ?? null)
const canAdministerSelectedRevier = computed(() => currentUser.value?.accountType === 'systemAdmin'
  || currentUser.value?.memberships.some((membership) =>
    membership.revierId === selectedRevierId.value && membership.status === 'active' && membership.isAdmin,
  ) === true)
const isNewEntry = (entry: Streckeneintrag) => entry.createdBy !== currentUser.value?.id && entry.createdAt > newSince

/** Whether the current user may edit/delete a kill entry: creator or Revier-/Systemadmin. */
function canModifyEntry(entry: Streckeneintrag) {
  return entry.createdBy === currentUser.value?.id || canAdministerSelectedRevier.value
}

function formatDateTime(datum: string, uhrzeit?: string) {
  if (!datum) return ''
  const dateFormatted = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' }).format(new Date(`${datum}T12:00:00`))
  if (uhrzeit) {
    return `${dateFormatted}, ${uhrzeit} Uhr`
  }
  return dateFormatted
}

function formatGewicht(gewicht?: number) {
  if (gewicht === undefined || gewicht === null) return ''
  return new Intl.NumberFormat('de-DE', { minimumFractionDigits: 0, maximumFractionDigits: 1 }).format(gewicht) + ' kg'
}

function utilizationLabel(value: NonNullable<Streckeneintrag['verwertung']>) {
  return {
    eigenverwertung: 'Eigenverwertung',
    verkauf_gemeinde: 'Verkauf innerhalb Gemeinde',
    verkauf_ausserhalb_gemeinde: 'Verkauf außerhalb Gemeinde',
    jagdgemeinschaft_verkauf: 'Jagdgemeinschaft übernimmt Verkauf',
    keine_verwertung: 'Keine Verwertung',
  }[value]
}

/** Sorts kill entries by date, time, then creation time, newest first. */
function sortEntries(list: Streckeneintrag[]) {
  return [...list].sort((first, second) =>
    second.datum.localeCompare(first.datum)
    || (second.uhrzeit ?? '').localeCompare(first.uhrzeit ?? '')
    || second.createdAt.localeCompare(first.createdAt),
  )
}

/** Loads and sorts the kill entries of the selected Revier. */
async function loadEntries() {
  if (!selectedRevierId.value) return
  loading.value = true
  errorMessage.value = ''
  const token = localStorage.getItem('accessToken')
  try {
    const response = await fetch(`${apiUrl}/reviere/${selectedRevierId.value}/streckeneintraege`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
    const data = await response.json() as { streckeneintraege?: Streckeneintrag[]; message?: string }
    if (!response.ok) throw new Error(data.message ?? 'Streckeneinträge konnten nicht geladen werden.')
    entries.value = sortEntries(data.streckeneintraege ?? [])
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Streckeneinträge konnten nicht geladen werden.'
  } finally {
    loading.value = false
  }
}

/** Loads the user's Reviere and profile, then falls back to the first Revier if none is selected yet. */
async function loadReviere() {
  const token = localStorage.getItem('accessToken')
  try {
    const headers = { Authorization: `Bearer ${token}` }
    const [response, userResponse] = await Promise.all([
      fetch(`${apiUrl}/reviere`, { headers }),
      fetch(`${apiUrl}/auth/me`, { headers, cache: 'no-store' }),
    ])
    const data = await response.json() as { reviere?: Revier[]; message?: string }
    if (!response.ok) throw new Error(data.message ?? 'Reviere konnten nicht geladen werden.')
    if (userResponse.ok) currentUser.value = ((await userResponse.json()) as { user: CurrentUser }).user
    reviere.value = data.reviere ?? []
    if (!reviere.value.some((revier) => revier.id === selectedRevierId.value)) {
      selectedRevierId.value = reviere.value[0]?.id ?? ''
      if (selectedRevierId.value) localStorage.setItem('jj-member-selected-revier', selectedRevierId.value)
      else localStorage.removeItem('jj-member-selected-revier')
    }
    await loadEntries()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Reviere konnten nicht geladen werden.'
    loading.value = false
  }
}

/** Switches the active Revier, persists the choice, and reloads its entries. */
async function selectRevier(revierId: string) {
  selectedRevierId.value = revierId
  localStorage.setItem('jj-member-selected-revier', revierId)
  await loadEntries()
}

function openNewEntryDialog() {
  editingEntry.value = null
  isDialogOpen.value = true
}

function openEditEntryDialog(entry: Streckeneintrag) {
  editingEntry.value = entry
  isDialogOpen.value = true
}

function openDetail(entry: Streckeneintrag) {
  selectedEntryForDetail.value = entry
  isDetailOpen.value = true
}

function handleEditFromDetail(entry: Streckeneintrag) {
  isDetailOpen.value = false
  openEditEntryDialog(entry)
}

function handleDeleteFromDetail(entry: Streckeneintrag) {
  isDetailOpen.value = false
  deleteEntry(entry)
}

/** Merges a created/updated entry into the list (replacing it if it already exists) and re-sorts. */
function handleDialogSaved(savedEntry: Streckeneintrag) {
  const index = entries.value.findIndex((e) => e.id === savedEntry.id)
  if (index !== -1) {
    entries.value[index] = savedEntry
  } else {
    entries.value.push(savedEntry)
  }
  entries.value = sortEntries(entries.value)
  if (selectedEntryForDetail.value?.id === savedEntry.id) {
    selectedEntryForDetail.value = savedEntry
  }
  successMessage.value = editingEntry.value ? 'Streckeneintrag aktualisiert.' : 'Streckeneintrag gespeichert.'
  setTimeout(() => { successMessage.value = '' }, 4000)
}

/** Deletes a kill entry after confirmation and closes its detail view if open. */
async function deleteEntry(entry: Streckeneintrag) {
  if (!confirm(`Streckeneintrag (${entry.wildart}, ${entry.datum}) wirklich löschen?`)) return
  deletingId.value = entry.id
  errorMessage.value = ''
  const token = localStorage.getItem('accessToken')
  try {
    const response = await fetch(`${apiUrl}/reviere/${selectedRevierId.value}/streckeneintraege/${entry.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    const data = await response.json() as { message?: string }
    if (!response.ok) throw new Error(data.message ?? 'Eintrag konnte nicht gelöscht werden.')
    entries.value = entries.value.filter((e) => e.id !== entry.id)
    if (selectedEntryForDetail.value?.id === entry.id) {
      isDetailOpen.value = false
      selectedEntryForDetail.value = null
    }
    successMessage.value = 'Streckeneintrag gelöscht.'
    setTimeout(() => { successMessage.value = '' }, 4000)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Eintrag konnte nicht gelöscht werden.'
  } finally {
    deletingId.value = null
  }
}

onMounted(async () => {
  await loadReviere()
  await markSectionSeen('strecke')
})
</script>

<template>
  <AppLayout>
    <div class="page-content">
      <div class="page-heading">
        <div>
          <h1>Streckeneinträge</h1>
          <p v-if="selectedRevier">{{ selectedRevier.name }} · {{ selectedRevier.municipalityName }}</p>
        </div>
        <div class="heading-actions">
          <IonSelect v-if="reviere.length > 1" :value="selectedRevierId" label="Revier" label-placement="stacked" interface="popover" @ion-change="selectRevier($event.detail.value)">
            <IonSelectOption v-for="revier in reviere" :key="revier.id" :value="revier.id">{{ revier.name }}</IonSelectOption>
          </IonSelect>
          <IonButton :disabled="!selectedRevierId" @click="openNewEntryDialog">
            ➕ Neuer Streckeneintrag
          </IonButton>
        </div>
      </div>

      <IonNote v-if="successMessage" color="success" class="status-note">{{ successMessage }}</IonNote>
      <p v-if="errorMessage" class="error-message">{{ errorMessage }}</p>

      <IonNote v-if="loading">Streckeneinträge werden geladen...</IonNote>
      <IonNote v-else-if="!entries.length">Noch keine Streckeneinträge vorhanden.</IonNote>

      <IonList v-else class="entry-list" lines="full">
        <IonItem v-for="entry in entries" :key="entry.id" class="entry-item" button @click="openDetail(entry)">
          <div class="entry-layout">
            <div class="entry-content">
              <div class="entry-header">
                <div class="header-main">
                  <h2 class="wildart-title">
                    {{ entry.wildart }}
                    <span v-if="entry.unterart" class="unterart-text">({{ entry.unterart }})</span>
                    <IonBadge v-if="isNewEntry(entry)" color="tertiary" class="new-badge">Neu</IonBadge>
                  </h2>
                  <div class="badge-row">
                    <span v-if="entry.geschlecht === 'maennlich'" class="badge badge-male" title="Männlich">♂ M</span>
                    <span v-else-if="entry.geschlecht === 'weiblich'" class="badge badge-female" title="Weiblich">♀ W</span>
                    <template v-if="entry.istVerkehrsopfer">
                      <span class="badge badge-warning" title="Verkehrsopfer">🚗 VO</span>
                      <span v-if="entry.bescheinigung !== false" class="badge badge-info" title="Versicherungsbescheinigung ausgestellt">📜 Bescheinigung</span>
                      <span v-else class="badge badge-neutral" title="Keine Versicherungsbescheinigung ausgestellt">Ohne Bescheinigung</span>
                    </template>
                    <span v-if="entry.kostenfreiArt === 'hegeabschuss'" class="badge badge-neutral" title="Hegeabschuss">Hegeabschuss</span>
                  </div>
                </div>
                <span class="entry-date">{{ formatDateTime(entry.datum, entry.uhrzeit) }}</span>
              </div>

              <div class="entry-details">
                <span class="detail-pill">Erfasst von {{ entry.createdByName ?? 'Unbekanntes Mitglied' }}</span>
                <span v-if="entry.verwertung" class="detail-pill">Verwertung: {{ utilizationLabel(entry.verwertung) }}</span>
                <span v-else class="detail-pill">Verwertung: Nicht erfasst</span>
                <span v-if="entry.kostenfreiArt === 'hegeabschuss'" class="detail-pill">Kostenfrei: Hegeabschuss</span>
                <span v-if="entry.gewicht" class="detail-pill">⚖️ {{ formatGewicht(entry.gewicht) }}</span>
                <span v-if="entry.geschaetztesAlter" class="detail-pill">⏳ Alter: {{ entry.geschaetztesAlter }}</span>
                <span v-if="entry.ortName" class="detail-pill">📍 {{ entry.ortName }}</span>
                <span v-else-if="entry.position" class="detail-pill">📍 {{ entry.position.lat.toFixed(4) }}, {{ entry.position.lng.toFixed(4) }}</span>
              </div>

              <p v-if="entry.notiz" class="entry-notes">{{ entry.notiz }}</p>

              <div v-if="canModifyEntry(entry)" class="entry-actions">
                <button type="button" class="action-btn" @click.stop="openEditEntryDialog(entry)">✏️ Bearbeiten</button>
                <button type="button" class="action-btn danger" :disabled="deletingId === entry.id" @click.stop="deleteEntry(entry)">
                  {{ deletingId === entry.id ? 'Lösche...' : '🗑️ Löschen' }}
                </button>
              </div>
            </div>

            <SatelliteThumbnail v-if="entry.position" :position="entry.position" :label="`Satellitenbild des Abschussorts von ${entry.wildart}`" />
          </div>
        </IonItem>
      </IonList>

      <!-- Edit / Create Dialog -->
      <StreckeneintragDialog
        :is-open="isDialogOpen"
        :revier-id="selectedRevierId"
        :revier-center="selectedRevier?.center"
        :revier-boundary="selectedRevier?.boundary"
        :entry="editingEntry"
        @close="isDialogOpen = false"
        @saved="handleDialogSaved"
      />

      <!-- Detail View Dialog -->
      <StreckeneintragDetailDialog
        :is-open="isDetailOpen"
        :entry="selectedEntryForDetail"
        :revier-name="selectedRevier ? `${selectedRevier.name} · ${selectedRevier.municipalityName}` : undefined"
        :revier-boundary="selectedRevier?.boundary"
        :can-modify="selectedEntryForDetail ? canModifyEntry(selectedEntryForDetail) : false"
        @close="isDetailOpen = false"
        @edit="handleEditFromDetail"
        @delete="handleDeleteFromDetail"
      />
    </div>
  </AppLayout>
</template>

<style scoped>
.page-content { padding: 20px; max-width: 900px; margin: 0 auto; }
.page-heading { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 24px; flex-wrap: wrap; }
.page-heading h1 { margin: 0 0 4px; font-size: 1.75rem; font-weight: 700; }
.page-heading p { margin: 0; color: var(--ion-color-medium, #666); }
.heading-actions { display: flex; align-items: center; gap: 12px; }
.status-note { display: block; margin-bottom: 16px; font-weight: 500; }
.error-message { color: var(--ion-color-danger, #eb445a); margin-bottom: 16px; }

.entry-list { border-radius: 8px; overflow: hidden; background: transparent; }
.entry-item { --padding-start: 16px; --padding-end: 16px; --inner-padding-top: 14px; --inner-padding-bottom: 14px; cursor: pointer; }

.entry-layout { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.entry-content { flex: 1; display: flex; flex-direction: column; gap: 8px; min-width: 0; }

.entry-header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap; }
.header-main { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.wildart-title { margin: 0; font-size: 1.15rem; font-weight: 600; color: var(--ion-text-color, #111); }
.unterart-text { font-size: 0.95rem; font-weight: 500; color: var(--ion-color-primary, #3880ff); }
.entry-date { font-size: 0.9rem; font-weight: 500; color: var(--ion-color-medium, #666); white-space: nowrap; }

.badge-row { display: flex; gap: 6px; flex-wrap: wrap; }
.badge { font-size: 0.75rem; font-weight: 600; padding: 2px 8px; border-radius: 12px; }
.badge-male { background: #e3f2fd; color: #1565c0; border: 1px solid #bbdefb; }
.badge-female { background: #fce4ec; color: #c2185b; border: 1px solid #f8bbd0; }
.badge-warning { background: #fff3cd; color: #856404; border: 1px solid #ffeeba; }
.badge-info { background: #d1ecf1; color: #0c5460; border: 1px solid #bee5eb; }
.badge-neutral { background: #f5f5f5; color: #616161; border: 1px solid #e0e0e0; }
.new-badge { margin-left: 8px; vertical-align: middle; font-size: 0.65rem; }

.entry-details { display: flex; flex-wrap: wrap; gap: 8px; }
.detail-pill { font-size: 0.82rem; background: var(--ion-color-light, #f4f5f8); border: 1px solid var(--ion-color-light-shade, #e0e0e0); padding: 2px 8px; border-radius: 4px; color: var(--ion-text-color, #333); }

.entry-notes { margin: 2px 0 0; font-size: 0.9rem; color: var(--ion-color-dark-tint, #444); background: var(--ion-color-light, #f8f9fa); padding: 8px 12px; border-radius: 6px; border-left: 3px solid var(--ion-color-medium-tint, #ccc); }

.entry-actions { display: flex; gap: 12px; margin-top: 4px; }
.action-btn { background: none; border: none; padding: 4px 0; font-size: 0.85rem; color: var(--ion-color-primary, #3880ff); cursor: pointer; font-weight: 500; }
.action-btn:hover { text-decoration: underline; }
.action-btn.danger { color: var(--ion-color-danger, #eb445a); }

@media (max-width: 600px) {
  .page-heading { flex-direction: column; align-items: stretch; gap: 12px; }
  .heading-actions { flex-direction: column; align-items: stretch; }
  .entry-header { flex-direction: column; align-items: flex-start; gap: 4px; }
  :deep(.satellite-thumbnail) { width: 92px; }
}
</style>
