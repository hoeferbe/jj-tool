# Jagdgruppe: Produkt- und Entwicklungsplan

## Zielbild

Eine private Jagdgruppen-App fuer Android als installierbare Capacitor-App und fuer iOS als Progressive Web App (PWA). Sie unterstuetzt die sichere Koordination im Revier, das Aufzeichnen von Nachsuchen und Uebungsfaehrten sowie die Kommunikation mit der Gruppe auch bei eingeschraenkter Netzabdeckung.

Die Anwendung ist fuer einen festen, geschlossenen Nutzerkreis vorgesehen. Sie wird nicht ueber offizielle App-Stores verteilt: Android-Nutzer installieren eine signierte APK, iPhone-Nutzer installieren die PWA aus Safari auf dem Startbildschirm.

Das primaere Einsatzgebiet ist die Gemeinde mit rund 14,5 Quadratkilometern. Offline-Kartenbereiche und Speicherbedarf werden auf dieses Gebiet zugeschnitten.

## Priorisierte Funktionen

### MVP: Einsatz und Kommunikation

- Revier mit Name, Gemeinde und Kartenbereich anlegen.
- Gemeindegrenze als Kartenlinie darstellen und bei Bedarf manuell anpassen.
- Registrierung, Anmeldung und Freigabe von Mitgliedern durch Administratoren.
- Einen initialen Administrator beim Einrichten des Backends anlegen.
- Strecken- und Abschussmeldungen mit voreingestellter aktueller Position, Datum und Wildart erfassen.
- Jagdeinrichtungen mit Bezeichnung, Typ und Kartenposition erfassen und anzeigen.
- Lokale Speicherung ausstehender Aenderungen bei fehlender Verbindung mit spaeterer Synchronisation.

### Ausbau

- Nachsuche oder Uebungsfaehrte starten und beenden.
- Start-, Status- und Endmeldung innerhalb der App.
- Automatische Meldung in eine Telegram-Gruppe durch einen Bot, einschliesslich optionalem Link zur Einsatzkarte.
- Darstellung der eigenen Position und der aufgezeichneten Faehrte auf einer Karte.
- Live-Ansicht einer laufenden Faehrte fuer berechtigte Gruppenmitglieder.
- Push-Mitteilungen ueber Firebase Cloud Messaging, etwa bei Einsatzstart oder neuen Meldungen.
- Offline verfuegbare Kartenbereiche und Routenpunkte.
- Einsatz- und Faehrtenhistorie mit Suche und Export.
- Rollen und Berechtigungen, beispielsweise Leitung, Fuehrer und Beobachter.
- Gewicht, Verwertung, Foto und das Senden einer zusammengefassten Strecke in die Gruppe.
- Eine gruppenweite Informations- und Aufgabenliste mit Eintraegen, Faelligkeit und Erledigt-Status.
- Mehrere Bilder je Abschuss, nachtraegliches Ergaenzen und eine komprimierte Bilduebertragung.
- Auswertungen der Strecke nach Zeitraum, Wildart und Verwertungsweg.

## Aktueller Umsetzungsstand

### Bereits umgesetzt

