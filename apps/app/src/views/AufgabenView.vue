<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { IonBadge, IonButton, IonItem, IonList, IonNote, IonSelect, IonSelectOption, IonTextarea } from '@ionic/vue'
import AppLayout from '../components/AppLayout.vue'

interface Revier { id: string; name: string; municipalityName: string }
interface Member { id: string; displayName: string }
interface CurrentUser { id: string; accountType: 'systemAdmin' | 'member'; memberships: Array<{ revierId: string; status: 'active' | 'pending'; isAdmin: boolean }> }
interface Task {
  id: string
  revierId: string
  titel: string
  beschreibung?: string
  faelligAm?: string
  prioritaet?: 'niedrig' | 'normal' | 'hoch'
  status: 'offen' | 'in Bearbeitung' | 'erledigt'
  assignedTo?: string
  assignedBy: string
  jagdeinrichtungId?: string
}

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8787'
const reviere = ref<Revier[]>([])
const members = ref<Member[]>([])
const tasks = ref<Task[]>([])
const selectedRevierId = ref(localStorage.getItem('jj-member-selected-revier') ?? '')
const currentUser = ref<CurrentUser | null>(null)
const loading = ref(true)
const saving = ref(false)
const errorMessage = ref('')
const showCompleted = ref(false)
const editingTask = ref<Task | null>(null)
const draft = ref({ titel: '', beschreibung: '', faelligAm: '', prioritaet: 'normal' as NonNullable<Task['prioritaet']>, assignedTo: '' })

const selectedRevier = computed(() => reviere.value.find((revier) => revier.id === selectedRevierId.value) ?? null)
const currentUserId = computed(() => currentUser.value?.id ?? '')
const canAdministerSelectedRevier = computed(() => currentUser.value?.accountType === 'systemAdmin'
  || currentUser.value?.memberships.some((membership) => membership.revierId === selectedRevierId.value && membership.status === 'active' && membership.isAdmin) === true)
const generalTasks = computed(() => tasks.value.filter((task) => !task.jagdeinrichtungId))
const openTasks = computed(() => generalTasks.value
  .filter((task) => task.status !== 'erledigt')
  .sort((left, right) => priorityRank(right.prioritaet) - priorityRank(left.prioritaet)
    || (left.faelligAm ?? '9999-12-31').localeCompare(right.faelligAm ?? '9999-12-31')))
const completedTasks = computed(() => generalTasks.value.filter((task) => task.status === 'erledigt'))

function priorityRank(priority?: Task['prioritaet']) {
  return priority === 'hoch' ? 3 : priority === 'niedrig' ? 1 : 2
}

function priorityLabel(priority?: Task['prioritaet']) {
  return priority === 'hoch' ? 'Hoch' : priority === 'niedrig' ? 'Niedrig' : 'Normal'
}

function priorityColor(priority?: Task['prioritaet']) {
  return priority === 'hoch' ? 'danger' : priority === 'niedrig' ? 'medium' : 'warning'
}

function memberName(id?: string) {
  return members.value.find((member) => member.id === id)?.displayName ?? 'Alle Mitglieder'
}

function canManageTask(task: Task) {
  return task.assignedTo === currentUserId.value || task.assignedBy === currentUserId.value || canAdministerSelectedRevier.value
}

function formatDueDate(value?: string) {
  if (!value) return 'Keine Fälligkeit'
  return `Fällig ${new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' }).format(new Date(`${value}T12:00:00`))}`
}

function resetDraft() {
  editingTask.value = null
  draft.value = { titel: '', beschreibung: '', faelligAm: '', prioritaet: 'normal', assignedTo: '' }
}

function editTask(task: Task) {
  editingTask.value = task
  draft.value = {
    titel: task.titel,
    beschreibung: task.beschreibung ?? '',
    faelligAm: task.faelligAm ?? '',
    prioritaet: task.prioritaet ?? 'normal',
    assignedTo: task.assignedTo ?? '',
  }
}

async function loadTaskData() {
  if (!selectedRevierId.value) return
  loading.value = true
  errorMessage.value = ''
  const token = localStorage.getItem('accessToken')
  const headers = { Authorization: `Bearer ${token}` }
  try {
    const [tasksResponse, membersResponse] = await Promise.all([
      fetch(`${apiUrl}/reviere/${selectedRevierId.value}/jagdeinrichtungs-aufgaben`, { headers, cache: 'no-store' }),
      fetch(`${apiUrl}/reviere/${selectedRevierId.value}/members`, { headers, cache: 'no-store' }),
    ])
    if (!tasksResponse.ok || !membersResponse.ok) throw new Error('Aufgaben konnten nicht geladen werden.')
    tasks.value = ((await tasksResponse.json()) as { aufgaben: Task[] }).aufgaben
    members.value = ((await membersResponse.json()) as { members: Member[] }).members
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Aufgaben konnten nicht geladen werden.'
  } finally {
    loading.value = false
  }
}

