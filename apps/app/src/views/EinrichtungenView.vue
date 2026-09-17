<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import { IonBadge, IonButton, IonItem, IonLabel, IonList, IonNote, IonSelect, IonSelectOption } from '@ionic/vue'
import AppLayout from '../components/AppLayout.vue'
import NewJagdeinrichtungDialog from '../components/NewJagdeinrichtungDialog.vue'
import SatelliteThumbnail from '../components/SatelliteThumbnail.vue'

interface Revier { id: string; name: string; municipalityName: string; center: { lat: number; lng: number } }
interface Member { id: string; displayName: string }
type FacilityType = 'Kanzel' | 'Bock' | 'Leiter' | 'Roehrenfalle' | 'Kirrung'
type FacilityStatus = 'aktiv' | 'defekt' | 'ausser Betrieb'
interface Facility { id: string; revierId: string; name: string; typ: FacilityType; status: FacilityStatus; position: { lat: number; lng: number }; zustandsInfo?: string; notiz?: string; createdBy: string; createdAt: string; updatedAt: string }
interface Task { id: string; jagdeinrichtungId: string; titel: string; beschreibung?: string; status: 'offen' | 'in Bearbeitung' | 'erledigt'; assignedTo?: string; assignedBy: string }
interface Reservation { id: string; jagdeinrichtungId: string; reservedBy: string; reservedByName?: string; reservedAt: string; startAt?: string; endAt?: string; checkedInBy?: string; checkedInByName?: string; checkedInAt?: string; checkedOutAt?: string }

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8787'
const router = useRouter()
const reviere = ref<Revier[]>([])
const members = ref<Member[]>([])
const facilities = ref<Facility[]>([])
const tasks = ref<Task[]>([])
const reservations = ref<Reservation[]>([])
const selectedRevierId = ref(localStorage.getItem('jj-member-selected-revier') ?? '')
const loading = ref(true)
const errorMessage = ref('')
const taskFacility = ref<Facility | null>(null)
const taskTitle = ref('')
const taskDescription = ref('')
const taskAssignee = ref('')
const taskSaving = ref(false)
const facilityDialogOpen = ref(false)
const selectedFacility = ref<Facility | null>(null)

type FacilitySortOption = 'name' | 'createdAt' | 'updatedAt'
const facilitySortStorageKey = 'jj-einrichtungen-sort'
const sortOption = ref<FacilitySortOption>((localStorage.getItem(facilitySortStorageKey) as FacilitySortOption | null) ?? 'name')

/** Persists the chosen sort order for the facility list across visits. */
function changeSortOption(option: FacilitySortOption) {
  sortOption.value = option
  localStorage.setItem(facilitySortStorageKey, option)
}

/** Sorts facilities by name (A-Z), newest created first, or last modified first. */
const sortedFacilities = computed(() => {
  const list = [...facilities.value]
  if (sortOption.value === 'createdAt') return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  if (sortOption.value === 'updatedAt') return list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  return list.sort((a, b) => a.name.localeCompare(b.name, 'de'))
})