- npm-Workspace mit Ionic Vue als App und Hono mit TypeScript als API angelegt.
- Lokale Entwicklungsbefehle fuer App und API sowie Produktions-Build und Typecheck eingerichtet.
- Hono-API mit Gesundheitsendpunkt unter `/health` erstellt.
- JSON-basierter Auth-Speicher mit atomischem Schreiben und serialisierten Schreibzugriffen implementiert.
- Registrierung mit Name, Benutzername und E-Mail-Adresse implementiert; neue Konten erhalten den Status `pending`.
- Lokale Anmeldung mit Benutzername oder E-Mail-Adresse, Argon2id-Passwort-Hash und 15 Minuten gueltigem Zugriffstoken implementiert.
- Passwort setzen und Passwort vergessen ueber einen einmaligen, eine Stunde gueltigen Link implementiert.
- E-Mail-Versand per SMTP eingerichtet; ohne SMTP-Konfiguration wird der Passwort-Link nur in der lokalen Entwicklung protokolliert.
- Ein initiales Administratorkonto kann aus einer nicht eingecheckten Umgebungsdatei erzeugt oder mit dem Befehl `npm run reset-admin -- <benutzername> <e-mail> <anzeigename>` neu gesetzt werden.
- CORS fuer die lokalen Entwicklungsadressen `localhost:5173` und `127.0.0.1:5173` eingerichtet.
- Globale Ionic-Farbpalette von Blau auf Oliv umgestellt.
- Vue Router mit drei Routen (`/`, `/dashboard`, `/welcome`) und Navigationsguard eingerichtet; unauthentifizierte Aufrufe werden auf die Anmeldeseite umgeleitet.
- Zugriffstoken auf 7 Tage Laufzeit mit Sliding-Window-Erneuerung umgestellt: beim App-Start wird der Token still über `/auth/refresh` verlängert, sodass Nutzer dauerhaft angemeldet bleiben, solange die App innerhalb von 7 Tagen geöffnet wird.
- Registrierungsablauf entkoppelt: beim Registrieren wird keine E-Mail versendet; der Passwort-Link geht erst nach expliziter Admin-Freigabe raus.
- Admin-Dashboard mit zwei auf- und zuklappbaren Abschnitten implementiert: ausstehende Registrierungen und aktive Mitglieder.
- Rollen- und Berechtigungssystem eingeführt: Rollen `guest`, `paechter`, `bgs`, `admin`; Positionen `Revierleiter`, `Kassenwart`, `Schriftführer`; separates `isAdmin`-Flag für Mitglieder mit Admin-Dashboard-Zugriff ohne die Rolle `admin`.
- Registrierungsfreigabe mit Rollen- und Positionswahl; Ablehnen löscht den Account endgültig.
- Inline-Bearbeitung von Rolle, Position und Admin-Flag direkt in der Mitgliederliste.
- Session-Tracking: Login erzeugt eine Session in `auth.json`; Logout löscht alle Sessions des Nutzers serverseitig; Dashboard zeigt Online-Status (gefüllter grüner Kreis / leerer Kreis).
- Mitglieder-Willkommensseite mit Anzeige des letzten Login-Zeitstempels.
- AppLayout-Komponente mit Header-Navigation: Admins wechseln zwischen Dashboard und persönlicher Seite; Abmelden-Button räumt localStorage und Session auf.
- JSDoc-Kommentare und einzeilige Ablauf-Kommentare in allen Quelldateien (API und Frontend) ergänzt.

### Als Naechstes umzusetzen

- Revierdatenmodell anlegen und erste geschuetzte API-Routen für Revier, Jagdeinrichtungen und Streckeneintraege erstellen.
- Leaflet-Karte einbinden, Gemeindegrenze als GeoJSON darstellen und aktuelle GPS-Position anzeigen.
- Streckeneintrag mit voreingestellter aktueller Position, Datum und Wildart erfassen.
- Capacitor fuer Android konfigurieren; PWA-Manifest und Service-Worker fuer iOS pruefen.
- Tailwind CSS als Ergaenzung zu Ionic integrieren (fuer eigene Layouts ausserhalb der Ionic-Komponenten).

### Noch nicht umgesetzt

- Refresh-Tokens als `HttpOnly`-Cookies und Token-Widerruf (aktuell: JWT in localStorage mit 7-Tage-Sliding-Window).
- Rollenpruefung an geschuetzten API-Routen fuer Revier, Strecke und Jagdeinrichtungen.
- Karten, Offline-Karten, Jagdeinrichtungen, Streckeneintraege, Bilder und Synchronisation.
- Capacitor-Android-Integration, PWA-Service-Worker, Cloudflare Tunnel und Raspberry-Pi-Betrieb.
- Telegram, Firebase Cloud Messaging, Nachsuche und Faehrtenaufzeichnung.

## Technische Zielarchitektur

