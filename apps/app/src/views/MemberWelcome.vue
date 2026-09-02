<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { IonBadge, IonButton, IonNote, IonSelect, IonSelectOption } from '@ionic/vue'
import AppLayout from '../components/AppLayout.vue'
import NewRevierDialog from '../components/NewRevierDialog.vue'
import RevierMap from '../components/RevierMap.vue'

defineProps<{ section: 'map' | 'members' }>()

interface Revier {
  id: string
  name: string
  municipalityName: string
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
const showNewRevierDialog = ref(false)
const selectedRevier = computed(() =>
  reviere.value.find((revier) => revier.id === selectedRevierId.value) ?? null,
)

function handleCreatedRevier(revier: Revier) {
  reviere.value = [...reviere.value, revier]
  selectRevier(revier.id)
}

async function selectRevier(revierId: string) {
  selectedRevierId.value = revierId
  localStorage.setItem('jj-member-selected-revier', revierId)
  members.value = []
  if (!revierId) return
  membersLoading.value = true
  const token = localStorage.getItem('accessToken')
  try {
    const response = await fetch(`${apiUrl}/reviere/${revierId}/members`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
    if (!response.ok) throw new Error('Mitglieder konnten nicht geladen werden.')
    members.value = ((await response.json()) as { members: RevierMember[] }).members
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Mitglieder konnten nicht geladen werden.'
  } finally {
    membersLoading.value = false
  }
}

onMounted(async () => {
  const token = localStorage.getItem('accessToken')
  try {
    const response = await fetch(`${apiUrl}/reviere`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })
    if (!response.ok) throw new Error('Reviere konnten nicht geladen werden.')
    reviere.value = ((await response.json()) as { reviere: Revier[] }).reviere
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
        </div>
        <IonNote v-if="loading">Reviere werden geladen...</IonNote>
        <p v-else-if="errorMessage" class="error-message">{{ errorMessage }}</p>
        <IonNote v-else-if="!selectedRevier">Dir ist noch kein aktives Revier zugeordnet.</IonNote>
        <RevierMap
          v-else
          :boundary="selectedRevier.boundary"
          :source-year="new Date(selectedRevier.createdAt).getFullYear()"
        />
      </section>
      <NewRevierDialog
        :is-open="showNewRevierDialog"
        @close="showNewRevierDialog = false"
        @created="handleCreatedRevier"
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
