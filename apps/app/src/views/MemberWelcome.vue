<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { IonBadge, IonButton, IonNote, IonSelect, IonSelectOption } from '@ionic/vue'
import AppLayout from '../components/AppLayout.vue'
import NewJagdeinrichtungDialog from '../components/NewJagdeinrichtungDialog.vue'
import NewRevierDialog from '../components/NewRevierDialog.vue'
import RevierMap from '../components/RevierMap.vue'

defineProps<{ section: 'map' | 'members' }>()

interface Revier {
  id: string
  name: string
  municipalityName: string
  center: { lat: number; lng: number }
  createdAt: string
  boundary: {
    type: 'FeatureCollection'
    features: Array<{
      type: 'Feature'
      properties?: Record<string, unknown>
      geometry: { type: string; coordinates: unknown }
    }>
  }
}

interface RevierMember {
  id: string
  displayName: string
  memberType: 'paechter' | 'bgs' | 'guest' | 'member'
  position?: 'revierleiter' | 'kassenwart' | 'schriftfuehrer'
}

interface CurrentUser {
  accountType: 'systemAdmin' | 'member'
  memberships: Array<{
    revierId: string
    status: 'active' | 'pending'
    memberType: 'paechter' | 'bgs' | 'guest'
    isAdmin: boolean
  }>
}

interface Jagdeinrichtung {
  id: string
  revierId: string
  name: string
  typ: 'Kanzel' | 'Bock' | 'Leiter' | 'Roehrenfalle' | 'Kirrung'
  position: { lat: number; lng: number }
  status: 'aktiv' | 'defekt' | 'ausser Betrieb'
  zustandsInfo?: string
  notiz?: string
  createdBy: string
  createdAt: string
  updatedAt: string
}

const MEMBER_TYPE_LABELS = { paechter: 'Pächter', bgs: 'BGS', guest: 'Gast', member: 'Mitglied' }
const POSITION_LABELS = {
  revierleiter: 'Revierleiter',
  kassenwart: 'Kassenwart',
  schriftfuehrer: 'Schriftführer',
}

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:8787'
const reviere = ref<Revier[]>([])
const selectedRevierId = ref(localStorage.getItem('jj-member-selected-revier') ?? '')
const loading = ref(true)
const errorMessage = ref('')
const members = ref<RevierMember[]>([])
const membersLoading = ref(false)
const facilities = ref<Jagdeinrichtung[]>([])
const facilitiesLoading = ref(false)
const currentUser = ref<CurrentUser | null>(null)
const showNewRevierDialog = ref(false)
const showNewFacilityDialog = ref(false)
const editingFacility = ref<Jagdeinrichtung | null>(null)
const newFacilityPosition = ref<{ lat: number; lng: number } | null>(null)
const positioningFacilityId = ref<string | null>(null)
const preservePositioningMode = ref(false)
const placementMessage = ref('')
const positionWasSelected = ref(false)
const selectedRevier = computed(() =>
  reviere.value.find((revier) => revier.id === selectedRevierId.value) ?? null,
)
const canCreateFacilities = computed(() => {
  if (currentUser.value?.accountType === 'systemAdmin') return true
  return currentUser.value?.memberships.some((membership) =>
    membership.revierId === selectedRevierId.value &&
    membership.status === 'active' &&
    (membership.isAdmin || membership.memberType === 'paechter' || membership.memberType === 'bgs'),
  ) === true
})

function handleCreatedRevier(revier: Revier) {
  reviere.value = [...reviere.value, revier]
  selectRevier(revier.id)
}

async function handleCreatedFacility() {
  await selectRevier(selectedRevierId.value)
}

function handleUpdatedFacility(facility: Jagdeinrichtung) {
  facilities.value = facilities.value.map((entry) => entry.id === facility.id ? facility : entry)
  editingFacility.value = null
}

function openNewFacilityAtPosition(position: { lat: number; lng: number }) {
  editingFacility.value = null
  positioningFacilityId.value = null
  facilityPlacementMode.value = false
  placementMessage.value = ''
  positionWasSelected.value = false
  newFacilityPosition.value = position
  showNewFacilityDialog.value = true
}

const facilityPlacementMode = ref(false)

function startNewFacilityPlacement() {
  editingFacility.value = null
  positioningFacilityId.value = null
  facilityPlacementMode.value = true
  placementMessage.value = ''
}

function cancelFacilityPlacement() {
  positioningFacilityId.value = null
  facilityPlacementMode.value = false
  placementMessage.value = ''
}

