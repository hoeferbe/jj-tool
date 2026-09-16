# Soll-Ist-Vergleich und Umsetzungsstand

Stand: 16. September 2026

Diese Übersicht vergleicht den Produkt- und Entwicklungsplan mit dem tatsächlich vorhandenen Code. Der Entwicklungsplan beschreibt weiterhin das Zielbild; dieses Dokument hält den überprüften Arbeitsstand fest.

## Statusübersicht

| Status | Bedeutung |
| --- | --- |
| Fertig | Funktion ist nutzbar und im Code umgesetzt. |
| Teilweise | Wesentliche Grundlagen existieren, aber der geplante Umfang ist noch nicht vollständig. |
| Nachschärfen | Funktion existiert, benötigt aber fachliche, technische oder sicherheitsbezogene Korrekturen. |
| Offen | Noch nicht oder nur konzeptionell begonnen. |

## 1. Projekt und Betrieb

| Gewünschte Funktion | Status | Vorhanden und Fundstelle | Noch zu erledigen |
| --- | --- | --- | --- |
| Ionic-Vue-App und Hono-API mit TypeScript | Fertig | npm-Workspace und Build-Skripte in `package.json`, App unter `apps/app`, API unter `apps/api` | Keine wesentliche MVP-Lücke |
| Zuverlässige lokale Persistenz | Fertig | JSON-Stores mit Schreibwarteschlange und atomischem Umbenennen, unter anderem `auth-store.ts`, `hunting-district-store.ts` und `kill-entry-store.ts` | Mittelfristig Migration zu SQLite bewerten |
| Betrieb auf Raspberry Pi | Teilweise | Dockerfiles, `docker-compose.yml` und `deploy.sh` vorhanden | Wiederherstellung, automatisierte Backups, Monitoring und Update-Prozess testen und dokumentieren |
| Externer sicherer Zugang | Offen | Im Zielbild als Cloudflare Tunnel vorgesehen | Tunnel, Domain, TLS und Betriebszugang einrichten und testen |
| Android-App und iPhone-PWA | Offen | Ionic-Web-App ist vorhanden | Capacitor, Android-Projekt, signierte APK, PWA-Manifest, Service Worker und Gerätetests fehlen |
| Tailwind als CSS-Ergänzung | Offen | Nicht installiert | Nur integrieren, wenn für kommende Oberflächen tatsächlich benötigt |

## 2. Anmeldung und Benutzerkonten

| Gewünschte Funktion | Status | Vorhanden und Fundstelle | Noch zu erledigen |
| --- | --- | --- | --- |
| Registrierung, Login und Freigabe | Fertig | Auth-Routen in `apps/api/src/routes/auth.routes.ts`, Verwaltung in `admin.routes.ts` und `AdminDashboard.vue` | Zusätzliche Integrationstests wären sinnvoll |
| Initialer Systemadministrator | Fertig | Initialisierung in `apps/api/src/bootstrap.ts`, zusätzlich `reset-admin.ts` | Betriebsablauf dokumentiert testen |
| Sichere Passwörter | Fertig | Argon2id, einmalige Passwortlinks, Passwort-Reset und Kriterienanzeige | Keine wesentliche MVP-Lücke |
| Einladungen zu einem Revier | Fertig | Gehashte, einmalige, sieben Tage gültige Einladungen; verbrauchte und abgelaufene Einträge werden bereinigt | Routen automatisiert testen |
| Benutzer vollständig löschen | Fertig | Benutzer, Sessions, Passworttokens und zugehörige Einladungen werden in `auth-store.ts` entfernt | Datenschutzkonzept für fachliche Datensätze des Benutzers ergänzen |
| Eigenes Profil bearbeiten | Fertig | Name und E-Mail über „Mein Profil“ in `AppLayout.vue`; Loginname bleibt unveränderlich | Optional erneute E-Mail-Verifikation bei Adressänderung |
| Dauerhafte sichere Sitzung | Teilweise | JWT im Local Storage mit sieben Tagen Gültigkeit und Sliding-Window-Erneuerung | Refresh-Token als `HttpOnly`-Cookie, Geräteverwaltung und gezielter Widerruf fehlen |

## 3. Rollen, Mitgliedschaften und Rechte