| Bereich | Entscheidung |
| --- | --- |
| Benutzeroberflaeche | Ionic mit Vue 3 und TypeScript |
| CSS-Utilities | Tailwind CSS als Ergaenzung zu Ionic (geplant) |
| Mobile Android | Capacitor, signierte APK ausserhalb des Play Store |
| Mobile iOS | PWA ueber Safari; optional spaeter Capacitor/iOS, falls die Verteilung und Apple-Voraussetzungen akzeptiert werden |
| Karten | Leaflet mit OpenStreetMap-kompatiblen Kartenquellen |
| GPS | Web-Geolocation fuer die PWA; Android-Hintergrundtracking ueber ein geprueftes natives Capacitor-Plugin |
| Lokale Daten | IndexedDB fuer die PWA, native lokale Datenbank oder sichere Storage-API unter Android |
| Backend | Hono mit TypeScript auf einem Raspberry Pi; waehrend der Entwicklung lokal auf dem Mac mini; REST-API, Authentifizierung, Synchronisation, Bildspeicher und Geheimnisverwaltung |
| Erreichbarkeit | Cloudflare Tunnel vom Raspberry Pi zu einer eigenen Domain; kein eingehender Port und keine Portfreigabe am AVM FRITZ!Box 7950 AX erforderlich |
| Serverdaten | Zum Start JSON-Dateien mit serialisierten Schreibzugriffen, atomischem Speichern und automatischen Backups; Migration zu SQLite vorbereiten |
| Anmeldung | Lokale Benutzerkonten auf dem Backend mit Benutzername, Argon2id-Passwort-Hash, Zugriffstoken und Refresh-Token |
| Benachrichtigungen | Firebase Cloud Messaging fuer Push; Telegram Bot API ueber das Backend |

## Fachliches Datenmodell

| Objekt | Wesentliche Informationen |
| --- | --- |
| Revier | Name, Gemeinde, Gemeindegrenze als GeoJSON-Linie oder -Flaeche, Ersteller |
| Mitglied | Benutzername, Anzeigename, Status ausstehend oder freigegeben, Rolle Mitglied oder Administrator |
| Jagdeinrichtung | Bezeichnung, Typ, Koordinaten, Status, Notiz, Foto optional |
| Abschuss / Streckeneintrag | Datum und Uhrzeit, Koordinaten, Wildart, Gewicht, Verwertung, Notiz, Bilder, erfassende Person |
| Verwertung | Selbstverbrauch, Vermarktung innerhalb der Gemeinde, Vermarktung ausserhalb der Gemeinde; bei Bedarf erweiterbar |
| Info / Aufgabe | Titel, Inhalt, Kategorie Info oder Aufgabe, Ersteller, Faelligkeit optional, Erledigt-Status |
| Bild | Zugeordnetes Objekt, Speicherpfad, Aufnahmedatum, Dateityp und Groesse |

Fotos werden vom Client vor dem Upload in eine praxistaugliche Groesse komprimiert. Sie liegen nicht in den JSON-Dateien selbst, sondern als Dateien im geschuetzten Server-Dateisystem; die JSON-Daten enthalten nur Metadaten und Referenzen.

## Beschlossene Produktregeln

