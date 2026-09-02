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

## Registrierung und E-Mail

- Registrierende können ein Revier auswählen. Der Antrag wird dessen Revieradmins angezeigt.
- Ohne Revierauswahl geht der Antrag an die Systemadministratoren.
- System- und Revieradmins können für administrierte Reviere einmalige, sieben Tage gültige Einladungslinks per E-Mail senden.
- Jede neue Registrierung löst eine Informationsmail an alle aktiven Systemadministratoren aus.
- `SMTP_FROM` enthält die technische Absenderadresse. Mit `SMTP_FROM_NAME=Jagd-App` wird als sichtbarer Absendername „Jagd-App“ verwendet; ohne Angabe ist dieser Name bereits der Standard.

## Geodaten und Lizenz

Die Gemeindegrenzen stammen aus dem BKG-Dienst „WFS Verwaltungsgebiete 1:25 000 - Stand 31.12.“ (`wfs_vg25`). Sie stehen unter [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

Der Quellenvermerk wird in der App bei jeder Grenzdarstellung sichtbar ausgegeben:

> © BKG (Jahr des letzten Datenbezugs) CC BY 4.0, Datenquellen: https://sg.geodatenzentrum.de/web_public/gdz/datenquellen/datenquellen_vg25.pdf

Werden BKG-Grenzen später manuell verändert, muss der Quellenvermerk zusätzlich den Hinweis „Daten verändert“ enthalten.

## Struktur

- `apps/app`: Ionic-Vue-PWA und Capacitor-Client.
- `apps/api`: Hono-API; lokal auf dem Mac mini, spaeter auf dem Raspberry Pi.
- `docs`: Produkt- und Entwicklungsplanung.