| Gewünschte Funktion | Status | Vorhanden und Fundstelle | Noch zu erledigen |
| --- | --- | --- | --- |
| Globale und revierbezogene Rechte | Fertig | Systemadmin sowie Mitgliedschaften als Pächter, BGS oder Gast in `auth-store.ts` | Rechte-Matrix dokumentieren |
| Revierbezogene Funktionen | Fertig | Revierleiter, Kassenwart und Schriftführer pro Mitgliedschaft | Weitere Funktionen nur bei fachlichem Bedarf |
| Gäste ohne Verwaltungsrechte | Fertig | Gäste können weder Funktion noch Revieradmin-Recht erhalten; Store, Schema, API und Dashboard erzwingen dies | Keine bekannte Lücke |
| Verwaltung durch Revieradmins | Fertig | Zugriff ist auf administrierte Reviere begrenzt | Routenbasierte Berechtigungstests ausbauen |
| Letzten Revieradmin schützen | Fertig | Entzug oder Entfernung wird ohne Nachfolger verhindert | Keine bekannte Lücke |
| Konten sperren, entsperren und löschen | Fertig | Systemadmin-Funktionen im Dashboard; Sperren beendet aktive Sessions | Optional Sperrgrund und Audit-Historie |
| Feingranulare Rechte | Offen | Rollen sind derzeit grob geschnitten | Optionale Rechte wie „nur lesen“, „Strecke erfassen“ oder „Einrichtungen verwalten“ fachlich entscheiden |

## 4. Reviere und Karten

| Gewünschte Funktion | Status | Vorhanden und Fundstelle | Noch zu erledigen |
| --- | --- | --- | --- |
| Mehrere Reviere verwalten | Fertig | UUID-basierter Mehr-Revier-Store und CRUD-Routen | Keine wesentliche MVP-Lücke |
| Revier mit Name, Gemeinde und Grenze anlegen | Fertig | `NewRevierDialog.vue`, BKG-WFS-Proxy und `hunting-districts.routes.ts` | Fehlerfälle des externen BKG-Dienstes weiter testen |
| Revier automatisch auswählen | Fertig | Ein Revier wird automatisch angezeigt; bei mehreren gilt die zuletzt gespeicherte Auswahl | Auswahl könnte später zentral in einem Client-Store liegen |
| Revier über das Menü anlegen | Fertig | Menüpunkt „Neues Revier“ in `AppLayout.vue` | Keine bekannte Lücke |
| Gleichnamige Reviere bei Registrierung unterscheiden | Fertig | Auswahl zeigt Reviername, Gemeinde und aktiven Revieradmin beziehungsweise Ersteller als Ansprechpartner | UUID bleibt der technische Schlüssel; gleiche Namen und Gebiete bleiben bewusst erlaubt |
| Reviergrenze darstellen | Fertig | Leaflet-Karte, Außenmaske, Straßen-/Satellitenebene und BKG-Quellenangabe | Keine wesentliche MVP-Lücke |
| Reviergrenze manuell anpassen | Teilweise | Grenzdaten können serverseitig aktualisiert werden | Ein echter Zeichen- und Bearbeitungsmodus für Polygone fehlt |
| Revier vollständig löschen | Fertig | Revier, Mitgliedschaften, Einrichtungen, Aufgaben, Reservierungen und Streckeneinträge werden endgültig gelöscht | Dateiübergreifende Transaktionen folgen erst mit einer späteren SQLite-Migration |
| Offline-Karten | Offen | Keine lokale Kartenablage vorhanden | Lizenzkonformen Anbieter, Zoomstufen, Speicheranzeige, Download und Löschen umsetzen |

## 5. Jagdeinrichtungen

| Gewünschte Funktion | Status | Vorhanden und Fundstelle | Noch zu erledigen |
| --- | --- | --- | --- |
| Einrichtungen anlegen und anzeigen | Fertig | Kanzel, Bock, Leiter, Röhrenfalle und Kirrung in `facility-store.ts`, `RevierMap.vue` und `EinrichtungenView.vue` | Keine wesentliche MVP-Lücke |
| Position innerhalb des Reviers | Fertig | Client- und serverseitige Grenzprüfung | Grenzfälle mit Polygonlöchern weiter testen |
| Einrichtung bearbeiten und verschieben | Fertig | Dialog und Kartenpositionierung in `NewJagdeinrichtungDialog.vue` | Keine bekannte Lücke |
| Rollenabhängige Bearbeitung | Fertig | Pächter, BGS und Admin dürfen anlegen; Gäste nicht; Bearbeitung durch Ersteller oder Admin | Automatisierte Routentests ergänzen |
| Einrichtung löschen | Offen | Keine Löschroute und keine UI-Aktion | Löschregel sowie Behandlung von Aufgaben und Reservierungen definieren und umsetzen |
| Fotos und Filter | Offen | Nicht vorhanden | Bildspeicher, Komprimierung, Upload, Zugriffsschutz und Filter umsetzen |

