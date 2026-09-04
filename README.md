# Mein Jagdrevier

Mein Jagdrevier mit Ionic Vue als Client und Hono als API. Die Anwendung verwaltet geschlossene Reviergruppen, Reviergrenzen, Jagdeinrichtungen, Aufgaben und Reservierungen.

## Voraussetzungen

- Node.js 24 oder neuer
- npm 11 oder neuer

Die Versionen sind im Root-`package.json` als Engine-Anforderung hinterlegt.

## Entwicklung starten

```sh
npm install
```

Für die Entwicklung werden zwei Terminalfenster benötigt:

```sh
npm run dev:api
npm run dev:app
```

Die API ist danach unter `http://localhost:8787` und die App unter der von Vite ausgegebenen lokalen Adresse erreichbar. Entwicklungsserver werden nur während der Arbeit oder zum Testen gestartet.

## Prüfungen und Build

```sh
npm run typecheck
npm run test --workspace=@jj-tool/api
npm run build
```

`npm run test --workspace=@jj-tool/api` führt die API-Store-Tests aus. Der Produktionsbuild erzeugt die App unter `apps/app/dist` und die API unter `apps/api/dist`.

## Konfiguration

```sh
cp apps/api/.env.example apps/api/.env
```

Mindestens `AUTH_SECRET` muss für einen echten Betrieb durch ein langes zufälliges Geheimnis ersetzt werden. `DATA_DIRECTORY` legt den Speicherort für `auth.json`, Revierdaten, Einrichtungen, Aufgaben und Reservierungen fest. SMTP-Variablen werden für Einladungen, Registrierungshinweise und Passwortlinks benötigt. Geheimnisse und `.env`-Dateien werden nicht eingecheckt.

## Administrator einrichten

Für eine neue Entwicklungsumgebung können `INITIAL_ADMIN_USERNAME`, `INITIAL_ADMIN_EMAIL` und `INITIAL_ADMIN_NAME` gesetzt werden. Alternativ erstellt beziehungsweise aktiviert das Skript ein Systemadministratorkonto:

```sh
npm run reset-admin --workspace=@jj-tool/api -- admin admin@example.com Administrator
```

Dabei wird ein einmaliger Passwortlink per E-Mail versendet. Ohne vollständige SMTP-Konfiguration gibt die Entwicklungs-Mailer-Konfiguration den Link lokal aus.

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
- `docs`: Produkt-, Entwicklungs- und Betriebsdokumentation.

## Handbuch

Die ausführliche Bedienungs- und Betriebsdokumentation steht in [docs/handbuch.md](docs/handbuch.md).