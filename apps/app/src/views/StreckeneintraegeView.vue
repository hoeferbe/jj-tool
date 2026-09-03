<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { IonButton, IonInput, IonItem, IonList, IonNote, IonSelect, IonSelectOption, IonTextarea } from '@ionic/vue'
import AppLayout from '../components/AppLayout.vue'

interface Revier { id: string; name: string; municipalityName: string }
interface Streckeneintrag {
  id: string
  revierId: string
  datum: string
  wildart: string
  notiz?: string
  createdBy: string
  createdAt: string
}

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8787'
const reviere = ref<Revier[]>([])
const entries = ref<Streckeneintrag[]>([])
const selectedRevierId = ref(localStorage.getItem('jj-member-selected-revier') ?? '')
const loading = ref(true)
const saving = ref(false)
const errorMessage = ref('')
const successMessage = ref('')
const datum = ref(new Date().toISOString().slice(0, 10))
const wildart = ref('')
const notiz = ref('')

const selectedRevier = computed(() => reviere.value.find((revier) => revier.id === selectedRevierId.value) ?? null)

function formatDate(value: string) {
  return new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium' }).format(new Date(`${value}T12:00:00`))
}

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
    entries.value = data.streckeneintraege ?? []
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Streckeneinträge konnten nicht geladen werden.'
  } finally {
    loading.value = false
  }
}

async function loadReviere() {
  const token = localStorage.getItem('accessToken')
  try {
    const response = await fetch(`${apiUrl}/reviere`, { headers: { Authorization: `Bearer ${token}` } })
    const data = await response.json() as { reviere?: Revier[]; message?: string }
    if (!response.ok) throw new Error(data.message ?? 'Reviere konnten nicht geladen werden.')
    reviere.value = data.reviere ?? []
    if (!reviere.value.some((revier) => revier.id === selectedRevierId.value)) {
      selectedRevierId.value = reviere.value[0]?.id ?? ''
    }
    await loadEntries()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Reviere konnten nicht geladen werden.'
    loading.value = false
  }
}

async function selectRevier(revierId: string) {
  selectedRevierId.value = revierId
  localStorage.setItem('jj-member-selected-revier', revierId)
  await loadEntries()
}

async function createEntry() {
  if (!selectedRevierId.value || datum.value.length !== 10 || wildart.value.trim().length < 2) return
  saving.value = true
  errorMessage.value = ''
  successMessage.value = ''
  const token = localStorage.getItem('accessToken')
  try {
    const response = await fetch(`${apiUrl}/reviere/${selectedRevierId.value}/streckeneintraege`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ datum: datum.value, wildart: wildart.value.trim(), notiz: notiz.value.trim() || undefined }),
    })
    const data = await response.json() as { streckeneintrag?: Streckeneintrag; message?: string }
    if (!response.ok || !data.streckeneintrag) throw new Error(data.message ?? 'Streckeneintrag konnte nicht gespeichert werden.')
    entries.value = [data.streckeneintrag, ...entries.value].sort((first, second) => second.datum.localeCompare(first.datum) || second.createdAt.localeCompare(first.createdAt))
    wildart.value = ''
    notiz.value = ''
    successMessage.value = 'Streckeneintrag gespeichert.'
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Streckeneintrag konnte nicht gespeichert werden.'
  } finally {
    saving.value = false
  }
}

onMounted(loadReviere)
</script>

<template>
  <AppLayout>
    <div class="page-content">
      <div class="page-heading">
        <div>
          <h1>Streckeneinträge</h1>
          <p v-if="selectedRevier">{{ selectedRevier.name }} · {{ selectedRevier.municipalityName }}</p>
        </div>
        <IonSelect v-if="reviere.length > 1" :value="selectedRevierId" label="Revier" label-placement="stacked" interface="popover" @ion-change="selectRevier($event.detail.value)">
          <IonSelectOption v-for="revier in reviere" :key="revier.id" :value="revier.id">{{ revier.name }}</IonSelectOption>
        </IonSelect>
      </div>

      <section class="entry-form">
        <h2>Neuer Streckeneintrag</h2>
        <div class="form-row">
          <IonInput v-model="datum" type="date" label="Datum" label-placement="stacked" />
          <IonInput v-model="wildart" label="Wildart" label-placement="stacked" placeholder="z. B. Reh" />
        </div>
        <IonTextarea v-model="notiz" label="Notiz (optional)" label-placement="stacked" :auto-grow="true" placeholder="Weitere Angaben" />
        <IonButton :disabled="saving || !selectedRevierId || datum.length !== 10 || wildart.trim().length < 2" @click="createEntry">
          {{ saving ? 'Speichern...' : 'Streckeneintrag speichern' }}
        </IonButton>
      </section>

      <IonNote v-if="successMessage" color="success">{{ successMessage }}</IonNote>
      <p v-if="errorMessage" class="error-message">{{ errorMessage }}</p>
      <IonNote v-if="loading">Streckeneinträge werden geladen...</IonNote>
      <IonNote v-else-if="!entries.length">Noch keine Streckeneinträge vorhanden.</IonNote>
      <IonList v-else class="entry-list" lines="full">
        <IonItem v-for="entry in entries" :key="entry.id">
          <div>
            <h2>{{ entry.wildart }}</h2>
            <p>{{ formatDate(entry.datum) }}</p>
            <p v-if="entry.notiz">{{ entry.notiz }}</p>
          </div>
        </IonItem>
      </IonList>
    </div>
  </AppLayout>
</template>

<style scoped>
.page-content { padding: 20px; }
.page-heading, .form-row { display: flex; align-items: end; justify-content: space-between; gap: 16px; }
.page-heading h1, .page-heading p { margin: 0 0 4px; }
.entry-form { max-width: 720px; margin: 20px 0 24px; padding: 16px; border: 1px solid var(--ion-color-light-shade); border-radius: 8px; }
.entry-form h2 { margin: 0 0 16px; }
.entry-form ion-input, .entry-form ion-textarea { margin-bottom: 12px; }
.form-row ion-input { flex: 1; min-width: 0; }
.error-message { color: var(--ion-color-danger); }
.entry-list { max-width: 720px; }
.entry-list h2, .entry-list p { margin: 0 0 4px; }
@media (max-width: 600px) { .page-heading, .form-row { align-items: stretch; flex-direction: column; } }
</style>