## 6. Aufgaben und Reservierungen

| Gewünschte Funktion | Status | Vorhanden und Fundstelle | Noch zu erledigen |
| --- | --- | --- | --- |
| Aufgaben an Einrichtungen | Fertig | Anlegen, Zuweisen, Übernehmen und Erledigen in `facility-tasks-store.ts`, `tasks.routes.ts` und `NewJagdeinrichtungDialog.vue` | Optionale Lösch- und Wiedereröffnungsabläufe prüfen |
| Allgemeine Revieraufgaben | Fertig | Eigene Ansicht mit Titel, Beschreibung, Fälligkeit, Priorität, Zuständigkeit, Übernehmen, Bearbeiten und Erledigen | Optionale Kategorien und Benachrichtigungen können später ergänzt werden |
| Allgemeine Revierinformationen | Offen | Aufgaben sind umgesetzt, reine Informationsmeldungen noch nicht | Informationskategorien, Gültigkeitszeitraum und Sichtbarkeit fachlich festlegen |
| Einrichtungen reservieren | Fertig | Reservieren, Ändern, Stornieren sowie Ein- und Auschecken | Keine wesentliche MVP-Lücke |
| Einheitliches Zeitraster | Fertig | Start in festen 30-Minuten-Schritten; Ende automatisch drei Stunden später; API erzwingt dieselbe Regel | Dauer ist derzeit bewusst fest und nicht konfigurierbar |
| Reservierungskonflikte verhindern | Fertig | Zeitraumüberschneidungen werden im Store geprüft; mehrere nicht überlappende Zukunftsbuchungen werden chronologisch angezeigt und einzeln bearbeitet oder storniert | Keine bekannte MVP-Lücke |
| Reservierungshistorie | Fertig | Beendete und abgelaufene Reservierungen bleiben gespeichert und werden pro Einrichtung in einer ausklappbaren Historie angezeigt | Optionale Filter und eine Aufbewahrungsfrist können später ergänzt werden |
| Alte Reservierungen behandeln | Fertig | Abgelaufene Reservierungen werden nicht mehr als aktiv ausgeliefert, bleiben aber in der Historie erhalten | Keine bekannte MVP-Lücke |

## 7. Streckeneinträge

| Gewünschte Funktion | Status | Vorhanden und Fundstelle | Noch zu erledigen |
| --- | --- | --- | --- |
| Eintrag erfassen und bearbeiten | Fertig | Datum, Uhrzeit, Wildart, Unterart, Geschlecht, VO, Bescheinigung, Ort, Position, Gewicht, Alter und Notiz | Keine wesentliche Datenerfassungslücke |
| Häufige Wildarten schnell wählen | Fertig | Schnellwahl-Chips in `StreckeneintragDialog.vue` | Fachlich verbindliche Wildartenliste und Grafik-Icons fehlen |
| Unterarten abbilden | Teilweise | Unterart und Geschlecht sind vorhanden, Rehwild wird unterstützt | Vollständige Taxonomie für alle relevanten Wildarten abstimmen |
| GPS und Kartenkorrektur | Fertig | Automatischer GPS-Vorschlag und Leaflet-Karten-Picker | Verhalten ohne Netz und ohne Kartenkacheln verbessern |
| Liste, Detail, Sortierung und Löschen | Fertig | `StreckeneintraegeView.vue`, Detaildialog und API-CRUD | Keine wesentliche UI-Lücke |
| Bearbeitungsrechte laut Produktregel | Fertig | Nur Ersteller sowie zuständige Revier- oder Systemadmins können Einträge ändern oder löschen; die UI zeigt Aktionen entsprechend an | Automatisierte Routentests weiter ausbauen |
| Verwertung | Offen | Nicht im Datenmodell enthalten | Verwertungsweg fachlich festlegen und in Schema, Store und UI ergänzen |
| Fotos | Offen | Nicht vorhanden | Mehrfachbilder, Komprimierung, Upload und nachträgliches Ergänzen umsetzen |
| Auswertungen und Export | Offen | Nicht vorhanden | Zeitraum-, Wildart- und Verwertungsfilter sowie Exportformat festlegen |
| Offline-Erfassung und Synchronisation | Offen | Keine IndexedDB-Queue vorhanden | Lokale Queue, Wiederholung, Konflikte und Duplikatschutz umsetzen |

