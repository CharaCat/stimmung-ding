import { useEffect, useMemo, useState } from 'react'
import dayjs from 'dayjs'
import { addEntry, deleteEntry, getEntries, getStats, getMeta } from './api'

function pad(n) { return String(n).padStart(2, '0') }
function formatLocalDateTime(d) {
  const y = d.getFullYear()
  const m = pad(d.getMonth() + 1)
  const day = pad(d.getDate())
  const hh = pad(d.getHours())
  const mm = pad(d.getMinutes())
  return `${y}-${m}-${day}T${hh}:${mm}`
}

export default function MobileApp() {
  const [score, setScore] = useState(0)
  const [note, setNote] = useState('')
  const [when, setWhen] = useState(formatLocalDateTime(new Date()))
  const [submitting, setSubmitting] = useState(false)
  const [items, setItems] = useState([])
  const [stats, setStats] = useState(null)
  const [error, setError] = useState('')

  const color = useMemo(() => {
    const t = (score + 10) / 20
    const r = Math.round(255 * (1 - t))
    const g = Math.round(180 * t + 60 * (1 - t))
    return `rgb(${r}, ${g}, 100)`
  }, [score])

  async function refresh() {
    try {
      const m = await getMeta()
      const now = Date.now()
      const latest = (typeof m?.last_ts === 'number' && m.last_ts > 0) ? m.last_ts : now
      const days = 30
      const toTs = Math.max(now, latest)
      const fromTs = toTs - days * 24 * 3600 * 1000
      const [list, s] = await Promise.all([
        getEntries({ limit: 1000, fromTs, toTs }),
        getStats({ granularity: 'day', fromTs, toTs }),
      ])
      setItems(list)
      setStats(s)
    } catch (e) {
      setError(String(e.message || e))
    }
  }

  useEffect(() => { refresh() }, [])

  async function onSubmit(e) {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const createdTsVal = when ? new Date(when).getTime() : undefined
      const createdTs = Number.isFinite(createdTsVal) ? createdTsVal : undefined
      await addEntry({ score, note, createdTs })
      setNote('')
      setWhen(formatLocalDateTime(new Date()))
      await refresh()
    } catch (e) {
      setError(String(e.message || e))
    } finally {
      setSubmitting(false)
    }
  }

  async function onDelete(id) {
    if (!confirm('Eintrag löschen?')) return
    try { await deleteEntry(id); await refresh() } catch (e) { setError(String(e.message || e)) }
  }

  return (
    <div className="wrapper mobile">
      <div className="mobile-snap">
        <section className="snap-section">
          <header className="header">
            <h1>Stimmung</h1>
            <div className="subtitle">Mobile – kompakt, klar, schnell</div>
          </header>
          <div className="card form-card mobile-card">
            <h2>Neuer Eintrag</h2>
            <form onSubmit={onSubmit}>
            <div className="score-block">
              <button type="button" className="primary btn-big" onClick={() => setScore(s => Math.max(-10, s - 1))}>−</button>
              <div className="score-display" aria-live="polite" style={{ borderColor: color }}>{score}</div>
              <button type="button" className="primary btn-big" onClick={() => setScore(s => Math.min(10, s + 1))}>+</button>
            </div>

          <input className="range-big" type="range" min="-10" max="10" step="1" value={score}
            onChange={(e) => setScore(parseInt(e.target.value))} style={{ accentColor: color }} />

          <textarea className="input-big" placeholder="Details (optional)" value={note} onChange={(e) => setNote(e.target.value)} rows={4} />

          <div className="row when-row">
            <label htmlFor="when-m">Datum/Zeit</label>
            <input id="when-m" className="input-big" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
            <button type="button" className="ghost btn-big" onClick={() => setWhen(formatLocalDateTime(new Date()))}>Jetzt</button>
          </div>

              <button className="primary btn-xl" type="submit" disabled={submitting}>
                {submitting ? 'Speichere…' : 'Speichern'}
              </button>
              {error && <div className="error" role="status">{error}</div>}
            </form>
          </div>
        </section>

        <section className="snap-section">
          <div className="card mobile-card">
            <h2>Übersicht</h2>
            <div className="stats mobile-stats">
              <div className="stat"><div className="stat-label">Einträge</div><div className="stat-value">{stats?.count ?? 0}</div></div>
              <div className="stat"><div className="stat-label">Ø</div><div className="stat-value">{stats?.avg?.toFixed?.(1) ?? '–'}</div></div>
              <div className="stat"><div className="stat-label">Min</div><div className="stat-value">{stats?.min ?? '–'}</div></div>
              <div className="stat"><div className="stat-label">Max</div><div className="stat-value">{stats?.max ?? '–'}</div></div>
            </div>
          </div>
        </section>

        <section className="snap-section">
          <div className="card mobile-card">
            <h2>Letzte Einträge</h2>
            <ul className="entries mobile-entries">
              {items.slice().reverse().slice(0, 30).map((e) => (
                <li key={e.id} className="entry tap">
                  <div className="entry-left">
                    <div className="entry-score" style={{ backgroundColor: `rgba(0,0,0,0.06)` }}>
                      <span style={{ color: scoreColor(e.score) }}>{e.score}</span>
                    </div>
                    <div className="entry-main">
                      <div className="entry-meta">{dayjs(e.created_ts).format('DD.MM.YYYY HH:mm')}</div>
                      {e.note && <div className="entry-note">{e.note}</div>}
                    </div>
                  </div>
                  <button className="ghost btn-big" onClick={() => onDelete(e.id)}>Löschen</button>
                </li>
              ))}
            </ul>
            <footer className="footer">Tippen zum Ändern, lange Listen sind scrollbar.</footer>
          </div>
        </section>
      </div>
    </div>
  )
}

function scoreColor(s) {
  const t = (s + 10) / 20
  const r = Math.round(255 * (1 - t))
  const g = Math.round(180 * t + 60 * (1 - t))
  return `rgb(${r}, ${g}, 100)`
}