- Eine Einsatzmeldung enthaelt ausloesende Person, Start, Status oder Ende, Wildart falls bekannt, einen Kartenlink sowie ein Freitextfeld.
- Neue Faehrten sind anfangs nur fuer den Ersteller sichtbar. Sie werden erst nach dessen expliziter Freigabe fuer Mitglieder und Administratoren sichtbar.
- Standortverlaeufe koennen vom Ersteller oder Administrator geloescht werden. Es gibt keine automatische Loeschfrist; ein Datenexport folgt in einer spaeteren Version.
- Jagdeinrichtungen und Streckeneintraege duerfen nur vom jeweiligen Ersteller oder von Administratoren bearbeitet und geloescht werden.
- Bilder bleiben in der ersten Version innerhalb der App. Telegram-Nachrichten enthalten keine Bilder.
- Unterstuetzt werden die zwei aktuellsten Hauptversionen von Android und iOS zum Zeitpunkt der jeweiligen Auslieferung. Die konkreten Mindestversionen werden vor dem ersten Testrelease festgeschrieben.
- Das Backend laeuft auf einem Raspberry Pi 4 mit 4 GB Arbeitsspeicher und SSD-Speicher auf zwei Laufwerken im RAID. Der Betreiber verwaltet Cloudflare-Domain, Tunnel-Zugang und Server-Geheimnisse.
- Als erste Kartenquelle wird OpenStreetMap verwendet. Der Offline-Kartenumfang wird vor der Freigabe anhand der Nutzungsbedingungen und eines Praxistests festgelegt.
- Die anfänglichen Typen fuer Jagdeinrichtungen sind Kanzel, Bock, Leiter, Roehrenfalle und Kirrung.
- Interessenten registrieren sich mit Benutzername und Passwort. Sie erhalten erst nach Freigabe durch einen Administrator Zugang zum Revier. Ein initiales Administratorkonto wird beim Einrichten des Backends durch eine einmalige, nicht eingecheckte Konfiguration angelegt.
- Die vollstaendige Gemeinde mit rund 14,5 Quadratkilometern kann als Offline-Kartenbereich auf das Geraet geladen werden. Der Download ist freiwillig, jederzeit in den Einstellungen loeschbar und zeigt vorab den Speicherbedarf an.
- Ohne heruntergeladenen Offline-Kartenbereich und ohne Netzverbindung stehen Kartenansicht, Standortanzeige auf der Karte und kartenbasierte Eingaben nicht zur Verfuegung. Bereits lokal erfasste Daten bleiben erhalten und werden bei einer Verbindung synchronisiert.

## Lokale Anmeldung

Fuer den MVP werden Benutzerkonten lokal im Backend gefuehrt. Interessenten registrieren sich mit Benutzername und Passwort; ihr Konto bleibt bis zur Freigabe durch einen Administrator gesperrt. Das erste Administratorkonto wird beim Einrichten des Backends einmalig aus einer nicht eingecheckten Konfiguration erzeugt. Das Backend speichert niemals Klartextpasswoerter: Passwoerter werden mit Argon2id gehasht und die Anmeldung wird gegen Rate-Limits geschuetzt.

Nach erfolgreicher Anmeldung erhaelt die App ein 7 Tage gueltiges Zugriffstoken, das beim naechsten App-Start still erneuert wird (Sliding Window). Solange die App innerhalb von 7 Tagen geoeffnet wird, bleibt der Nutzer dauerhaft angemeldet. Logout loescht alle serverseitigen Sessions des Nutzers. Erneuerbare Refresh-Tokens als `HttpOnly`, `Secure` und `SameSite` geschuetzte Cookies sowie Token-Widerruf sind als naechster Sicherheitsausbau vorgesehen. Das Token- und Benutzerformat wird von den Hono-Routen getrennt gehalten, damit ein Wechsel zu Auth0 oder einem anderen Identitaetsdienst spaeter moeglich bleibt.

Waehrend der Entwicklung laeuft dieselbe Hono-API auf dem Mac mini mit lokalen Testdaten. Vor der Umstellung auf den Raspberry Pi werden keine echten Zugangsdaten oder produktiven Standortdaten in der Entwicklungsumgebung verwendet.

## Wichtige Grenzen und Sicherheitsentscheidungen

