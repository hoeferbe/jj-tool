<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue'
import { IonButton, IonContent, IonIcon, IonModal, IonNote, IonSpinner } from '@ionic/vue'
import { closeOutline } from 'ionicons/icons'
import { compressImage, fetchImageObjectUrl } from '../composables/useImageUpload'

interface ImageMeta { id: string; mimeType: string; size: number; createdBy: string; createdByName?: string; createdAt: string }

const props = withDefaults(defineProps<{
  /** API endpoint for this entity's images, e.g. `${apiUrl}/reviere/{revierId}/jagdeinrichtungen/{id}/bilder`. */
  baseUrl: string
  canManage?: boolean
  maxImages?: number
}>(), { canManage: false, maxImages: 3 })

const images = ref<ImageMeta[]>([])
const objectUrls = ref<Record<string, string>>({})
const loading = ref(false)
const uploading = ref(false)
const message = ref('')
const fileInput = ref<HTMLInputElement | null>(null)
const previewImage = ref<ImageMeta | null>(null)

function token() {
  return localStorage.getItem('accessToken') ?? ''
}

function revokeAllObjectUrls() {
  for (const url of Object.values(objectUrls.value)) URL.revokeObjectURL(url)
  objectUrls.value = {}
}

/** Loads this entity's image list and fetches each thumbnail as an authenticated object URL. */
async function loadImages() {
  loading.value = true
  message.value = ''
  try {
    const response = await fetch(props.baseUrl, { headers: { Authorization: `Bearer ${token()}` }, cache: 'no-store' })
    if (!response.ok) throw new Error('Bilder konnten nicht geladen werden.')
    revokeAllObjectUrls()
    images.value = ((await response.json()) as { bilder: ImageMeta[] }).bilder
    await Promise.all(images.value.map(async (image) => {
      objectUrls.value[image.id] = await fetchImageObjectUrl(`${props.baseUrl}/${image.id}/datei`, token())
    }))
  } catch (error) {
    message.value = error instanceof Error ? error.message : 'Bilder konnten nicht geladen werden.'
  } finally {
    loading.value = false
  }
}

/** Compresses the selected file client-side and uploads it as multipart/form-data. */
async function handleFileSelected(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  uploading.value = true
  message.value = ''
  try {
    const compressed = await compressImage(file)
    const form = new FormData()
    form.append('bild', compressed, 'bild.jpg')
    const response = await fetch(props.baseUrl, { method: 'POST', headers: { Authorization: `Bearer ${token()}` }, body: form })
    if (!response.ok) throw new Error(((await response.json()) as { message?: string }).message ?? 'Bild konnte nicht hochgeladen werden.')
    await loadImages()
  } catch (error) {
    message.value = error instanceof Error ? error.message : 'Bild konnte nicht hochgeladen werden.'
  } finally {
    uploading.value = false
    if (fileInput.value) fileInput.value.value = ''
  }
}

async function deleteImage(image: ImageMeta) {
  if (!window.confirm('Dieses Bild wirklich löschen?')) return
  message.value = ''
  try {
    const response = await fetch(`${props.baseUrl}/${image.id}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token()}` } })
    if (!response.ok) throw new Error('Bild konnte nicht gelöscht werden.')
    await loadImages()
  } catch (error) {
    message.value = error instanceof Error ? error.message : 'Bild konnte nicht gelöscht werden.'
  }
}

watch(() => props.baseUrl, loadImages, { immediate: true })
onBeforeUnmount(revokeAllObjectUrls)
</script>

<template>
  <section class="image-gallery">
    <div class="gallery-heading">
      <h3>Bilder</h3>
      <span class="gallery-count">{{ images.length }}/{{ props.maxImages }}</span>
    </div>
    <IonNote v-if="loading">Bilder werden geladen...</IonNote>
    <div v-else-if="images.length" class="gallery-grid">
      <figure v-for="image in images" :key="image.id" class="gallery-item">
        <img :src="objectUrls[image.id]" :alt="`Bild von ${image.createdByName ?? 'Unbekanntes Mitglied'}`" @click="previewImage = image">
        <button v-if="canManage" type="button" class="gallery-delete" title="Bild löschen" @click="deleteImage(image)">✕</button>
      </figure>
    </div>
    <IonNote v-else>Keine Bilder hinterlegt.</IonNote>
    <div v-if="canManage" class="gallery-upload">
      <input ref="fileInput" type="file" accept="image/*" hidden :disabled="uploading || images.length >= props.maxImages" @change="handleFileSelected">
      <IonButton size="small" fill="outline" :disabled="uploading || images.length >= props.maxImages" @click="fileInput?.click()">
        <IonSpinner v-if="uploading" name="dots" slot="start" />
        {{ uploading ? 'Wird hochgeladen...' : 'Bild hinzufügen' }}
      </IonButton>
    </div>
    <p v-if="message" class="gallery-message">{{ message }}</p>
  </section>
  <IonModal class="image-preview-modal" :is-open="Boolean(previewImage)" @did-dismiss="previewImage = null">
    <IonContent class="image-preview-content" @click="previewImage = null">
      <button type="button" class="preview-close" title="Schließen" @click="previewImage = null"><IonIcon :icon="closeOutline" /></button>
      <img v-if="previewImage" :src="objectUrls[previewImage.id]" :alt="`Bild von ${previewImage.createdByName ?? 'Unbekanntes Mitglied'}`" class="preview-image">
    </IonContent>
  </IonModal>
</template>

<style scoped>
.image-gallery { display: flex; flex-direction: column; gap: 8px; padding: 14px; border: 1px solid var(--ion-color-light-shade); border-radius: 8px; }
.gallery-heading { display: flex; align-items: center; justify-content: space-between; }
.gallery-heading h3 { margin: 0; }
.gallery-count { color: var(--ion-color-medium-shade); font-size: 0.85rem; }
.gallery-grid { display: flex; flex-wrap: wrap; gap: 10px; }
.gallery-item { position: relative; margin: 0; width: 96px; height: 96px; overflow: hidden; border-radius: 6px; }
.gallery-item img { display: block; width: 100%; height: 100%; object-fit: cover; cursor: pointer; }
.gallery-delete { position: absolute; top: 2px; right: 2px; width: 22px; height: 22px; border: none; border-radius: 50%; background: rgba(0, 0, 0, 0.6); color: #fff; font-size: 12px; line-height: 1; cursor: pointer; }
.gallery-message { color: var(--ion-color-danger); }
:global(.image-preview-modal) { --width: 100vw; --height: 100vh; --background: rgba(0, 0, 0, 0.9); }
.image-preview-content { --background: transparent; }
.image-preview-content::part(scroll) { display: flex; align-items: center; justify-content: center; }
.preview-image { max-width: 100vw; max-height: 100vh; object-fit: contain; }
.preview-close { position: fixed; top: 12px; right: 12px; z-index: 1; width: 40px; height: 40px; border: none; border-radius: 50%; background: rgba(255, 255, 255, 0.15); color: #fff; font-size: 22px; cursor: pointer; }
</style>
