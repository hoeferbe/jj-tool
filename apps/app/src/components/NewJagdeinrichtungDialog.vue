<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { IonBadge, IonButton, IonContent, IonItem, IonLabel, IonList, IonModal, IonNote, IonSelect, IonSelectOption, IonTextarea } from '@ionic/vue'

interface Point { lat: number; lng: number }
interface Jagdeinrichtung {
  id: string
  revierId: string
  name: string
  typ: 'Kanzel' | 'Bock' | 'Leiter' | 'Roehrenfalle' | 'Kirrung'
  position: Point
  status: 'aktiv' | 'defekt' | 'ausser Betrieb'
  zustandsInfo?: string
  notiz?: string
  createdBy: string
  createdAt: string
  updatedAt: string
}
interface FacilityReservation {
  id: string
  reservedBy: string
  reservedByName?: string
  checkedInBy?: string
  checkedInByName?: string
  startAt?: string
  endAt?: string
  releasedAt?: string
  checkedOutAt?: string
}
interface FacilityTask {
  id: string
  jagdeinrichtungId: string
  titel: string
  beschreibung?: string
  status: 'offen' | 'in Bearbeitung' | 'erledigt'
  assignedTo?: string
}
interface FacilityMember { id: string; displayName: string }
interface CurrentUser {
  id: string
  accountType: 'systemAdmin' | 'member'
  memberships: Array<{ revierId: string; status: 'active' | 'pending'; memberType: 'paechter' | 'bgs' | 'guest'; isAdmin: boolean }>
}

const props = withDefaults(defineProps<{
  isOpen: boolean
  revierId: string
  center: Point
  facility?: Jagdeinrichtung | null
  position?: Point
  positionWasSelected?: boolean
  reservation?: FacilityReservation | null
  canReposition?: boolean
}>(), { canReposition: false })
const emit = defineEmits<{
  close: []
  created: [facility: Jagdeinrichtung]
  updated: [facility: Jagdeinrichtung]
  deleted: [facilityId: string]
  repositionRequested: [facility: Jagdeinrichtung]
  showOnMapRequested: [facility: Jagdeinrichtung]
  usageChanged: []
}>()
const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8787'
const name = ref('')
const typ = ref<Jagdeinrichtung['typ']>('Kanzel')
const status = ref<Jagdeinrichtung['status']>('aktiv')
const zustandsInfo = ref('')
const notiz = ref('')
const position = ref<Point>({ ...(props.position ?? props.center) })
const saving = ref(false)
const deleting = ref(false)
const message = ref('')
const currentUser = ref<CurrentUser | null>(null)
const usageMessage = ref('')
const usageSaving = ref(false)
const activeReservations = ref<FacilityReservation[]>(props.reservation ? [props.reservation] : [])
const reservationHistory = ref<FacilityReservation[]>([])
const loadedReservation = computed(() => activeReservations.value[0] ?? null)
const editingReservation = ref<FacilityReservation | null>(null)
const reservationStart = ref('')
const reservationEnd = ref('')
const reservationDate = ref('')
const reservationTime = ref('')
const reservationDurationHours = ref(3)
const reservationTimeOptions = Array.from({ length: 48 }, (_, index) => {
  const hours = Math.floor(index / 2).toString().padStart(2, '0')
  const minutes = index % 2 === 0 ? '00' : '30'
  return `${hours}:${minutes}`
})
const reservationDurationOptions = Array.from({ length: 24 }, (_, index) => (index + 1) / 2)
const localizedReservationDate = computed(() => reservationDate.value
  ? new Intl.DateTimeFormat('de-DE', { dateStyle: 'full' }).format(new Date(`${reservationDate.value}T12:00:00`))
  : '')
