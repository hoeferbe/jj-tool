<script setup lang="ts">
defineProps<{ year: number }>()
</script>

<template>
  <p class="bkg-attribution">
    Grenzdaten: ©
    <a href="https://www.bkg.bund.de/" target="_blank" rel="noopener noreferrer">BKG</a>
    ({{ year }})
    <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">CC BY 4.0</a>,
    <a
      href="https://sg.geodatenzentrum.de/web_public/gdz/datenquellen/datenquellen_vg25.pdf"
      target="_blank"
      rel="noopener noreferrer"
    >Datenquellen</a>
  </p>
</template>

<style scoped>
.bkg-attribution {
  margin: 6px 0 0;
  color: var(--ion-color-medium-shade, #73757e);
  font-size: 0.72rem;
  line-height: 1.4;
}

.bkg-attribution a {
  color: inherit;
}
</style>