function rejectFacilityPosition() {
  placementMessage.value = 'Einrichtungen können nur innerhalb der Reviergrenze angelegt oder verschoben werden.'
}

async function repositionFacility(selection: { position: { lat: number; lng: number }; facilityId?: string }) {
  if (!selection.facilityId) return openNewFacilityAtPosition(selection.position)
  const facility = facilities.value.find((entry) => entry.id === selection.facilityId)
  if (!facility) return
  editingFacility.value = { ...facility, position: selection.position }
  newFacilityPosition.value = selection.position
  positioningFacilityId.value = null
  facilityPlacementMode.value = false
  placementMessage.value = ''
  positionWasSelected.value = true
  showNewFacilityDialog.value = true
}

function openEditFacility(facility: Jagdeinrichtung) {
  positioningFacilityId.value = null
  facilityPlacementMode.value = false
  positionWasSelected.value = false
  editingFacility.value = facility
  showNewFacilityDialog.value = true
}

function startRepositioning(facility: Jagdeinrichtung) {
  preservePositioningMode.value = true
  positioningFacilityId.value = facility.id
  facilityPlacementMode.value = true
  showNewFacilityDialog.value = false
}

function closeFacilityDialog() {
  showNewFacilityDialog.value = false
  editingFacility.value = null
  newFacilityPosition.value = null
  positionWasSelected.value = false
  if (preservePositioningMode.value) preservePositioningMode.value = false
  else {
    positioningFacilityId.value = null
    facilityPlacementMode.value = false
  }
}

async function selectRevier(revierId: string) {
  selectedRevierId.value = revierId
  localStorage.setItem('jj-member-selected-revier', revierId)
  members.value = []
  facilities.value = []
  if (!revierId) return
  membersLoading.value = true
  facilitiesLoading.value = true
  const token = localStorage.getItem('accessToken')
  try {
    const headers = { Authorization: `Bearer ${token}` }
    const [membersResponse, facilitiesResponse] = await Promise.all([
      fetch(`${apiUrl}/reviere/${revierId}/members`, { headers, cache: 'no-store' }),
      fetch(`${apiUrl}/reviere/${revierId}/jagdeinrichtungen`, { headers, cache: 'no-store' }),
    ])
    if (!membersResponse.ok) throw new Error('Mitglieder konnten nicht geladen werden.')
    if (!facilitiesResponse.ok) throw new Error('Jagdeinrichtungen konnten nicht geladen werden.')
    members.value = ((await membersResponse.json()) as { members: RevierMember[] }).members
    facilities.value = ((await facilitiesResponse.json()) as { jagdeinrichtungen: Jagdeinrichtung[] }).jagdeinrichtungen
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Mitglieder konnten nicht geladen werden.'
  } finally {
    membersLoading.value = false
    facilitiesLoading.value = false
  }
}

