<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { IonIcon } from '@ionic/vue'
import { locationSharp } from 'ionicons/icons'

const props = defineProps<{
  position: { lat: number; lng: number }
  label: string
}>()

const imageFailed = ref(false)
const imageUrl = computed(() => {
  const latitudeRadians = props.position.lat * Math.PI / 180
  const metersPerPixel = 156543.03392 * Math.cos(latitudeRadians) / Math.pow(2, 16)
  const halfWidthDegrees = (320 * metersPerPixel / 2) / (111320 * Math.cos(latitudeRadians))
  const halfHeightDegrees = (180 * metersPerPixel / 2) / 110540
  const bbox = [
    props.position.lng - halfWidthDegrees,
    props.position.lat - halfHeightDegrees,
    props.position.lng + halfWidthDegrees,
    props.position.lat + halfHeightDegrees,
  ].join(',')
  const parameters = new URLSearchParams({
    bbox,
    bboxSR: '4326',
    imageSR: '4326',
    size: '320,180',
    format: 'jpg',
    f: 'image',
  })
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?${parameters}`
})

watch(imageUrl, () => { imageFailed.value = false })
</script>

<template>
  <figure class="satellite-thumbnail" :aria-label="label">
    <img v-if="!imageFailed" :src="imageUrl" :alt="label" loading="lazy" @error="imageFailed = true">
    <div v-else class="thumbnail-fallback">Satellitenbild nicht verfügbar</div>
    <IonIcon class="thumbnail-marker" :icon="locationSharp" aria-hidden="true" />
    <figcaption>Satellit · Esri</figcaption>
  </figure>
</template>

<style scoped>
.satellite-thumbnail { position: relative; width: 156px; aspect-ratio: 16 / 9; margin: 0; overflow: hidden; border: 1px solid #aab1a5; border-radius: 6px; background: #dfe3dc; flex: 0 0 auto; }
.satellite-thumbnail img { display: block; width: 100%; height: 100%; object-fit: cover; }
.thumbnail-marker { position: absolute; z-index: 1; top: 50%; left: 50%; width: 25px; height: 25px; color: #e53935; filter: drop-shadow(0 1px 1px #fff) drop-shadow(0 1px 2px rgba(0, 0, 0, 0.65)); transform: translate(-50%, -82%); }
.satellite-thumbnail figcaption { position: absolute; right: 3px; bottom: 2px; padding: 1px 3px; background: rgba(0, 0, 0, 0.64); color: #fff; font-size: 9px; line-height: 1.2; }
.thumbnail-fallback { display: grid; height: 100%; place-items: center; padding: 8px; color: #5f665c; font-size: 0.75rem; text-align: center; }
</style>