const showReservationFields = ref(false)
const showReservationHistory = ref(false)
const tasks = ref<FacilityTask[]>([])
const members = ref<FacilityMember[]>([])
const taskTitle = ref('')
const taskDescription = ref('')
const taskAssignee = ref('')
const taskSaving = ref(false)
const showTaskHistory = ref(false)
const openTasks = () => tasks.value.filter((task) => task.status !== 'erledigt')
const completedTasks = () => tasks.value.filter((task) => task.status === 'erledigt')
const selectedMembership = computed(() => currentUser.value?.memberships.find((membership) =>
  membership.revierId === props.revierId && membership.status === 'active',
))
const canEditFacility = computed(() => {
  if (!props.facility || currentUser.value?.accountType === 'systemAdmin') return true
  const membership = selectedMembership.value
  if (!membership || membership.memberType === 'guest') return false
  return membership.isAdmin || props.facility.createdBy === currentUser.value?.id
})
const canDeleteFacility = computed(() => Boolean(props.facility) && canEditFacility.value)

const reservable = () => props.facility && ['Kanzel', 'Bock', 'Leiter'].includes(props.facility.typ)
const currentUserId = () => {
  const token = localStorage.getItem('accessToken')
  if (!token) return ''
  try { return (JSON.parse(atob(token.split('.')[1])) as { sub?: string }).sub ?? '' } catch { return '' }
}

function reset() {
  name.value = props.facility?.name ?? ''
  typ.value = props.facility?.typ ?? 'Kanzel'
  status.value = props.facility?.status ?? 'aktiv'
  zustandsInfo.value = props.facility?.zustandsInfo ?? ''
  notiz.value = props.facility?.notiz ?? ''
  position.value = props.facility ? { ...props.facility.position } : { ...(props.position ?? props.center) }
  message.value = ''
  usageMessage.value = ''
  activeReservations.value = props.reservation ? [props.reservation] : []
  reservationHistory.value = []
  editingReservation.value = null
  reservationDurationHours.value = 3
  setReservationStart(toLocalDateTime(props.reservation?.startAt) ?? defaultReservationStart())
  showReservationFields.value = false
  showReservationHistory.value = false
  showTaskHistory.value = false
}

function toLocalDateTime(value?: string) {
  if (!value) return undefined
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return undefined
  const timezoneOffset = date.getTimezoneOffset() * 60000
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 16)
}

function defaultReservationStart() {
  const date = new Date(Date.now() + 30 * 60000)
  date.setMinutes(date.getMinutes() - (date.getMinutes() % 30), 0, 0)
  return toLocalDateTime(date.toISOString()) ?? ''
}

function setReservationStart(start: string, end?: string) {
  reservationStart.value = start
  const [date = '', time = ''] = start.split('T')
  reservationDate.value = date
  reservationTime.value = time
  if (end) {
    const duration = (new Date(end).getTime() - new Date(start).getTime()) / (60 * 60 * 1000)
    reservationDurationHours.value = duration > 0 && duration % 0.5 === 0 ? duration : 3
  }
  updateReservationEnd()
}

function handleReservationStartChange() {
  if (!reservationDate.value || !reservationTime.value) {
    reservationStart.value = ''
    reservationEnd.value = ''
    return
  }
  reservationStart.value = `${reservationDate.value}T${reservationTime.value}`
  updateReservationEnd()
}

function updateReservationEnd() {
  if (!reservationStart.value) {
    reservationEnd.value = ''
    return
  }
  const date = new Date(reservationStart.value)
  date.setMinutes(date.getMinutes() + reservationDurationHours.value * 60)
  reservationEnd.value = toLocalDateTime(date.toISOString()) ?? ''
}

function reservationPayload() {
  return {
    startAt: new Date(reservationStart.value).toISOString(),
    endAt: reservationEnd.value ? new Date(reservationEnd.value).toISOString() : undefined,
  }
}

function formatReservationPeriod(reservation: FacilityReservation) {
  if (!reservation.startAt) return 'Sofort'
  const start = new Date(reservation.startAt)
  const dateFormatter = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const timeFormatter = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit' })
  const startText = `${dateFormatter.format(start)}, ${timeFormatter.format(start)}`
  if (!reservation.endAt) return startText
  const end = new Date(reservation.endAt)
  const sameDay = start.toDateString() === end.toDateString()
  const endText = sameDay
    ? timeFormatter.format(end)
    : `${dateFormatter.format(end)}, ${timeFormatter.format(end)}`
  return `${startText} bis ${endText}`
}

