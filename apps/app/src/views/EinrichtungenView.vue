<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { IonBadge, IonButton, IonInput, IonItem, IonLabel, IonList, IonModal, IonNote, IonSelect, IonSelectOption, IonTextarea } from '@ionic/vue'
import AppLayout from '../components/AppLayout.vue'

interface Revier { id: string; name: string; municipalityName: string }
interface Member { id: string; displayName: string }
type FacilityType = 'Kanzel' | 'Bock' | 'Leiter' | 'Roehrenfalle' | 'Kirrung'
type FacilityStatus = 'aktiv' | 'defekt' | 'ausser Betrieb'
interface Facility { id: string; revierId: string; name: string; typ: FacilityType; status: FacilityStatus; zustandsInfo?: string; notiz?: string }
interface Task { id: string; jagdeinrichtungId: string; titel: string; beschreibung?: string; status: 'offen' | 'in Bearbeitung' | 'erledigt'; assignedTo?: string; assignedBy: string }
interface Reservation { id: string; jagdeinrichtungId: string; reservedBy: string; reservedAt: string }

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8787'
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

const selectedRevier = computed(() => reviere.value.find((revier) => revier.id === selectedRevierId.value) ?? null)
const currentUserId = computed(() => {
  const token = localStorage.getItem('accessToken')
  if (!token) return ''
  try { return (JSON.parse(atob(token.split('.')[1])) as { sub?: string }).sub ?? '' } catch { return '' }
})
const facilityTasks = (facilityId: string) => tasks.value.filter((task) => task.jagdeinrichtungId === facilityId)
const memberName = (id?: string) => members.value.find((member) => member.id === id)?.displayName ?? 'Alle Mitglieder'
const reservationFor = (facilityId: string) => reservations.value.find((reservation) => reservation.jagdeinrichtungId === facilityId)
const reservable = (facility: Facility) => ['Kanzel', 'Bock', 'Leiter'].includes(facility.typ)

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

async function selectRevier(revierId: string) {
  selectedRevierId.value = revierId
  localStorage.setItem('jj-member-selected-revier', revierId)
  await loadRevierData()
}

async function loadReviere() {
  const token = localStorage.getItem('accessToken')
  try {
    const response = await fetch(`${apiUrl}/reviere`, { headers: { Authorization: `Bearer ${token}` } })
    if (!response.ok) throw new Error('Reviere konnten nicht geladen werden.')
    reviere.value = ((await response.json()) as { reviere: Revier[] }).reviere
    if (!reviere.value.some((revier) => revier.id === selectedRevierId.value)) selectedRevierId.value = reviere.value[0]?.id ?? ''
    await loadRevierData()
  } catch (error) { errorMessage.value = error instanceof Error ? error.message : 'Reviere konnten nicht geladen werden.' }
}

async function reserve(facility: Facility) {
  await facilityAction(facility, 'POST')
}

