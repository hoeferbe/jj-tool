# Agent-Richtlinien für „Mein Jagdrevier“

Diese Datei gilt für den gesamten Monorepo (`apps/api`, `apps/app`) und fasst Rahmenbedingungen aus [docs/entwicklungsplan.md](docs/entwicklungsplan.md) sowie im Code bereits etablierte Konventionen zusammen. Details und Hintergründe stehen in [docs/entwicklungsplan.md](docs/entwicklungsplan.md) und [docs/umsetzungsstand.md](docs/umsetzungsstand.md) – hier nur die Kurzfassung, die für jede Änderung gilt.

## Architektur

- npm-Workspace-Monorepo: `apps/api` (Hono + TypeScript, Node) und `apps/app` (Ionic Vue 3 + TypeScript, Vite).
- Serverdaten liegen als JSON-Dateien unter `apps/api/data/`. Jeder Store (`*-store.ts`) kapselt genau eine Datei, hält den Zustand im Speicher und schreibt über eine serialisierte Warteschlange (`writeQueue`/`enqueue`) atomar (temp-Datei + `rename`). Neue Stores folgen diesem Muster (Vorbild: `apps/api/src/auth-store.ts`, `apps/api/src/facility-store.ts`).
- API-Routen werden als `registerXRoutes(app, dependencies)`-Funktionen in `apps/api/src/routes/*.routes.ts` implementiert und in `apps/api/src/index.ts` mit ihren Abhängigkeiten (Stores, Auth-Helper) verdrahtet. Berechtigungen laufen über zentrale Helper wie `canAccessHuntingDistrict`/`canAdministerHuntingDistrict` (`apps/api/src/helpers/hunting-district.helpers.ts`) statt über Ad-hoc-Checks in den Routen.
- Frontend-Views (`apps/app/src/views/*.vue`) laden Daten selbst per `fetch` gegen die API (kein zentraler State-Store), Komponenten (`apps/app/src/components/*.vue`) sind wiederverwendbare Dialoge/Bausteine. `AppLayout.vue` umschließt jede Seite und wird bei jeder Navigation neu gemountet – das ist der Ort für Seiten-übergreifende Dinge wie das Neuigkeiten-Badge.

## Build, Test, Entwicklung

- Root: `npm run build` / `npm run typecheck` (laufen über beide Workspaces).
- API: `npm run dev --workspace=@jj-tool/api` (oder `npm run dev:api` im Root), `npm test` (node:test, `apps/api/src/*.test.ts`), `npm run typecheck` (`tsc --noEmit`).
- App: `npm run dev --workspace=@jj-tool/app` (oder `npm run dev:app`), `npm run typecheck` (`vue-tsc --noEmit`), `npm run build` (`vue-tsc -b && vite build`).
- Kein Linter im Repo eingerichtet – Typecheck ist die verbindliche Prüfung vor Abschluss einer Aufgabe.
- Entwicklungsserver (API/App) nur vorübergehend zum eigenen Testen starten und danach wieder beenden; der Nutzer startet beide Server selbst dauerhaft.

## Git-Workflow

- Keine automatischen Commits, außer der Nutzer fordert das Committen explizit an.
- Nach Abschluss eines Auftrags stattdessen eine passende Commit-Message vorschlagen, damit der Nutzer selbst committen kann.
- Bei mehreren Aufträgen in einer Session die vorgeschlagene Commit-Message jeweils an den aktuellen Stand anpassen (nicht die alte Message unverändert wiederholen).
- Commit-Messages folgen Conventional Commits: `feat` für neue Funktionen, `fix` für Fehlerbehebungen, `docs` für Dokumentation, `refactor` für interne Umbauten, `test` für Tests und `chore` für Wartung.
- Breaking Changes werden mit `BREAKING CHANGE:` im Commit-Body oder einem `!` hinter dem Typ markiert, zum Beispiel `feat!:`. Release Please verwendet diese Informationen für die nächste Major-/Minor-/Patch-Version.
- Releases laufen über `.github/workflows/release-please.yml`: Erst eine Release-PR mergen, danach baut der Tag-basierte Android-Workflow die signierte APK.

## Code-Konventionen

- **JSDoc ist Pflicht** für exportierte Funktionen, Klassen und öffentliche Methoden in `apps/api/src` und `apps/app/src` (Stores, Helper, Routen-Factories, Composables, nicht-triviale Funktionen in `.vue`-Dateien). Kurze, prägnante Beschreibung, `@param`/`@returns` nur wenn sie über den Namen hinaus Mehrwert bieten. Vorbild: `apps/api/src/auth-store.ts` (`findUserById`, `recordLogin`).
- Einzeilige `//`-Kommentare erklären das **Warum**, nicht das Was (z. B. „// best effort – still clear local session on network failure“ in `AppLayout.vue`). Keine mehrzeiligen Erklärkommentare für offensichtlichen Code.
- Sprache: Domänenbegriffe, UI-Texte und Fehlermeldungen sind Deutsch (Revier, Jagdeinrichtung, Streckeneintrag, Aufgabe …), Code-Struktur (Funktionsnamen, Variablen außerhalb der Fachdomäne, Kommentare) ist Englisch – so wie im bestehenden Code gemischt verwendet.
- TypeScript strikt nutzen: Interfaces/Types für Store-Modelle exportieren, keine `any` ohne triftigen Grund.
- Tests folgen `node:test` + `node:assert/strict`, mit `mkdtemp`/`afterEach(rm ...)` für isolierte temporäre Datenverzeichnisse (Vorbild: `apps/api/src/facility-tasks-store.test.ts`).

## UI- und Dialog-Konventionen

Gilt für alle Erfassungs-/Bearbeitungsdialoge (Jagdeinrichtungen, Aufgaben, Streckeneinträge, künftige Formulare):

- Kompakter Kopfbereich: Titel links, Schließen-Aktion rechts; Aktionszeile am Ende (Abbrechen sekundär, Speichern als einzige hervorgehobene Hauptaktion).
- Felder fachlich gruppieren statt lose aneinanderreihen; Bezeichnung über volle Breite, zusammengehörige Felder (z. B. Typ/Status) nebeneinander, stapeln auf kleinen Bildschirmen.
- Für kompakte Formulare bevorzugt native HTML-Elemente (`input`, `select`, `textarea`) mit eigenen CSS-Klassen; Ionic-Felder nur bei Bedarf an ihrer nativen Funktionalität.
- Semantische Farben durchgängig: Grün = aktiv/erfolgreich, Gelb = Warnung, Rot(hell) = defekt, Grau = inaktiv/außer Betrieb.
- Neue oder verschobene Position wird sichtbar bestätigt und erst durch Speichern übernommen; Dialoginhalt ist immer scrollbar, Aktionen bleiben erreichbar.

## Sicherheits- und Datenschutzregeln

- Standort- und Nutzerdaten sind sensibel: Auslieferung nur nach Auth-Prüfung, keine erratbaren Direkt-URLs für Bilder/Standorte.
- Geheimnisse (z. B. ein künftiger Telegram-Bot-Token) dürfen nie an den Client ausgeliefert werden – nur das Backend spricht mit externen Diensten.
- JSON-Dateispeicher ist nur für den kleinen Startumfang gedacht; jede Änderung an einem Store muss weiterhin über die Schreibwarteschlange und atomares Schreiben laufen (siehe Architektur oben).
- Berechtigungen immer über die zentralen Helper (`canAccessHuntingDistrict`, `canAdministerHuntingDistrict`, `isActiveHuntingDistrictMember` u. Ä.) prüfen, nicht neu erfinden.