onMounted(async () => {
  const token = localStorage.getItem('accessToken')
  try {
    const headers = { Authorization: `Bearer ${token}` }
    const [response, userResponse] = await Promise.all([
      fetch(`${apiUrl}/reviere`, { headers, cache: 'no-store' }),
      fetch(`${apiUrl}/auth/me`, { headers, cache: 'no-store' }),
    ])
    if (!response.ok) throw new Error('Reviere konnten nicht geladen werden.')
    reviere.value = ((await response.json()) as { reviere: Revier[] }).reviere
    if (userResponse.ok) currentUser.value = ((await userResponse.json()) as { user: CurrentUser }).user
    if (!reviere.value.some((revier) => revier.id === selectedRevierId.value)) {
      await selectRevier(reviere.value[0]?.id ?? '')
    } else {
      await selectRevier(selectedRevierId.value)
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Reviere konnten nicht geladen werden.'
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <AppLayout>
    <div class="ion-padding">
      <section v-if="section === 'map'" class="revier-section">
        <div class="section-heading">
          <div>
            <h2>Revierkarte</h2>
            <p v-if="selectedRevier">{{ selectedRevier.name }} · Gemeinde {{ selectedRevier.municipalityName }}</p>
          </div>
          <IonSelect
            v-if="reviere.length > 1"
            :value="selectedRevierId"
            label="Revier auswählen"
            label-placement="stacked"
            interface="popover"
            @ion-change="selectRevier($event.detail.value)"
          >
            <IonSelectOption v-for="revier in reviere" :key="revier.id" :value="revier.id">
              {{ revier.name }}
            </IonSelectOption>
          </IonSelect>
          <IonButton size="small" fill="outline" @click="showNewRevierDialog = true">Neues Revier</IonButton>
          <IonNote v-if="positioningFacilityId" class="map-hint">Einrichtung: Position wählen · Esc zum Abbrechen</IonNote>
          <IonNote v-else-if="selectedRevier && canCreateFacilities" class="map-hint">⌘-/Ctrl-Klick oder + auf der Karte: Einrichtung anlegen</IonNote>
        </div>
        <IonNote v-if="loading">Reviere werden geladen...</IonNote>
        <p v-else-if="errorMessage" class="error-message">{{ errorMessage }}</p>
        <IonNote v-else-if="!selectedRevier">Dir ist noch kein aktives Revier zugeordnet.</IonNote>
        <RevierMap
          v-else
          :boundary="selectedRevier.boundary"
          :source-year="new Date(selectedRevier.createdAt).getFullYear()"
          :facilities="facilities"
          :can-create-facilities="canCreateFacilities"
          :positioning-facility-id="positioningFacilityId"
          :facility-placement-mode="facilityPlacementMode"
          @facility-selected="openEditFacility"
          @facility-position-selected="repositionFacility"
          @facility-placement-requested="startNewFacilityPlacement"
          @facility-placement-cancelled="cancelFacilityPlacement"
          @facility-position-rejected="rejectFacilityPosition"
        />
        <p v-if="placementMessage" class="placement-error">{{ placementMessage }}</p>
        <IonNote v-if="facilitiesLoading">Jagdeinrichtungen werden geladen...</IonNote>
      </section>
      <NewRevierDialog
        :is-open="showNewRevierDialog"
        @close="showNewRevierDialog = false"
        @created="handleCreatedRevier"
      />
      <NewJagdeinrichtungDialog
        v-if="selectedRevier"
        :is-open="showNewFacilityDialog"
        :revier-id="selectedRevier.id"
        :center="selectedRevier.center"
        :position="newFacilityPosition ?? selectedRevier.center"
        :facility="editingFacility"
        :position-was-selected="positionWasSelected"
        @close="closeFacilityDialog"
        @created="handleCreatedFacility"
        @updated="handleUpdatedFacility"
        @reposition-requested="startRepositioning"
      />

      <section v-if="section === 'members'" class="member-section">
        <div class="section-heading">
          <div>
            <h2>Reviermitglieder</h2>
            <p v-if="selectedRevier">{{ selectedRevier.name }} · Gemeinde {{ selectedRevier.municipalityName }}</p>
          </div>
          <IonSelect
            v-if="reviere.length > 1"
            :value="selectedRevierId"
            label="Revier auswählen"
            label-placement="stacked"
            interface="popover"
            @ion-change="selectRevier($event.detail.value)"
          >
            <IonSelectOption v-for="revier in reviere" :key="revier.id" :value="revier.id">{{ revier.name }}</IonSelectOption>
          </IonSelect>
        </div>
        <IonNote v-if="membersLoading">Mitglieder werden geladen...</IonNote>
        <IonNote v-else-if="!selectedRevier">Dir ist noch kein aktives Revier zugeordnet.</IonNote>
        <IonNote v-else-if="!members.length">Keine aktiven Mitglieder vorhanden.</IonNote>
        <div v-else class="member-list">
          <div v-for="member in members" :key="member.id" class="member-entry">
            <strong>{{ member.displayName }}</strong>
            <div class="member-labels">
              <IonBadge color="medium">{{ MEMBER_TYPE_LABELS[member.memberType] }}</IonBadge>
              <IonBadge v-if="member.position" color="light">{{ POSITION_LABELS[member.position] }}</IonBadge>
            </div>
          </div>
        </div>
      </section>
    </div>
  </AppLayout>
</template>

<style scoped>
.revier-section {
  margin-top: 0;
}

.section-heading {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
}

.section-heading h2,
.section-heading p {
  margin: 0 0 4px;
}

.section-heading ion-select {
  width: min(280px, 100%);
}

.error-message {
  color: var(--ion-color-danger);
}

.placement-error {
  margin: 8px 0;
  color: var(--ion-color-danger);
  font-weight: 600;
}

.member-section {
  margin-top: 0;
}

.member-section h2 {
  margin-bottom: 12px;
}

.member-list {
  border: 1px solid var(--ion-color-light-shade, #dfe6dd);
  border-radius: 8px;
  overflow: hidden;
}

.member-entry {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--ion-color-light-shade, #dfe6dd);
}

.member-entry:last-child {
  border-bottom: 0;
}

.member-labels {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

@media (max-width: 560px) {
  .section-heading {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