async function loadReviere() {
  const token = localStorage.getItem('accessToken')
  const headers = { Authorization: `Bearer ${token}` }
  try {
    const [reviereResponse, userResponse] = await Promise.all([
      fetch(`${apiUrl}/reviere`, { headers, cache: 'no-store' }),
      fetch(`${apiUrl}/auth/me`, { headers, cache: 'no-store' }),
    ])
    if (!reviereResponse.ok || !userResponse.ok) throw new Error('Revierdaten konnten nicht geladen werden.')
    reviere.value = ((await reviereResponse.json()) as { reviere: Revier[] }).reviere
    currentUser.value = ((await userResponse.json()) as { user: CurrentUser }).user
    if (!reviere.value.some((revier) => revier.id === selectedRevierId.value)) {
      selectedRevierId.value = reviere.value[0]?.id ?? ''
      if (selectedRevierId.value) localStorage.setItem('jj-member-selected-revier', selectedRevierId.value)
    }
    await loadTaskData()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Revierdaten konnten nicht geladen werden.'
    loading.value = false
  }
}

async function selectRevier(revierId: string) {
  selectedRevierId.value = revierId
  localStorage.setItem('jj-member-selected-revier', revierId)
  resetDraft()
  await loadTaskData()
}

async function saveTask() {
  if (!selectedRevierId.value || draft.value.titel.trim().length < 2) return
  saving.value = true
  errorMessage.value = ''
  const token = localStorage.getItem('accessToken')
  const endpoint = editingTask.value
    ? `${apiUrl}/reviere/${selectedRevierId.value}/jagdeinrichtungs-aufgaben/${editingTask.value.id}`
    : `${apiUrl}/reviere/${selectedRevierId.value}/jagdeinrichtungs-aufgaben`
  try {
    const response = await fetch(endpoint, {
      method: editingTask.value ? 'PATCH' : 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        titel: draft.value.titel.trim(),
        beschreibung: draft.value.beschreibung.trim() || (editingTask.value ? null : undefined),
        faelligAm: draft.value.faelligAm || (editingTask.value ? null : undefined),
        prioritaet: draft.value.prioritaet,
        assignedTo: draft.value.assignedTo || (editingTask.value ? null : undefined),
      }),
    })
    if (!response.ok) throw new Error(((await response.json()) as { message?: string }).message ?? 'Aufgabe konnte nicht gespeichert werden.')
    resetDraft()
    await loadTaskData()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Aufgabe konnte nicht gespeichert werden.'
  } finally {
    saving.value = false
  }
}