const selectedRevier = computed(() => reviere.value.find((revier) => revier.id === selectedRevierId.value) ?? null)
const currentUserId = computed(() => {
  const token = localStorage.getItem('accessToken')
  if (!token) return ''
  try { return (JSON.parse(atob(token.split('.')[1])) as { sub?: string }).sub ?? '' } catch { return '' }
})
const facilityTasks = (facilityId: string) => tasks.value.filter((task) => task.jagdeinrichtungId === facilityId && task.status !== 'erledigt')
const memberName = (id?: string) => members.value.find((member) => member.id === id)?.displayName ?? 'Alle Mitglieder'
const reservationsFor = (facilityId: string) => reservations.value.filter((reservation) => reservation.jagdeinrichtungId === facilityId)
const reservationFor = (facilityId: string) => reservationsFor(facilityId)[0]
const reservable = (facility: Facility) => ['Kanzel', 'Bock', 'Leiter'].includes(facility.typ)
const formatReservationStart = (value?: string) => value
  ? new Intl.DateTimeFormat('de-DE', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
  : 'sofort'
/** Badge label/color for a facility's current usage: checked-in, reserved, or free. */
const reservationBadge = (facility: Facility) => {
  const reservation = reservationFor(facility.id)
  if (reservation?.checkedInBy) return { label: 'Eingecheckt', color: 'success' }
  if (reservation) return { label: 'Reserviert', color: 'warning' }
  return { label: 'Frei', color: 'medium' }
}
/** Short summary line for a facility's next/current booking, including a count if there are more. */
const reservationDetails = (facility: Facility) => {
  const facilityReservations = reservationsFor(facility.id)
  const reservation = facilityReservations[0]
  if (!reservation) return 'Keine aktive Buchung'
  if (reservation.checkedInBy) return `Von ${reservation.checkedInByName ?? memberName(reservation.checkedInBy)}`
  const person = reservation.reservedByName ?? memberName(reservation.reservedBy)
  const count = facilityReservations.length > 1 ? ` · ${facilityReservations.length} Buchungen` : ''
  return `${person} · ${formatReservationStart(reservation.startAt)}${count}`
}
function openFacility(facility: Facility) {
  selectedFacility.value = facility
  facilityDialogOpen.value = true
}

function closeFacilityDialog() {
  facilityDialogOpen.value = false
  selectedFacility.value = null
}

/** Navigates to the Revierkarte, focused on this facility, so "Auf Karte anzeigen" works from the list too. */
async function showFacilityOnMap(facility: Facility) {
  localStorage.setItem('jj-member-selected-revier', facility.revierId)
  closeFacilityDialog()
  await router.push({ path: '/reviere/karte', query: { facility: facility.id } })
}

/** Navigates to the Revierkarte and immediately enters repositioning mode for this facility. */
async function requestFacilityReposition(facility: Facility) {
  localStorage.setItem('jj-member-selected-revier', facility.revierId)
  closeFacilityDialog()
  await router.push({ path: '/reviere/karte', query: { facility: facility.id, reposition: facility.id } })
}

function handleUpdatedFacility(facility: Facility) {
  facilities.value = facilities.value.map((entry) => entry.id === facility.id ? facility : entry)
  closeFacilityDialog()
}

function handleDeletedFacility(facilityId: string) {
  // Cascades locally like the API does: remove the facility's own tasks and reservations too.
  facilities.value = facilities.value.filter((facility) => facility.id !== facilityId)
  tasks.value = tasks.value.filter((task) => task.jagdeinrichtungId !== facilityId)
  reservations.value = reservations.value.filter((reservation) => reservation.jagdeinrichtungId !== facilityId)
  closeFacilityDialog()
}

/** Refreshes only the reservations after a usage change inside the facility dialog. */
async function handleUsageChanged() {
  if (!selectedRevierId.value) return
  const token = localStorage.getItem('accessToken')
  try {
    const response = await fetch(`${apiUrl}/reviere/${selectedRevierId.value}/jagdeinrichtung-reservierungen`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
    if (!response.ok) throw new Error('Reservierungen konnten nicht aktualisiert werden.')
    reservations.value = ((await response.json()) as { reservierungen: Reservation[] }).reservierungen
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Reservierungen konnten nicht aktualisiert werden.'
  }
}

/** Loads facilities, tasks, reservations and members for the selected Revier. */
async function loadRevierData() {
  if (!selectedRevierId.value) return
  loading.value = true
  errorMessage.value = ''
  const token = localStorage.getItem('accessToken')
  const headers = { Authorization: `Bearer ${token}` }
  try {
    const responses = await Promise.all([
      fetch(`${apiUrl}/reviere/${selectedRevierId.value}/jagdeinrichtungen`, { headers }),
      fetch(`${apiUrl}/reviere/${selectedRevierId.value}/jagdeinrichtungs-aufgaben`, { headers }),
      fetch(`${apiUrl}/reviere/${selectedRevierId.value}/jagdeinrichtung-reservierungen`, { headers }),
      fetch(`${apiUrl}/reviere/${selectedRevierId.value}/members`, { headers }),
    ])
    if (responses.some((response) => !response.ok)) throw new Error('Einrichtungsdaten konnten nicht geladen werden.')
    facilities.value = ((await responses[0].json()) as { jagdeinrichtungen: Facility[] }).jagdeinrichtungen
    tasks.value = ((await responses[1].json()) as { aufgaben: Task[] }).aufgaben
    reservations.value = ((await responses[2].json()) as { reservierungen: Reservation[] }).reservierungen
    members.value = ((await responses[3].json()) as { members: Member[] }).members
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Einrichtungsdaten konnten nicht geladen werden.'
  } finally { loading.value = false }
}

/** Switches the active Revier, persists the choice, and reloads its data. */
async function selectRevier(revierId: string) {
  selectedRevierId.value = revierId
  localStorage.setItem('jj-member-selected-revier', revierId)
  await loadRevierData()
}

/** Loads the user's Reviere, then falls back to the first one if none is selected yet. */
async function loadReviere() {
  const token = localStorage.getItem('accessToken')
  try {
    const response = await fetch(`${apiUrl}/reviere`, { headers: { Authorization: `Bearer ${token}` } })
    if (!response.ok) throw new Error('Reviere konnten nicht geladen werden.')
    reviere.value = ((await response.json()) as { reviere: Revier[] }).reviere
    if (!reviere.value.some((revier) => revier.id === selectedRevierId.value)) {
      selectedRevierId.value = reviere.value[0]?.id ?? ''
      if (selectedRevierId.value) localStorage.setItem('jj-member-selected-revier', selectedRevierId.value)
      else localStorage.removeItem('jj-member-selected-revier')
    }
    await loadRevierData()
  } catch (error) { errorMessage.value = error instanceof Error ? error.message : 'Reviere konnten nicht geladen werden.' }
}

async function reserve(facility: Facility) {
  await facilityAction(facility, 'POST')
}

async function release(facility: Facility) {
  await facilityAction(facility, 'DELETE')
}

async function checkIn(facility: Facility) {
  const token = localStorage.getItem('accessToken')
  const response = await fetch(`${apiUrl}/reviere/${facility.revierId}/jagdeinrichtungen/${facility.id}/einchecken`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
  if (!response.ok) { errorMessage.value = ((await response.json()) as { message?: string }).message ?? 'Einchecken konnte nicht erfolgen.'; return }
  await loadRevierData()
}

async function checkOut(facility: Facility) {
  const token = localStorage.getItem('accessToken')
  const response = await fetch(`${apiUrl}/reviere/${facility.revierId}/jagdeinrichtungen/${facility.id}/einchecken`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
  if (!response.ok) { errorMessage.value = ((await response.json()) as { message?: string }).message ?? 'Auschecken konnte nicht erfolgen.'; return }
  await loadRevierData()
}

/** Reserves or releases a facility for the current user. */
async function facilityAction(facility: Facility, method: 'POST' | 'DELETE') {
  const token = localStorage.getItem('accessToken')
  const response = await fetch(`${apiUrl}/reviere/${facility.revierId}/jagdeinrichtungen/${facility.id}/reservieren`, { method, headers: { Authorization: `Bearer ${token}` } })
  if (!response.ok) { errorMessage.value = ((await response.json()) as { message?: string }).message ?? 'Reservierung konnte nicht geändert werden.'; return }
  await loadRevierData()
}

function openTask(facility: Facility) {
  taskFacility.value = facility
  taskTitle.value = ''
  taskDescription.value = ''
  taskAssignee.value = ''
}

/** Creates a new task attached to `taskFacility`. */
async function createTask() {
  if (!taskFacility.value || taskTitle.value.trim().length < 2) return
  taskSaving.value = true
  const token = localStorage.getItem('accessToken')
  try {
    const response = await fetch(`${apiUrl}/reviere/${taskFacility.value.revierId}/jagdeinrichtungs-aufgaben`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jagdeinrichtungId: taskFacility.value.id, titel: taskTitle.value.trim(), beschreibung: taskDescription.value.trim() || undefined, assignedTo: taskAssignee.value || undefined }),
    })
    if (!response.ok) throw new Error(((await response.json()) as { message?: string }).message ?? 'Aufgabe konnte nicht angelegt werden.')
    taskFacility.value = null
    await loadRevierData()
  } catch (error) { errorMessage.value = error instanceof Error ? error.message : 'Aufgabe konnte nicht angelegt werden.' }
  finally { taskSaving.value = false }
}

/** Applies a partial task update (status/assignee) and refreshes the Revier data. */
async function updateTask(task: Task, data: { status?: Task['status']; assignedTo?: string }) {
  const token = localStorage.getItem('accessToken')
  const response = await fetch(`${apiUrl}/reviere/${selectedRevierId.value}/jagdeinrichtungs-aufgaben/${task.id}`, { method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(data) })
  if (!response.ok) { errorMessage.value = 'Aufgabe konnte nicht aktualisiert werden.'; return }
  await loadRevierData()
}

async function claimTask(task: Task) { await updateTask(task, { assignedTo: currentUserId.value, status: 'in Bearbeitung' }) }
async function completeTask(task: Task) { await updateTask(task, { status: 'erledigt' }) }

onMounted(loadReviere)
</script>

<template>
  <AppLayout>
    <div class="facilities-page">
      <section class="page-banner">
        <div class="page-banner-inner">
          <div><h1>Reviereinrichtungen</h1><p v-if="selectedRevier">{{ selectedRevier.name }} · {{ selectedRevier.municipalityName }}</p></div>
          <IonSelect :value="sortOption" label="Sortierung" label-placement="stacked" interface="popover" @ion-change="changeSortOption($event.detail.value)">
            <IonSelectOption value="name">Name (A-Z)</IonSelectOption>
            <IonSelectOption value="createdAt">Neu angelegt zuerst</IonSelectOption>
            <IonSelectOption value="updatedAt">Zuletzt geändert zuerst</IonSelectOption>
          </IonSelect>
          <IonSelect v-if="reviere.length > 1" :value="selectedRevierId" label="Revier" label-placement="stacked" interface="popover" @ion-change="selectRevier($event.detail.value)">
            <IonSelectOption v-for="revier in reviere" :key="revier.id" :value="revier.id">{{ revier.name }}</IonSelectOption>
          </IonSelect>
        </div>
      </section>
      <main class="page-content">
      <IonNote v-if="loading">Einrichtungen werden geladen...</IonNote>
      <p v-else-if="errorMessage" class="error-message">{{ errorMessage }}</p>
      <IonNote v-else-if="!facilities.length">Noch keine Jagdeinrichtungen angelegt.</IonNote>
      <div v-else class="facility-list">
        <article v-for="facility in sortedFacilities" :key="facility.id" class="facility-entry">
          <div class="facility-header"><div class="facility-title"><h2>{{ facility.name }}</h2><p>{{ facility.typ }}</p></div><IonBadge :color="facility.status === 'aktiv' ? 'success' : facility.status === 'defekt' ? 'defekt' : 'medium'">{{ facility.status }}</IonBadge><SatelliteThumbnail class="facility-thumbnail" :position="facility.position" :label="`Satellitenbild der Einrichtung ${facility.name}`" /><IonButton size="small" fill="clear" @click="openFacility(facility)">Öffnen</IonButton></div>
          <p v-if="facility.zustandsInfo" class="condition"><strong>Zustand:</strong> {{ facility.zustandsInfo }}</p>
          <p v-if="facility.notiz" class="note">{{ facility.notiz }}</p>
          <div v-if="reservable(facility)" class="reservation"><strong>Nutzung</strong><div class="reservation-summary"><IonBadge :color="reservationBadge(facility).color">{{ reservationBadge(facility).label }}</IonBadge><span>{{ reservationDetails(facility) }}</span></div></div>
          <div class="task-heading"><strong>Aufgaben</strong></div>
          <IonList v-if="facilityTasks(facility.id).length" lines="full">
            <IonItem v-for="task in facilityTasks(facility.id)" :key="task.id">
              <IonLabel><h3>{{ task.titel }}</h3><p>{{ task.beschreibung || 'Keine weitere Beschreibung' }}</p><p>{{ task.assignedTo ? `Zuständig: ${memberName(task.assignedTo)}` : 'Für alle Mitglieder' }} · {{ task.status }}</p></IonLabel>
            </IonItem>
          </IonList>
          <IonNote v-else>Keine Aufgaben</IonNote>
        </article>
      </div>
      <NewJagdeinrichtungDialog
        v-if="selectedRevier"
        :is-open="facilityDialogOpen"
        :revier-id="selectedRevier.id"
        :center="selectedRevier.center"
        :facility="selectedFacility"
        :can-reposition="true"
        @close="closeFacilityDialog"
        @updated="handleUpdatedFacility"
        @deleted="handleDeletedFacility"
        @show-on-map-requested="showFacilityOnMap"
        @reposition-requested="requestFacilityReposition"
        @usage-changed="handleUsageChanged"
      />
      </main>
    </div>
  </AppLayout>
</template>

<style scoped>
.facilities-page { min-height: 100%; }
.page-banner { background: #e8eddc; border-bottom: 1px solid #c5cfb3; }
.page-banner-inner, .page-content { width: min(1120px, calc(100% - 40px)); margin: 0 auto; }
.page-banner-inner { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 20px; padding: 20px 0; }
.page-banner h1, .page-banner p, .facility-header h2, .facility-header p { margin: 0 0 4px; }
.page-banner h1 { color: #2e3b22; }
.page-banner p { color: #536142; }
.page-content { padding: 24px 0 36px; }
.facility-header, .reservation, .task-heading, .dialog-actions { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.facility-title { flex: 1; min-width: 0; }
.facility-list { display: grid; gap: 16px; }
.facility-entry { border: 1px solid var(--ion-color-light-shade); border-radius: 8px; padding: 16px; }
.condition { margin: 12px 0 4px; }
.note, .reservation, .task-heading { margin-top: 12px; }
.reservation { border-top: 1px solid var(--ion-color-light-shade); padding-top: 10px; }
.reservation-summary { display: flex; align-items: center; justify-content: flex-end; gap: 8px; text-align: right; }
.reservation-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
.task-dialog { padding: 20px; }
.task-dialog h2 { margin-top: 0; }
.error-message { color: var(--ion-color-danger); }
@media (min-width: 980px) { .facility-list { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 600px) {
  .page-banner-inner, .page-content { width: min(100% - 28px, 1120px); }
  .page-banner-inner { align-items: stretch; flex-direction: column; padding: 16px 0; }
  .facility-header { align-items: flex-start; }
  .facility-header { flex-wrap: wrap; }
  :deep(.facility-thumbnail) { order: 4; width: 100%; }
}
</style>