function reservationHistoryStatus(reservation: FacilityReservation) {
  if (reservation.checkedOutAt) return 'Ausgecheckt'
  if (reservation.releasedAt) return 'Storniert oder freigegeben'
  return 'Abgelaufen'
}

async function loadUsage() {
  if (!props.facility || !reservable()) return
  const token = localStorage.getItem('accessToken')
  const headers = { Authorization: `Bearer ${token}` }
  const [activeResponse, historyResponse] = await Promise.all([
    fetch(`${apiUrl}/reviere/${props.revierId}/jagdeinrichtung-reservierungen`, { headers }),
    fetch(`${apiUrl}/reviere/${props.revierId}/jagdeinrichtung-reservierungen/historie`, { headers }),
  ])
  if (!activeResponse.ok || !historyResponse.ok) return
  const activeData = await activeResponse.json() as { reservierungen: Array<FacilityReservation & { jagdeinrichtungId: string }> }
  const historyData = await historyResponse.json() as { reservierungen: Array<FacilityReservation & { jagdeinrichtungId: string }> }
  activeReservations.value = activeData.reservierungen.filter((entry) => entry.jagdeinrichtungId === props.facility?.id)
  reservationHistory.value = historyData.reservierungen.filter((entry) => entry.jagdeinrichtungId === props.facility?.id)
  editingReservation.value = null
  setReservationStart(defaultReservationStart())
}

async function loadTasks() {
  if (!props.facility) return
  const token = localStorage.getItem('accessToken')
  const headers = { Authorization: `Bearer ${token}` }
  const [tasksResponse, membersResponse] = await Promise.all([
    fetch(`${apiUrl}/reviere/${props.revierId}/jagdeinrichtungs-aufgaben`, { headers }),
    fetch(`${apiUrl}/reviere/${props.revierId}/members`, { headers }),
  ])
  if (tasksResponse.ok) {
    const data = await tasksResponse.json() as { aufgaben: FacilityTask[] }
    tasks.value = data.aufgaben.filter((task) => task.jagdeinrichtungId === props.facility?.id)
  }
  if (membersResponse.ok) members.value = (await membersResponse.json() as { members: FacilityMember[] }).members
}

async function loadCurrentUser() {
  const token = localStorage.getItem('accessToken')
  const response = await fetch(`${apiUrl}/auth/me`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' })
  if (response.ok) currentUser.value = ((await response.json()) as { user: CurrentUser }).user
}

function memberName(id?: string) {
  return members.value.find((member) => member.id === id)?.displayName ?? 'Alle Mitglieder'
}

async function createTask() {
  if (!props.facility || taskTitle.value.trim().length < 2) return
  taskSaving.value = true
  const token = localStorage.getItem('accessToken')
  try {
    const response = await fetch(`${apiUrl}/reviere/${props.revierId}/jagdeinrichtungs-aufgaben`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jagdeinrichtungId: props.facility.id, titel: taskTitle.value.trim(), beschreibung: taskDescription.value.trim() || undefined, assignedTo: taskAssignee.value || undefined }),
    })
    if (!response.ok) throw new Error(((await response.json()) as { message?: string }).message ?? 'Aufgabe konnte nicht angelegt werden.')
    taskTitle.value = ''
    taskDescription.value = ''
    taskAssignee.value = ''
    await loadTasks()
  } catch (error) {
    usageMessage.value = error instanceof Error ? error.message : 'Aufgabe konnte nicht angelegt werden.'
  } finally { taskSaving.value = false }
}

async function updateTask(task: FacilityTask, data: { status?: FacilityTask['status']; assignedTo?: string }) {
  const token = localStorage.getItem('accessToken')
  const response = await fetch(`${apiUrl}/reviere/${props.revierId}/jagdeinrichtungs-aufgaben/${task.id}`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  })
  if (!response.ok) {
    usageMessage.value = ((await response.json()) as { message?: string }).message ?? 'Aufgabe konnte nicht aktualisiert werden.'
    return
  }
  await loadTasks()
}

