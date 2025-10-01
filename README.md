Stimmungsbild Statistik
=======================

Eine kleine Full‑Stack‑App, um deine Stimmung (−10 bis +10) mit Notizen zu erfassen und schöne Statistiken zu sehen. Frontend in React (Vite), Backend in Express mit SQLite.

Entwicklung
-----------

- Voraussetzungen: Node.js 18+ (inkl. npm)
- Dev‑Server starten (Frontend + Backend):

```
npm run dev
```

- Backend allein: `npm run server` (läuft auf `http://localhost:4000`)
- Frontend allein: `npm run client` (läuft auf `http://localhost:5173`, proxyt `/api` → Backend)

Produktion
----------

1. Frontend bauen:
```
npm run build
```
2. Server starten (liefert API und das gebaute Frontend aus):
```
npm start
```
3. Port‑Forwarding nach Bedarf einrichten (Standardport Backend: `4000`).

Datenhaltung
------------

- SQLite‑Datei unter `server/data/mood.sqlite3`.
- Tabelle: `entries(id, created_at, score, note)`.

API (Kurz)
----------

- `GET /api/entries?limit=500` → Liste der Einträge (alt → neu)
- `POST /api/entries` → `{ score: -10..10, note?: string }`
- `DELETE /api/entries/:id`
- `GET /api/stats?days=30` → Aggregierte Statistik und Tagesdurchschnitte

Anpassungen
-----------

- `PORT` (Backend) via Umgebungsvariable setzbar.
- Optional `VITE_API_URL` im Frontend setzen, falls kein Proxy genutzt wird.