- Ein Telegram-Bot-Token darf nie in der App ausgeliefert werden. Die App ruft einen authentifizierten Backend-Endpunkt auf; nur dieser sendet an Telegram.
- Vollautomatische WhatsApp-Gruppennachrichten sind fuer dieses private Vorhaben mit der offiziellen API nicht sinnvoll. Als Komfortfunktion kann die App einen vorausgefuellten WhatsApp-Share-Text zum manuellen Absenden anbieten.
- iOS-PWAs koennen Hintergrund-GPS und Push nicht mit derselben Zuverlaessigkeit wie eine native Android-App garantieren. Zu Beginn ist kontinuierliches Hintergrundtracking daher ein Android-Kernfeature; auf iOS wird der Funktionsumfang nach einem Geraetetest verbindlich festgelegt.
- Offline-Karten duerfen nicht durch unkontrolliertes Herunterladen oeffentlicher OSM-Kacheln realisiert werden. Vor Umsetzung werden Kartenanbieter, Lizenz, Nutzungsgrenzen und ein Cache-Konzept festgelegt.
- Der optionale Gemeindedownload darf nicht den oeffentlichen Kachelserver `tile.openstreetmap.org` massenhaft abfragen. Fuer Offline-Karten wird ein lizenzkonformer Kartenanbieter oder ein eigener, aus OSM-Daten erzeugter Kartenbestand verwendet.
- Standort- und Einsatzdaten sind besonders schutzbeduerftig. Transportverschluesselung, serverseitige Zugriffskontrollen, Datenminimierung, Loeschkonzept und nachvollziehbare Einwilligung sind Mindestanforderungen.
- Der Cloudflare Tunnel stellt ausschliesslich den Webdienst bereit. Der Raspberry Pi bleibt gegen das Internet geschlossen; Administration erfolgt getrennt und abgesichert im Heimnetz oder ueber einen eigenen sicheren Fernzugang.
- JSON-Dateien sind nur fuer den kleinen Startumfang geeignet. Gleichzeitige Aenderungen werden serverseitig in eine Schreibwarteschlange ueberfuehrt, jede Speicherung erfolgt atomisch und es gibt regelmaessige Sicherungen ausserhalb der SD-Karte.
- Bilder und Standortdaten werden nur nach Anmeldung und Berechtigungspruefung ausgeliefert. Direkte, frei erratbare Bild-URLs werden vermieden.
- Die App ist ein Koordinationswerkzeug und ersetzt keine Notruf-, Sicherheits- oder Rettungskommunikation.

## Umsetzungsphasen

### 1. Fachliches Fundament

1. Reviername, Gemeinde, Gemeindegrenze und die Quelle der Grenzdaten festlegen.
2. Registrierung, Mitgliederfreigabe und Administratorenrolle fachlich festlegen.
3. Pflichtfelder eines MVP-Streckeneintrags festlegen: aktuelle Position, Datum und Wildart.
4. Datenschutz- und Datenaufbewahrungsregeln fuer Standortdaten beschliessen.
5. Android- und iPhone-Testgeraete bestimmen.
6. Raspberry-Pi-Betrieb auf dem vorhandenen Pi 4 mit 4 GB und SSD-RAID festlegen: Betriebssystem, Stromversorgung, Datensicherung, Aktualisierungen und Fernadministration.
7. Cloudflare-Konto, Domain und Tunnel als sicheren externen Zugang ohne Router-Portfreigabe einrichten.

Ergebnis: fachliche Akzeptanzkriterien und ein kleiner, testbarer MVP-Umfang.

### 2. Projektgrundlage

1. Ionic-Vue-Projekt mit TypeScript, Linting und Tests erzeugen.
2. Capacitor fuer Android konfigurieren und eine erste APK bauen.
3. PWA-Manifest, Service Worker und Installierbarkeit auf iPhone pruefen.
4. Hono-Backend mit Node.js-Laufzeit, Registrierung, Freigabe durch Administratoren und Datenmodell fuer Revier, Mitglieder, Jagdeinrichtungen und Streckeneintraege erstellen.
5. JSON-Dateispeicher mit atomischem Schreiben, Schreibwarteschlange, Bildablage und Backup-Job implementieren.

Ergebnis: Administrator kann ein Revier mit Gemeindegrenze anlegen, Mitglieder freigeben und ein Mitglied kann einen Streckeneintrag erfassen.

### 3. Karte, Revier und Streckeneintrag

