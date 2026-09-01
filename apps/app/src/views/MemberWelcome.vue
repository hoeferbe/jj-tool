<script setup lang="ts">
import { IonCard, IonCardContent, IonCardHeader, IonCardTitle, IonNote } from '@ionic/vue'
import AppLayout from '../components/AppLayout.vue'

// Values are set at login time and stored in localStorage for persistence across page reloads.
const displayName = localStorage.getItem('displayName') ?? 'Mitglied'
const previousLoginAt = localStorage.getItem('previousLoginAt')

// Format the stored ISO timestamp for human-readable display in German locale.
const formattedLastLogin = previousLoginAt
  ? new Date(previousLoginAt).toLocaleString('de-DE', { dateStyle: 'long', timeStyle: 'short' })
  : null
</script>

<template>
  <AppLayout>
    <div class="ion-padding">
      <IonCard>
        <IonCardHeader>
          <IonCardTitle>Willkommen, {{ displayName }}!</IonCardTitle>
        </IonCardHeader>
        <IonCardContent>
          <IonNote v-if="formattedLastLogin">Zuletzt aktiv: {{ formattedLastLogin }}</IonNote>
          <IonNote v-else>Das war deine erste Anmeldung.</IonNote>
        </IonCardContent>
      </IonCard>
    </div>
  </AppLayout>
</template>