async function changeUsage(path: string, method: 'POST' | 'DELETE') {
  if (!props.facility) return
  usageSaving.value = true
  usageMessage.value = ''
  const token = localStorage.getItem('accessToken')
  try {
    const response = await fetch(`${apiUrl}/reviere/${props.revierId}/jagdeinrichtungen/${props.facility.id}/${path}`, { method, headers: { Authorization: `Bearer ${token}` } })
    if (!response.ok) throw new Error(((await response.json()) as { message?: string }).message ?? 'Nutzungsstatus konnte nicht geändert werden.')
    await loadUsage()
    emit('usageChanged')
  } catch (error) {
    usageMessage.value = error instanceof Error ? error.message : 'Nutzungsstatus konnte nicht geändert werden.'
  } finally { usageSaving.value = false }
}

async function reserve() {
  if (!props.facility || !reservationStart.value) return
  await changeReservation('POST', reservationPayload())
}

function beginReservation() {
  showReservationFields.value = true
  editingReservation.value = null
  reservationDurationHours.value = 3
  setReservationStart(defaultReservationStart())
}

function beginReservationEdit(reservation: FacilityReservation) {
  showReservationFields.value = true
  editingReservation.value = reservation
  setReservationStart(toLocalDateTime(reservation.startAt) ?? defaultReservationStart(), toLocalDateTime(reservation.endAt))
}

async function updateReservation() {
  if (!props.facility || !editingReservation.value || !reservationStart.value) return
  await changeReservation('PATCH', reservationPayload(), editingReservation.value.id)
}

async function cancelReservation(reservation: FacilityReservation) {
  if (!props.facility) return
  await changeReservation('DELETE', undefined, reservation.id)
}

