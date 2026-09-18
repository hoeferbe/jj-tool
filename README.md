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

## Android-Releases

Android-Releases werden über GitHub Actions erstellt. Der Workflow `release-please.yml` wertet Conventional Commits auf `master` aus und erstellt beziehungsweise aktualisiert eine Release-PR. Dafür braucht das Repository zusätzlich das Secret `RELEASE_PLEASE_TOKEN` mit einem PAT oder GitHub-App-Token, weil das Standard-`GITHUB_TOKEN` in diesem Repository keine Release-PRs erstellen darf. Erst beim Merge dieser PR wird automatisch ein Tag im Format `vMAJOR.MINOR.PATCH` erzeugt. Dieser Tag startet anschließend `android-release.yml`; die signierte APK wird als Asset am GitHub-Release veröffentlicht.

Die Release-Version wird ausschließlich aus dem Git-Tag abgeleitet: `v1.2.3` ergibt Android `versionName 1.2.3` und einen daraus berechneten monotonen `versionCode`. `feat` erzeugt eine Minor-Version, `fix`/`refactor` eine Patch-Version; `BREAKING CHANGE` im Commit-Body oder ein `!` hinter dem Typ erzeugt eine Major-Version. `docs`, `test` und `chore` lösen normalerweise keinen Release aus.

Für ein Update muss derselbe Keystore verwendet werden; der Keystore und die vier Actions-Secrets (`ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`) dürfen nicht ins Repository gelangen. Vor dem ersten Release müssen alle vier Secrets im Repository eingerichtet sein.

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

## Container und Deployment (Raspberry Pi)

Für den Produktivbetrieb gibt es pro App ein Dockerfile sowie ein `docker-compose.yml` im Repo-Root. Diese Dateien sind nicht für die lokale Entwicklung gedacht (siehe „Entwicklung starten“ oben), sondern für den Raspberry Pi.

- `apps/api/Dockerfile`: Mehrstufiger Build, kompiliert die API mit `tsc` und läuft im Runtime-Image als `node dist/index.js` auf Port 8787.
- `apps/app/Dockerfile`: Mehrstufiger Build, baut die App mit Vite und liefert die statischen Dateien über `nginx:alpine` aus (`apps/app/nginx.spa.conf`). `VITE_API_URL` wird beim Build fest auf `/api` gesetzt, da der Client die API nicht über `localhost` erreichen kann; ein externer Reverse Proxy muss `/api/` auf den API-Container weiterleiten.
- `docker-compose.yml`: Startet `jj-tool-api` und `jj-tool-app`. Der Build-Kontext ist fest auf `/home/pi/GIT/jj-tool` gesetzt und funktioniert daher nur auf dem Raspberry Pi mit diesem Pfad. Beide Container hängen im externen Docker-Netzwerk `proxy`, das von einem separaten, nicht in diesem Repo enthaltenen nginx-Reverse-Proxy-Container bereitgestellt wird. Die API liest ihre Umgebungsvariablen aus einer `.env`-Datei neben der kopierten `docker-compose.yml` (nicht aus `apps/api/.env`) und speichert Daten im Volume `/media/docker/jj-tool/data`.
- `deploy.sh`: Wird auf dem Raspberry Pi ausgeführt, kopiert die Repo-`docker-compose.yml` nach `/media/docker/jj-tool/docker-compose.yml`, baut beide Images neu, startet die Container neu und lädt anschließend die Konfiguration des externen nginx-Reverse-Proxy-Containers neu (DNS-Cache-Invalidierung). Voraussetzung ist eine bereits vorhandene, nicht eingecheckte `.env` in `/media/docker/jj-tool`.

## Struktur

- `apps/app`: Ionic-Vue-PWA und Capacitor-Client.
- `apps/api`: Hono-API; lokal auf dem Mac mini, spaeter auf dem Raspberry Pi.
- `docs`: Produkt-, Entwicklungs- und Betriebsdokumentation.

## Handbuch

Die ausführliche Bedienungs- und Betriebsdokumentation steht in [docs/handbuch.md](docs/handbuch.md).