## 8. Kommunikation, Nachsuche und Fährten

| Gewünschte Funktion | Status | Vorhanden und Fundstelle | Noch zu erledigen |
| --- | --- | --- | --- |
| Nachsuche oder Übungsfährte | Offen | Kein Datenmodell, keine API und keine UI | Start, Status, Ende, Sichtbarkeit und Löschung umsetzen |
| GPS-Fährtenaufzeichnung | Offen | Nur punktuelle Geolocation für Reviere und Streckeneinträge vorhanden | Vordergrundtracking, lokaler Punktpuffer und Routendarstellung fehlen |
| Android-Hintergrundtracking | Offen | Capacitor ist noch nicht eingerichtet | Plugin auswählen, Datenschutz und Akkuverbrauch auf echtem Gerät testen |
| Live-Ansicht für Mitglieder | Offen | Nicht vorhanden | Freigabemodell, Echtzeittransport und Kartenansicht entwickeln |
| Telegram-Benachrichtigungen | Offen | Nur E-Mail-Versand ist vorhanden | Bot, Chat-ID, Backend-Endpunkt, Ereignisformat und Kartenlink umsetzen |
| Push-Mitteilungen | Offen | Firebase ist nicht integriert | Geräte-Registrierung, FCM und Berechtigungsfluss umsetzen |

## 9. Offlinebetrieb und Synchronisation

| Gewünschte Funktion | Status | Vorhanden und Fundstelle | Noch zu erledigen |
| --- | --- | --- | --- |
| Daten ohne Verbindung erfassen | Offen | Formulare senden direkt an die API | IndexedDB-Datenspeicher und lokale Änderungsqueue |
| Spätere Synchronisation | Offen | Keine Synchronisationslogik | Wiederholungen, Idempotenz, Konfliktlösung und Statusanzeige |
| Offline-Kartenbereich | Offen | Karten verwenden externe Online-Kacheln | Lizenzkonformes Kartenpaket und Speicherverwaltung |
| Wiederanlauf nach App-Abbruch | Offen | Nicht gezielt implementiert oder getestet | Persistente Queue und Feldtests |

## 10. Qualität und Dokumentation

| Gewünschte Funktion | Status | Vorhanden und Fundstelle | Noch zu erledigen |
| --- | --- | --- | --- |
| Automatisierte Tests | Teilweise | Kanonische API-Store-Tests, Typechecks und Produktionsbuilds laufen erfolgreich | Routen-, Berechtigungs-, Komponenten- und End-to-End-Tests weiter ausbauen |
| Anwenderhandbuch | Teilweise | `docs/handbuch.md` beschreibt Profilpflege, Menüführung, Reservierungsregeln, Streckenrechte und Revierlöschung | Künftige Offline- und Mobilfunktionen nach ihrer Umsetzung ergänzen |
| Aktueller Entwicklungsplan | Fertig | Zielbild und aktueller Umsetzungsstand sind getrennt dokumentiert; veraltete feste Testzahlen wurden entfernt | Bei jeder größeren Funktion fortschreiben |
| Eindeutige Codebasis | Fertig | Produktiv verwendete englische Stores und Tests sind die alleinige Implementierung; alte deutsch benannte Duplikate wurden entfernt | Persistierte deutsche JSON-Dateinamen bleiben aus Kompatibilitätsgründen bestehen |
| Datenschutz und Betrieb | Teilweise | Grundregeln sind im Entwicklungsplan festgehalten | Einwilligung, Löschkonzept, Aufbewahrungsfristen und Betriebsdokumentation abschließen |

## Empfohlene nächste Reihenfolge

1. Offline-Queue zunächst für Streckeneinträge entwickeln.
2. PWA-Manifest, Service Worker und Capacitor-Grundlage einrichten.
3. Danach Bilder, Auswertungen, Telegram, Push und Fährtenaufzeichnung angehen.

## Kurzfazit

Der browserbasierte MVP für Reviere, Konten, Mitgliedschaften, Einrichtungen, Aufgaben, Reservierungen und Streckeneinträge ist weit fortgeschritten. Rechte an Streckeneinträgen, abgelaufene Reservierungen und Löschabhängigkeiten sind abgesichert. Die größten noch nicht begonnenen Produktbereiche sind Offlinebetrieb, mobile Auslieferung, Bilder, Kommunikation sowie Nachsuche und Fährtenaufzeichnung.
