# jj-tool

Jagdgruppen-App mit Ionic Vue als Client und Hono als API.

## Voraussetzungen

- Node.js 22 oder neuer
- npm 10 oder neuer

Die im System derzeit vorhandene Node.js-Version 14 ist nicht ausreichend.

## Entwicklung starten

```sh
npm install
npm run dev:api
npm run dev:app
```

Die API ist danach unter `http://localhost:8787` und die App unter der von Vite ausgegebenen lokalen Adresse erreichbar.

## Struktur

- `apps/app`: Ionic-Vue-PWA und Capacitor-Client.
- `apps/api`: Hono-API; lokal auf dem Mac mini, spaeter auf dem Raspberry Pi.
- `docs`: Produkt- und Entwicklungsplanung.