async function changeReservation(method: 'POST' | 'PATCH' | 'DELETE', body?: { startAt: string; endAt?: string }, reservationId?: string) {
  if (!props.facility) return
  usageSaving.value = true
  usageMessage.value = ''
  const token = localStorage.getItem('accessToken')
  const suffix = method === 'POST' ? 'reservieren' : `reservieren/${reservationId}`
  try {
    const response = await fetch(`${apiUrl}/reviere/${props.revierId}/jagdeinrichtungen/${props.facility.id}/${suffix}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    if (!response.ok) throw new Error(((await response.json()) as { message?: string }).message ?? 'Reservierung konnte nicht geändert werden.')
    await loadUsage()
    showReservationFields.value = false
    editingReservation.value = null
    emit('usageChanged')
  } catch (error) {
    usageMessage.value = error instanceof Error ? error.message : 'Reservierung konnte nicht geändert werden.'
  } finally { usageSaving.value = false }
}

async function saveFacility() {
  if (name.value.trim().length < 2) return
  saving.value = true
  message.value = ''
  const token = localStorage.getItem('accessToken')
  try {
    const isEditing = Boolean(props.facility)
    const endpoint = isEditing
      ? `${apiUrl}/reviere/${props.revierId}/jagdeinrichtungen/${props.facility!.id}`
      : `${apiUrl}/reviere/${props.revierId}/jagdeinrichtungen`
    const response = await fetch(endpoint, {
      method: isEditing ? 'PUT' : 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: name.value.trim(), typ: typ.value, status: status.value, zustandsInfo: zustandsInfo.value.trim() || undefined, notiz: notiz.value.trim() || undefined, position: position.value }),
    })
    const data = await response.json() as { jagdeinrichtung?: Jagdeinrichtung; message?: string }
    if (!response.ok || !data.jagdeinrichtung) throw new Error(data.message ?? 'Jagdeinrichtung konnte nicht angelegt werden.')
    if (isEditing) emit('updated', data.jagdeinrichtung)
    else emit('created', data.jagdeinrichtung)
    close()
  } catch (error) {
    message.value = error instanceof Error ? error.message : 'Jagdeinrichtung konnte nicht angelegt werden.'
  } finally {
    saving.value = false
  }
}

async function deleteFacility() {
  if (!props.facility || !canDeleteFacility.value) return
  const confirmed = window.confirm(`Soll „${props.facility.name}“ endgültig gelöscht werden? Alle zugehörigen Aufgaben und Reservierungen werden ebenfalls gelöscht.`)
  if (!confirmed) return
  deleting.value = true
  message.value = ''
  const token = localStorage.getItem('accessToken')
  try {
    const response = await fetch(`${apiUrl}/reviere/${props.revierId}/jagdeinrichtungen/${props.facility.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!response.ok) throw new Error(((await response.json()) as { message?: string }).message ?? 'Jagdeinrichtung konnte nicht gelöscht werden.')
    emit('deleted', props.facility.id)
    close()
  } catch (error) {
    message.value = error instanceof Error ? error.message : 'Jagdeinrichtung konnte nicht gelöscht werden.'
  } finally {
    deleting.value = false
  }
}

function close() {
  emit('close')
}

watch(() => props.isOpen, async (isOpen) => { if (isOpen) { reset(); await Promise.all([loadUsage(), loadTasks(), loadCurrentUser()]) } })
</script>

<template>
  <IonModal class="facility-modal" :is-open="props.isOpen" :backdrop-dismiss="false" @did-dismiss="close">
    <IonContent class="dialog-scroll">
      <div class="dialog-content">
      <div class="dialog-heading">
        <h2>{{ props.facility ? 'Jagdeinrichtung bearbeiten' : 'Jagdeinrichtung anlegen' }}</h2>
      </div>
      <section v-if="props.facility && reservable()" class="usage-section">
        <div class="usage-heading">
          <h3>Nutzung</h3>
          <IonBadge v-if="loadedReservation?.checkedInBy" color="success">Eingecheckt</IonBadge>
          <IonBadge v-else-if="loadedReservation" color="warning">Reserviert</IonBadge>
          <IonBadge v-else color="medium">Frei</IonBadge>
        </div>
        <p v-if="loadedReservation?.checkedInBy">Eingecheckt von {{ loadedReservation.checkedInBy === currentUserId() ? 'dir' : loadedReservation.checkedInByName ?? 'Unbekanntes Mitglied' }}.</p>
        <p v-if="!activeReservations.length">Die Einrichtung ist frei. Lege einen Tag und Zeitraum für die Reservierung fest.</p>
        <div v-else class="reservation-list">
          <article v-for="reservation in activeReservations" :key="reservation.id" class="reservation-entry">
            <div>
              <strong>{{ reservation.checkedInBy ? 'Aktuelle Nutzung' : formatReservationPeriod(reservation) }}</strong>
              <p>{{ reservation.checkedInBy ? `Eingecheckt von ${reservation.checkedInBy === currentUserId() ? 'dir' : reservation.checkedInByName ?? 'Unbekanntes Mitglied'}` : `Reserviert von ${reservation.reservedBy === currentUserId() ? 'dir' : reservation.reservedByName ?? 'Unbekanntes Mitglied'}` }}</p>
            </div>
            <div v-if="reservation.reservedBy === currentUserId() && !reservation.checkedInBy" class="reservation-entry-actions">
              <IonButton size="small" fill="clear" :disabled="usageSaving" @click="beginReservationEdit(reservation)">Ändern</IonButton>
              <IonButton size="small" fill="clear" color="danger" :disabled="usageSaving" @click="cancelReservation(reservation)">Stornieren</IonButton>
            </div>
          </article>
        </div>
        <div v-if="showReservationFields" class="reservation-period">
          <label class="field-label"><span>Datum</span><input v-model="reservationDate" class="form-control" type="date" lang="de" @change="handleReservationStartChange"><small v-if="localizedReservationDate">{{ localizedReservationDate }}</small></label>
          <label class="field-label"><span>Von</span><select v-model="reservationTime" class="form-control" @change="handleReservationStartChange"><option v-for="time in reservationTimeOptions" :key="time" :value="time">{{ time }}</option></select></label>
          <label class="field-label"><span>Dauer</span><select v-model.number="reservationDurationHours" class="form-control" @change="updateReservationEnd"><option v-for="duration in reservationDurationOptions" :key="duration" :value="duration">{{ duration.toLocaleString('de-DE') }} {{ duration === 1 ? 'Stunde' : 'Stunden' }}</option></select></label>
          <label class="field-label"><span>Bis</span><input v-model="reservationEnd" class="form-control" type="datetime-local" readonly></label>
        </div>
        <div class="usage-actions">
          <IonButton v-if="loadedReservation?.checkedInBy === currentUserId()" size="small" fill="outline" :disabled="usageSaving" @click="changeUsage('einchecken', 'DELETE')">Auschecken</IonButton>
          <IonButton v-else-if="!loadedReservation || loadedReservation.reservedBy === currentUserId()" size="small" fill="outline" :disabled="usageSaving" @click="changeUsage('einchecken', 'POST')">Einchecken</IonButton>
          <IonButton v-if="!showReservationFields" size="small" fill="outline" :disabled="usageSaving" @click="beginReservation">{{ activeReservations.length ? 'Weitere Reservierung' : 'Reservieren' }}</IonButton>
          <IonButton v-else-if="!editingReservation" size="small" fill="outline" :disabled="usageSaving || !reservationStart || !reservationEnd" @click="reserve">Reservierung speichern</IonButton>
          <IonButton v-else size="small" fill="outline" :disabled="usageSaving || !reservationStart || !reservationEnd" @click="updateReservation">Änderung speichern</IonButton>
        </div>
        <IonButton v-if="reservationHistory.length" size="small" fill="clear" @click="showReservationHistory = !showReservationHistory">
          {{ showReservationHistory ? 'Reservierungshistorie ausblenden' : `Reservierungshistorie (${reservationHistory.length})` }}
        </IonButton>
        <div v-if="showReservationHistory" class="reservation-history">
          <article v-for="reservation in reservationHistory" :key="reservation.id" class="reservation-entry history-entry">
            <div><strong>{{ formatReservationPeriod(reservation) }}</strong><p>{{ reservation.reservedByName ?? 'Unbekanntes Mitglied' }} · {{ reservationHistoryStatus(reservation) }}</p></div>
          </article>
        </div>
        <p v-if="usageMessage" class="message">{{ usageMessage }}</p>
      </section>
      <section v-if="props.facility" class="tasks-section">
        <div class="usage-heading"><h3>Aufgaben</h3><IonBadge color="medium">{{ openTasks().length }}</IonBadge></div>
        <IonList v-if="openTasks().length" lines="full">
          <IonItem v-for="task in openTasks()" :key="task.id">
            <IonLabel>
              <h4>{{ task.titel }}</h4>
              <p>{{ task.beschreibung || 'Keine weitere Beschreibung' }}</p>
              <p>{{ task.assignedTo ? `Zuständig: ${memberName(task.assignedTo)}` : 'Für alle Mitglieder' }} · {{ task.status }}</p>
            </IonLabel>
            <IonButton v-if="!task.assignedTo && task.status !== 'erledigt'" slot="end" size="small" @click="updateTask(task, { assignedTo: currentUserId(), status: 'in Bearbeitung' })">Übernehmen</IonButton>
            <IonButton v-else-if="task.assignedTo === currentUserId() && task.status !== 'erledigt'" slot="end" size="small" @click="updateTask(task, { status: 'erledigt' })">Erledigt</IonButton>
          </IonItem>
        </IonList>
        <IonButton v-if="completedTasks().length" size="small" fill="clear" @click="showTaskHistory = !showTaskHistory">
          {{ showTaskHistory ? 'Historie ausblenden' : `Historie anzeigen (${completedTasks().length})` }}
        </IonButton>
        <IonList v-if="showTaskHistory && completedTasks().length" lines="full" class="task-history">
          <IonItem v-for="task in completedTasks()" :key="task.id">
            <IonLabel>
              <h4>{{ task.titel }}</h4>
              <p>{{ task.beschreibung || 'Keine weitere Beschreibung' }}</p>
              <p>{{ task.assignedTo ? `Zuständig: ${memberName(task.assignedTo)}` : 'Für alle Mitglieder' }} · erledigt</p>
            </IonLabel>
          </IonItem>
        </IonList>
        <div class="task-form">
          <input v-model="taskTitle" class="form-control" type="text" placeholder="Neue Aufgabe">
          <IonTextarea v-model="taskDescription" label="Beschreibung" label-placement="stacked" :auto-grow="true" />
          <IonSelect v-model="taskAssignee" label="Zuweisen an" label-placement="stacked" interface="popover">
            <IonSelectOption value="">Für alle Mitglieder</IonSelectOption>
            <IonSelectOption v-for="member in members" :key="member.id" :value="member.id">{{ member.displayName }}</IonSelectOption>
          </IonSelect>
          <IonButton size="small" :disabled="taskSaving || taskTitle.trim().length < 2" @click="createTask">Aufgabe speichern</IonButton>
        </div>
      </section>
      <section class="form-section">
        <label class="field-label">
          <span>Bezeichnung</span>
          <input v-model="name" class="form-control" type="text" placeholder="z. B. Kanzel Nord" :disabled="Boolean(props.facility) && !canEditFacility">
        </label>
        <div class="form-row">
          <label class="field-label">
            <span>Typ</span>
            <select v-model="typ" class="form-control" :disabled="Boolean(props.facility) && !canEditFacility">
              <option value="Kanzel">Kanzel</option>
              <option value="Bock">Bock</option>
              <option value="Leiter">Leiter</option>
              <option value="Roehrenfalle">Röhrenfalle</option>
              <option value="Kirrung">Kirrung</option>
            </select>
          </label>
          <label class="field-label">
            <span>Status</span>
            <select v-model="status" class="form-control status-control" :class="`status-${status.replace(' ', '-')}`" :disabled="Boolean(props.facility) && !canEditFacility">
              <option value="aktiv">Aktiv</option>
              <option value="defekt">Defekt</option>
              <option value="ausser Betrieb">Außer Betrieb</option>
            </select>
          </label>
        </div>
      </section>
      <section class="form-section">
        <h3>Zustand und Notiz</h3>
        <label class="field-label">
          <span>Aktueller Zustand / Mangel</span>
          <textarea v-model="zustandsInfo" class="form-control textarea-control" rows="2" placeholder="Kurzbeschreibung, z. B. Tür klemmt oder Wespen vorhanden" :disabled="Boolean(props.facility) && !canEditFacility"></textarea>
        </label>
        <label class="field-label">
          <span>Notiz</span>
          <textarea v-model="notiz" class="form-control textarea-control" rows="2" :disabled="Boolean(props.facility) && !canEditFacility"></textarea>
        </label>
      </section>
      <section class="position-section">
        <div>
          <h3>Position</h3>
          <span class="coordinates">{{ position.lat.toFixed(6) }}, {{ position.lng.toFixed(6) }}</span>
        </div>
        <div v-if="props.facility" class="position-actions">
          <IonButton fill="outline" size="small" @click="emit('showOnMapRequested', props.facility)">Auf Karte anzeigen</IonButton>
          <IonButton v-if="canEditFacility && props.canReposition" fill="outline" size="small" @click="emit('repositionRequested', props.facility)">Position ändern</IonButton>
        </div>
      </section>
      <IonNote v-if="props.positionWasSelected" class="position-confirmation" color="success">Neue Position übernommen. Bitte mit „Speichern“ bestätigen.</IonNote>
      <p v-if="message" class="message">{{ message }}</p>
      <div class="dialog-actions">
        <IonButton v-if="canDeleteFacility" color="danger" fill="clear" :disabled="saving || deleting" @click="deleteFacility">{{ deleting ? 'Löschen...' : 'Löschen' }}</IonButton>
        <span class="dialog-action-spacer"></span>
        <IonButton fill="clear" :disabled="saving || deleting" @click="close">Abbrechen</IonButton>
        <IonButton v-if="!props.facility || canEditFacility" :disabled="saving || deleting || name.trim().length < 2" @click="saveFacility">{{ saving ? 'Speichern...' : 'Speichern' }}</IonButton>
      </div>
      </div>
    </IonContent>
  </IonModal>
</template>

<style scoped>
.dialog-content { display: flex; flex-direction: column; gap: 16px; min-height: 100%; box-sizing: border-box; padding: 22px; }
.dialog-heading, .form-row, .dialog-actions, .position-section { display: flex; align-items: end; gap: 12px; }
.dialog-heading, .position-section { justify-content: space-between; }
.dialog-heading h2, .form-section h3, .position-section h3 { margin: 0; }
.form-section { display: flex; flex-direction: column; gap: 12px; }
.form-row .field-label { flex: 1; min-width: 0; }
.field-label { display: flex; flex-direction: column; gap: 5px; color: var(--ion-text-color); font-size: 0.9rem; }
.form-control { width: 100%; min-height: 46px; box-sizing: border-box; padding: 8px 11px; border: 1px solid #adb4a9; border-radius: 6px; background: #ffffff; color: var(--ion-text-color); font: inherit; font-size: 1rem; line-height: 1.25; }
.form-control:focus { outline: 2px solid rgba(82, 101, 45, 0.35); outline-offset: 1px; border-color: var(--ion-color-primary); }
.textarea-control { min-height: 64px; resize: vertical; }
.status-aktiv { border-color: var(--ion-color-success); background: #edf5e8; }
.status-defekt { border-color: #b58a00; background: #fff7d6; }
.status-ausser-Betrieb { border-color: #5f6368; background: #eef0f2; }
.position-section { align-items: center; padding: 14px; border: 1px solid var(--ion-color-light-shade); border-radius: 8px; background: var(--ion-color-light, #f1f3ed); }
.position-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.usage-section { display: flex; flex-direction: column; gap: 8px; padding: 14px; border: 1px solid var(--ion-color-light-shade); border-radius: 8px; }
.usage-heading, .usage-actions { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.reservation-period { display: flex; gap: 10px; }
.reservation-period .field-label { flex: 1; min-width: 0; }
.reservation-list, .reservation-history { display: grid; gap: 8px; }
.reservation-entry { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px; border: 1px solid var(--ion-color-light-shade); border-radius: 6px; }
.reservation-entry-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; }
.history-entry { background: var(--ion-color-light, #f1f3ed); }
.usage-section p { margin: 0; color: var(--ion-color-medium-shade); }
.tasks-section { display: flex; flex-direction: column; gap: 8px; }
.tasks-section h3 { margin: 0; }
.tasks-section h4 { margin: 0; }
.task-form { display: flex; flex-direction: column; gap: 10px; padding-top: 8px; border-top: 1px solid var(--ion-color-light-shade); }
.position-section h3 { margin-bottom: 5px; font-size: 0.95rem; }
.coordinates { color: var(--ion-color-medium-shade); font-variant-numeric: tabular-nums; }
.position-confirmation { display: block; padding: 10px 12px; border-left: 3px solid var(--ion-color-success); background: rgba(63, 106, 66, 0.1); }
.dialog-actions { justify-content: flex-end; padding-top: 4px; border-top: 1px solid var(--ion-color-light-shade); }
.dialog-action-spacer { flex: 1; }
.message { color: var(--ion-color-danger); }
:global(.facility-modal) { --width: min(640px, calc(100vw - 24px)); --height: min(760px, 92vh); --max-height: 92vh; --border-radius: 10px; }
:global(.facility-modal ion-content) { --background: var(--ion-background-color, #f8f8f2); }
@media (max-width: 560px) {
  .dialog-content { padding: 18px; gap: 14px; }
  .form-row { align-items: stretch; flex-direction: column; }
  .reservation-period { flex-direction: column; }
  .position-section { align-items: stretch; flex-direction: column; }
  .position-section ion-button { width: 100%; }
  .dialog-actions ion-button { flex: 1; }
}
</style>