async function release(facility: Facility) {
  await facilityAction(facility, 'DELETE')
}

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
        <article v-for="facility in facilities" :key="facility.id" class="facility-entry">
          <div class="facility-header"><div><h2>{{ facility.name }}</h2><p>{{ facility.typ }}</p></div><IonBadge :color="facility.status === 'aktiv' ? 'success' : facility.status === 'defekt' ? 'warning' : 'medium'">{{ facility.status }}</IonBadge></div>
          <p v-if="facility.zustandsInfo" class="condition"><strong>Zustand:</strong> {{ facility.zustandsInfo }}</p>
          <p v-if="facility.notiz" class="note">{{ facility.notiz }}</p>
          <div class="reservation" v-if="reservable(facility)">
            <span v-if="reservationFor(facility.id)">Reserviert von {{ memberName(reservationFor(facility.id)?.reservedBy) }}</span><span v-else>Frei buchbar</span>
            <IonButton v-if="!reservationFor(facility.id)" size="small" fill="outline" @click="reserve(facility)">Einbuchen</IonButton>
            <IonButton v-else-if="reservationFor(facility.id)?.reservedBy === currentUserId" size="small" fill="outline" @click="release(facility)">Ausbuchen</IonButton>
          </div>
          <div class="task-heading"><strong>Aufgaben</strong><IonButton size="small" fill="clear" @click="openTask(facility)">Aufgabe hinzufügen</IonButton></div>
          <IonList v-if="facilityTasks(facility.id).length" lines="full">
            <IonItem v-for="task in facilityTasks(facility.id)" :key="task.id">
              <IonLabel><h3>{{ task.titel }}</h3><p>{{ task.beschreibung || 'Keine weitere Beschreibung' }}</p><p>{{ task.assignedTo ? `Zuständig: ${memberName(task.assignedTo)}` : 'Für alle Mitglieder' }} · {{ task.status }}</p></IonLabel>
              <IonButton v-if="!task.assignedTo && task.status !== 'erledigt'" slot="end" size="small" @click="claimTask(task)">Übernehmen</IonButton>
              <IonButton v-else-if="task.assignedTo === currentUserId && task.status !== 'erledigt'" slot="end" size="small" @click="completeTask(task)">Erledigt</IonButton>
            </IonItem>
          </IonList>
          <IonNote v-else>Keine Aufgaben</IonNote>
        </article>
      </div>
      <IonModal :is-open="Boolean(taskFacility)" @did-dismiss="taskFacility = null">
        <div class="task-dialog"><h2>Neue Aufgabe für {{ taskFacility?.name }}</h2><IonInput v-model="taskTitle" label="Aufgabe" label-placement="stacked" placeholder="z. B. Leiter instand setzen" /><IonTextarea v-model="taskDescription" label="Beschreibung" label-placement="stacked" :auto-grow="true" /><IonSelect v-model="taskAssignee" label="Zuweisen an" label-placement="stacked" interface="popover"><IonSelectOption value="">Für alle Mitglieder</IonSelectOption><IonSelectOption v-for="member in members" :key="member.id" :value="member.id">{{ member.displayName }}</IonSelectOption></IonSelect><div class="dialog-actions"><IonButton fill="clear" @click="taskFacility = null">Abbrechen</IonButton><IonButton :disabled="taskSaving || taskTitle.trim().length < 2" @click="createTask">Speichern</IonButton></div></div>
      </IonModal>
      </main>
    </div>
  </AppLayout>
</template>

<style scoped>
.facilities-page { min-height: 100%; }
.page-banner { background: #e8eddc; border-bottom: 1px solid #c5cfb3; }
.page-banner-inner, .page-content { width: min(1120px, calc(100% - 40px)); margin: 0 auto; }
.page-banner-inner { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 20px 0; }
.page-banner h1, .page-banner p, .facility-header h2, .facility-header p { margin: 0 0 4px; }
.page-banner h1 { color: #2e3b22; }
.page-banner p { color: #536142; }
.page-content { padding: 24px 0 36px; }
.facility-header, .reservation, .task-heading, .dialog-actions { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.facility-list { display: grid; gap: 16px; }
.facility-entry { border: 1px solid var(--ion-color-light-shade); border-radius: 8px; padding: 16px; }
.condition { margin: 12px 0 4px; }
.note, .reservation, .task-heading { margin-top: 12px; }
.reservation { border-top: 1px solid var(--ion-color-light-shade); padding-top: 10px; }
.task-dialog { padding: 20px; }
.task-dialog h2 { margin-top: 0; }
.error-message { color: var(--ion-color-danger); }
@media (min-width: 980px) { .facility-list { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 600px) {
  .page-banner-inner, .page-content { width: min(100% - 28px, 1120px); }
  .page-banner-inner { align-items: stretch; flex-direction: column; padding: 16px 0; }
  .facility-header { align-items: flex-start; }
}
</style>