1. Gemeindegrenze aus einer verifizierten Quelle als GeoJSON importieren und in Leaflet darstellen; Administratoren koennen sie bei Bedarf manuell nachziehen.
2. Revier und Jagdeinrichtungen auf der Karte anlegen und anzeigen.
3. Beim Erstellen eines Streckeneintrags die aktuelle Position nach Zustimmung des Geraets als Vorschlag setzen; der Nutzer kann sie auf der Karte korrigieren.
4. Streckeneintrag mit Datum und Wildart lokal speichern und bei Verbindung synchronisieren.

Ergebnis: Das Revier ist auf der Karte begrenzt und ein Streckeneintrag kann mit aktuellem Standort erstellt werden.

### 4. Revierverwaltung und Strecke

1. Jagdeinrichtungen auf der Karte anlegen, bearbeiten und filtern.
2. Streckeneintrag mit Standort, Wildart, Gewicht, Verwertung und Bildaufnahme erstellen.
3. Bilder lokal vormerken, bei Verbindung hochladen und dem Eintrag zuordnen.
4. Informations- und Aufgabenliste mit Berechtigungen und Erledigt-Status bereitstellen.

Ergebnis: Einrichtungen, Strecke und Gruppeninformationen sind in der App nachvollziehbar dokumentiert.

### 5. Gruppenkommunikation

1. Einsatzereignisse im Backend definieren: gestartet, Status aktualisiert, beendet.
2. Telegram-Bot einrichten, zur Gruppe hinzufuegen und Chat-ID serverseitig hinterlegen.
3. Ereignisse serverseitig als Telegram-Nachricht mit Kartenlink zustellen.
4. FCM-Push fuer registrierte Geraete integrieren.

Ergebnis: Gruppenmitglieder erhalten eine Telegram- und, soweit erlaubt, Push-Meldung zu Einsaetzen.

### 6. Faehrtenaufzeichnung und Offline-Synchronisation

1. GPS-Aufzeichnung im Vordergrund implementieren, Genauigkeit und Akkunutzung messen.
2. Android-Hintergrundtracking als nativen Integrationsschritt umsetzen und auf einem realen Geraet testen.
3. Punkte lokal zwischenspeichern und in einer Warteschlange synchronisieren.
4. Leaflet-Route aus lokalen und synchronisierten Punkten zeichnen.

Ergebnis: eine Faehrte bleibt bei Netzverlust erhalten und wird nach Wiederverbindung ohne Duplikate uebertragen.

### 7. Praxistest und Auslieferung

1. Feldtest mit Android und iPhone bei schwacher Verbindung, gesperrtem Bildschirm und langer Laufzeit.
2. Akkuverbrauch, Positionsgenauigkeit, Konflikte bei paralleler Bearbeitung und Wiederanlauf nach App-Abbruch pruefen.
3. Raspberry-Pi-Wiederherstellung, JSON-Backup, Cloudflare-Tunnel und Update-Prozess dokumentiert testen.
4. Datenschutztexte, Betriebsdokumentation und APK-Signatur abschliessen.
5. Gruppenpilot mit wenigen Nutzern, dann kontrollierte Freigabe.

Ergebnis: belastbarer Einsatzbetrieb im definierten Funktionsumfang.

## Offene Entscheidungen vor dem Start

1. Aus welcher verifizierten Quelle wird die Gemeindegrenze als GeoJSON bezogen und darf sie durch Administratoren angepasst werden?
2. Welcher lizenzkonforme Kartenanbieter oder welche selbst bereitgestellte OSM-Kartendatei wird fuer den Offline-Download der Gemeinde verwendet?
3. In welchen Zoomstufen soll die Gemeinde offline vorliegen und wie gross darf der Download maximal werden?

## Naechster konkreter Schritt

Den MVP mit Revier und Gemeindegrenze, Registrierung und Freigabe von Mitgliedern sowie einem Streckeneintrag mit aktueller Position, Datum und Wildart umsetzen. Nach diesem MVP folgen Nachsuche, Faehrtenaufzeichnung und Gruppenbenachrichtigungen.