async function updateTask(task: Task, path: string, method: 'PATCH' | 'POST', body?: Record<string, string>) {
  const token = localStorage.getItem('accessToken')
  const response = await fetch(`${apiUrl}/reviere/${selectedRevierId.value}/jagdeinrichtungs-aufgaben/${task.id}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!response.ok) {
    errorMessage.value = ((await response.json()) as { message?: string }).message ?? 'Aufgabe konnte nicht aktualisiert werden.'
    return
  }
  await loadTaskData()
}

onMounted(loadReviere)
</script>

<template>
  <AppLayout>
    <div class="tasks-page">
      <header class="page-heading">
        <div><h1>Revieraufgaben</h1><p v-if="selectedRevier">{{ selectedRevier.name }} · {{ selectedRevier.municipalityName }}</p></div>
        <IonSelect v-if="reviere.length > 1" :value="selectedRevierId" label="Revier" label-placement="stacked" interface="popover" @ion-change="selectRevier($event.detail.value)">
          <IonSelectOption v-for="revier in reviere" :key="revier.id" :value="revier.id">{{ revier.name }}</IonSelectOption>
        </IonSelect>
      </header>

      <p v-if="errorMessage" class="error-message">{{ errorMessage }}</p>
      <section class="task-editor">
        <h2>{{ editingTask ? 'Aufgabe bearbeiten' : 'Neue Aufgabe' }}</h2>
        <label class="field"><span>Titel</span><input v-model="draft.titel" type="text" maxlength="160"></label>
        <IonTextarea v-model="draft.beschreibung" label="Beschreibung" label-placement="stacked" :auto-grow="true" />
        <div class="editor-row">
          <label class="field"><span>Fällig am</span><input v-model="draft.faelligAm" type="date"></label>
          <label class="field"><span>Priorität</span><select v-model="draft.prioritaet"><option value="niedrig">Niedrig</option><option value="normal">Normal</option><option value="hoch">Hoch</option></select></label>
          <IonSelect v-model="draft.assignedTo" label="Zuständig" label-placement="stacked" interface="popover">
            <IonSelectOption value="">Alle Mitglieder</IonSelectOption>
            <IonSelectOption v-for="member in members" :key="member.id" :value="member.id">{{ member.displayName }}</IonSelectOption>
          </IonSelect>
        </div>
        <div class="editor-actions">
          <IonButton v-if="editingTask" fill="clear" @click="resetDraft">Abbrechen</IonButton>
          <IonButton :disabled="saving || draft.titel.trim().length < 2" @click="saveTask">{{ saving ? 'Speichern...' : 'Speichern' }}</IonButton>
        </div>
      </section>

      <IonNote v-if="loading">Aufgaben werden geladen...</IonNote>
      <section v-else class="task-section">
        <div class="section-title"><h2>Offene Aufgaben</h2><IonBadge color="medium">{{ openTasks.length }}</IonBadge></div>
        <IonNote v-if="!openTasks.length">Keine offenen Revieraufgaben.</IonNote>
        <IonList v-else lines="none" class="task-list">
          <IonItem v-for="task in openTasks" :key="task.id" class="task-item">
            <div class="task-content">
              <div class="task-title"><h3>{{ task.titel }}</h3><IonBadge :color="priorityColor(task.prioritaet)">{{ priorityLabel(task.prioritaet) }}</IonBadge></div>
              <p v-if="task.beschreibung">{{ task.beschreibung }}</p>
              <div class="task-meta"><span>{{ formatDueDate(task.faelligAm) }}</span><span>{{ task.assignedTo ? `Zuständig: ${memberName(task.assignedTo)}` : 'Für alle Mitglieder' }}</span><span>{{ task.status }}</span></div>
              <div class="task-actions">
                <IonButton v-if="!task.assignedTo" size="small" fill="outline" @click="updateTask(task, '/uebernehmen', 'POST')">Übernehmen</IonButton>
                <IonButton v-if="canManageTask(task)" size="small" @click="updateTask(task, '', 'PATCH', { status: 'erledigt' })">Erledigt</IonButton>
                <IonButton v-if="canManageTask(task)" size="small" fill="clear" @click="editTask(task)">Bearbeiten</IonButton>
              </div>
            </div>
          </IonItem>
        </IonList>
      </section>

      <section v-if="completedTasks.length" class="task-section">
        <IonButton fill="clear" @click="showCompleted = !showCompleted">{{ showCompleted ? 'Erledigte ausblenden' : `Erledigte anzeigen (${completedTasks.length})` }}</IonButton>
        <IonList v-if="showCompleted" lines="none" class="task-list completed-list">
          <IonItem v-for="task in completedTasks" :key="task.id"><IonLabel><h3>{{ task.titel }}</h3><p>{{ priorityLabel(task.prioritaet) }} · {{ memberName(task.assignedTo) }}</p></IonLabel></IonItem>
        </IonList>
      </section>
    </div>
  </AppLayout>
</template>

<style scoped>
.tasks-page { width: min(960px, calc(100% - 32px)); margin: 0 auto; padding: 24px 0 40px; }
.page-heading, .section-title, .task-title, .editor-actions { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.page-heading { align-items: end; margin-bottom: 20px; }
.page-heading h1, .page-heading p, .task-editor h2, .section-title h2, .task-title h3 { margin: 0; }
.page-heading p { margin-top: 4px; color: var(--ion-color-medium-shade); }
.task-editor { display: grid; gap: 14px; padding: 18px; border: 1px solid var(--ion-color-light-shade); border-radius: 8px; background: var(--ion-color-light, #f4f5f0); }
.editor-row { display: grid; grid-template-columns: minmax(150px, 1fr) minmax(150px, 1fr) minmax(190px, 1.2fr); gap: 12px; align-items: end; }
.field { display: grid; gap: 5px; font-size: 0.9rem; }
.field input, .field select { width: 100%; min-height: 46px; box-sizing: border-box; padding: 8px 11px; border: 1px solid #adb4a9; border-radius: 6px; background: #fff; font: inherit; }
.editor-actions { justify-content: flex-end; }
.task-section { margin-top: 24px; }
.section-title { justify-content: flex-start; margin-bottom: 10px; }
.task-list { display: grid; gap: 10px; background: transparent; }
.task-item { --background: #fff; --padding-start: 14px; --inner-padding-end: 14px; border: 1px solid var(--ion-color-light-shade); border-radius: 8px; }
.task-content { width: 100%; padding: 12px 0; }
.task-title { justify-content: flex-start; }
.task-content p { margin: 8px 0; }
.task-meta, .task-actions { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; }
.task-meta { color: var(--ion-color-medium-shade); font-size: 0.88rem; }
.task-actions { margin-top: 10px; }
.completed-list { opacity: 0.78; }
.error-message { color: var(--ion-color-danger); }
@media (max-width: 680px) {
  .page-heading { align-items: stretch; flex-direction: column; }
  .editor-row { grid-template-columns: 1fr; }
}
</style>