<script setup lang="ts">
import { ref, watch } from 'vue'
import { IonButton, IonContent, IonModal, IonNote } from '@ionic/vue'

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

const props = withDefaults(defineProps<{
  isOpen: boolean
  revierId: string
  center: Point
  facility?: Jagdeinrichtung | null
  position?: Point
  positionWasSelected?: boolean
}>(), {})
const emit = defineEmits<{
  close: []
  created: [facility: Jagdeinrichtung]
  updated: [facility: Jagdeinrichtung]
  repositionRequested: [facility: Jagdeinrichtung]
}>()
const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8787'
const name = ref('')
const typ = ref<Jagdeinrichtung['typ']>('Kanzel')
const status = ref<Jagdeinrichtung['status']>('aktiv')
const zustandsInfo = ref('')
const notiz = ref('')
const position = ref<Point>({ ...(props.position ?? props.center) })
const saving = ref(false)
const message = ref('')

function reset() {
  name.value = props.facility?.name ?? ''
  typ.value = props.facility?.typ ?? 'Kanzel'
  status.value = props.facility?.status ?? 'aktiv'
  zustandsInfo.value = props.facility?.zustandsInfo ?? ''
  notiz.value = props.facility?.notiz ?? ''
  position.value = props.facility ? { ...props.facility.position } : { ...(props.position ?? props.center) }
  message.value = ''
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

function close() {
  emit('close')
}

watch(() => props.isOpen, (isOpen) => { if (isOpen) reset() })
</script>

<template>
  <IonModal class="facility-modal" :is-open="props.isOpen" :backdrop-dismiss="false" @did-dismiss="close">
    <IonContent class="dialog-scroll">
      <div class="dialog-content">
      <div class="dialog-heading">
        <h2>{{ props.facility ? 'Jagdeinrichtung bearbeiten' : 'Jagdeinrichtung anlegen' }}</h2>
      </div>
      <section class="form-section">
        <label class="field-label">
          <span>Bezeichnung</span>
          <input v-model="name" class="form-control" type="text" placeholder="z. B. Kanzel Nord">
        </label>
        <div class="form-row">
          <label class="field-label">
            <span>Typ</span>
            <select v-model="typ" class="form-control">
              <option value="Kanzel">Kanzel</option>
              <option value="Bock">Bock</option>
              <option value="Leiter">Leiter</option>
              <option value="Roehrenfalle">Röhrenfalle</option>
              <option value="Kirrung">Kirrung</option>
            </select>
          </label>
          <label class="field-label">
            <span>Status</span>
            <select v-model="status" class="form-control status-control" :class="`status-${status.replace(' ', '-')}`">
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
          <span>Zustandsinfo</span>
          <textarea v-model="zustandsInfo" class="form-control textarea-control" rows="2" placeholder="z. B. Tür klemmt, Wespen vorhanden"></textarea>
        </label>
        <label class="field-label">
          <span>Notiz</span>
          <textarea v-model="notiz" class="form-control textarea-control" rows="2"></textarea>
        </label>
      </section>
      <section class="position-section">
        <div>
          <h3>Position</h3>
          <span class="coordinates">{{ position.lat.toFixed(6) }}, {{ position.lng.toFixed(6) }}</span>
        </div>
        <IonButton v-if="props.facility" fill="outline" size="small" @click="emit('repositionRequested', props.facility)">Auf Karte wählen</IonButton>
      </section>
      <IonNote v-if="props.positionWasSelected" class="position-confirmation" color="success">Neue Position übernommen. Bitte mit „Speichern“ bestätigen.</IonNote>
      <p v-if="message" class="message">{{ message }}</p>
      <div class="dialog-actions">
        <IonButton fill="clear" :disabled="saving" @click="close">Abbrechen</IonButton>
        <IonButton :disabled="saving || name.trim().length < 2" @click="saveFacility">{{ saving ? 'Speichern...' : 'Speichern' }}</IonButton>
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
.position-section h3 { margin-bottom: 5px; font-size: 0.95rem; }
.coordinates { color: var(--ion-color-medium-shade); font-variant-numeric: tabular-nums; }
.position-confirmation { display: block; padding: 10px 12px; border-left: 3px solid var(--ion-color-success); background: rgba(63, 106, 66, 0.1); }
.dialog-actions { justify-content: flex-end; padding-top: 4px; border-top: 1px solid var(--ion-color-light-shade); }
.message { color: var(--ion-color-danger); }
:global(.facility-modal) { --width: min(640px, calc(100vw - 24px)); --height: min(760px, 92vh); --max-height: 92vh; --border-radius: 10px; }
:global(.facility-modal ion-content) { --background: var(--ion-background-color, #f8f8f2); }
@media (max-width: 560px) {
  .dialog-content { padding: 18px; gap: 14px; }
  .form-row { align-items: stretch; flex-direction: column; }
  .position-section { align-items: stretch; flex-direction: column; }
  .position-section ion-button { width: 100%; }
  .dialog-actions ion-button { flex: 1; }
}
</style>