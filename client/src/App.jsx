import { useEffect, useMemo, useRef, useState } from 'react'
import './App.css'
import './index.css'
import dayjs from 'dayjs'
import { addEntry, deleteEntry, getEntries, getStats, getMeta } from './api'
import { Line } from 'react-chartjs-2'
import {
  Chart as ChartJS,
  TimeScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js'
import zoomPlugin from 'chartjs-plugin-zoom'
import 'chartjs-adapter-dayjs-4'
import MobileApp from './MobileApp'

// subtle glow for datasets (lines/points) via canvas shadows
const glowPlugin = {
  id: 'glow',
  beforeDatasetDraw(chart, args) {
    const ds = chart.data.datasets?.[args.index]
    if (!ds || !ds.glow) return
    const ctx = chart.ctx
    ctx.save()
    ctx.shadowColor = ds.glowColor || 'rgba(16,185,129,0.6)'
    ctx.shadowBlur = ds.glowBlur ?? 14
    ctx.shadowOffsetX = 0
    ctx.shadowOffsetY = 0
  },
  afterDatasetDraw(chart, args) {
    const ds = chart.data.datasets?.[args.index]
    if (!ds || !ds.glow) return
    chart.ctx.restore()
  }
}

ChartJS.register(TimeScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler, zoomPlugin, glowPlugin)

function Stat({ label, value }) {
  return (
    <div className="stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  )
}

function App() {
  const isMobile = useMemo(() => {
    try {
      const ua = navigator.userAgent || ''
      const coarse = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches
      const narrow = typeof window !== 'undefined' ? window.innerWidth <= 820 : false
      return /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua) || coarse || narrow
    } catch { return false }
  }, [])

  if (isMobile) return <MobileApp />
  const [score, setScore] = useState(0)
  const [note, setNote] = useState('')
  const [when, setWhen] = useState(formatLocalDateTime(new Date()))
  const [submitting, setSubmitting] = useState(false)
  const [items, setItems] = useState([])
  const [stats, setStats] = useState(null)
  const [view, setView] = useState('day') // 'day' | 'week' | 'month'
  const [error, setError] = useState('')
  const [range, setRange] = useState(null) // {fromTs, toTs}
  const chartRef = useRef(null)
  const [meta, setMeta] = useState(null)
  const chartCardRef = useRef(null)
  const panStartRef = useRef(null)
  const [selectedEntry, setSelectedEntry] = useState(null)

  const color = useMemo(() => {
    // map -10..10 to red..green
    const t = (score + 10) / 20
    const r = Math.round(255 * (1 - t))
    const g = Math.round(180 * t + 60 * (1 - t))
    return `rgb(${r}, ${g}, 100)`
  }, [score])

  function defaultDaysFor(view) {
    if (view === 'month') return 24 * 30; // ~24 Monate (~730 Tage)
    if (view === 'week') return 26 * 7;   // ~26 Wochen (~182 Tage)
    return 60; // 60 Tage
  }

  async function refresh(nextView = view, nextRange = range) {
    try {
      const m = await getMeta()
      setMeta(m)

      const days = defaultDaysFor(nextView)
      const now = Date.now()
      const latest = (typeof m?.last_ts === 'number' && m.last_ts > 0) ? m.last_ts : now

      let statsArgs = { granularity: nextView }
      let entriesArgs = { limit: 5000 }
      if (nextRange && nextRange.fromTs && nextRange.toTs) {
        statsArgs.fromTs = nextRange.fromTs
        statsArgs.toTs = nextRange.toTs
        entriesArgs.fromTs = nextRange.fromTs
        entriesArgs.toTs = nextRange.toTs
      } else {
        const toTs = Math.max(now, latest)
        const fromTs = toTs - days * 24 * 3600 * 1000
        // Use explicit range so future-datierte Einträge enthalten sind
        statsArgs.fromTs = fromTs
        statsArgs.toTs = toTs
        entriesArgs.fromTs = fromTs
        entriesArgs.toTs = toTs
      }

      const [list, s] = await Promise.all([
        getEntries(entriesArgs),
        getStats(statsArgs),
      ])
      setItems(list)
      setStats(s)
    } catch (e) {
      setError(String(e.message || e))
    }
  }

  useEffect(() => {
    refresh()
  }, [])

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
      if (typeof createdTs === 'number') {
        const windowDays = defaultDaysFor(view)
        const halfMs = Math.max(1, Math.round(windowDays / 2)) * 24 * 3600 * 1000
        const newRange = { fromTs: createdTs - halfMs, toTs: createdTs + halfMs }
        setRange(newRange)
        await refresh(view, newRange)
      } else {
        await refresh()
      }
    } catch (e) {
      setError(String(e.message || e))
    } finally {
      setSubmitting(false)
    }
  }

  async function onDelete(id) {
    if (!confirm('Eintrag löschen?')) return
    try {
      await deleteEntry(id)
      await refresh()
    } catch (e) {
      setError(String(e.message || e))
    }
  }

  const chartData = useMemo(() => {
    const aggPoints = (stats?.series || [])
      .map(d => ({ x: d.ts, y: d.avg }))
      .sort((a, b) => a.x - b.x)
    const rawPoints = (items || [])
      .map(e => ({ x: e.created_ts, y: e.score, note: e.note, id: e.id }))
      .sort((a, b) => a.x - b.x)
    const many = rawPoints.length > 800
    const gapLimit = (
      view === 'day' ? 3 * 24 * 3600 * 1000 :
      view === 'week' ? 21 * 24 * 3600 * 1000 :
      62 * 24 * 3600 * 1000
    )
    return {
      datasets: [
        {
          type: 'scatter',
          label: 'Einträge',
          data: rawPoints,
          pointRadius: many ? 1 : 3,
          pointHoverRadius: many ? 2 : 4,
          pointHitRadius: many ? 1 : 2,
          // Connect raw points in all views
          showLine: true,
          cubicInterpolationMode: 'monotone',
          tension: 0.25,
          spanGaps: true,
          borderWidth: 2.25,
          borderColor: 'rgba(59,130,246,0.5)',
          fill: true,
          backgroundColor: (ctx) => {
            const chart = ctx.chart
            const area = chart.chartArea
            if (!area) return 'rgba(99,102,241,0.08)'
            const g = chart.ctx.createLinearGradient(0, area.top, 0, area.bottom)
            g.addColorStop(0, 'rgba(99,102,241,0.18)')
            g.addColorStop(1, 'rgba(16,185,129,0.06)')
            return g
          },
          pointBackgroundColor: (ctx) => colorForScore(ctx.raw?.y ?? 0),
          segment: {
            borderColor: (ctx) => {
              const { p0, p1, chart } = ctx
              if (!p0 || !p1) return 'rgba(99,102,241,0.65)'
              const g = chart.ctx.createLinearGradient(p0.x, p0.y, p1.x, p1.y)
              const y0 = p0.parsed?.y ?? 0
              const y1 = p1.parsed?.y ?? 0
              g.addColorStop(0, colorForScore(y0))
              g.addColorStop(1, colorForScore(y1))
              return g
            }
          },
          glow: true,
          glowColor: 'rgba(99,102,241,0.55)',
          glowBlur: 22,
          order: 1,
        }
      ],
    }
  }, [stats, view, items])

  const chartOptions = {
    responsive: true,
    parsing: false,
    // light animation to feel smoother without being sluggish
    animation: { duration: 150, easing: 'easeOutQuad' },
    normalized: true,
    interaction: { mode: 'nearest', intersect: false },
    onHover: (evt, activeEls, chart) => {
      const el = evt?.native?.target
      const els = chart?.getElementsAtEventForMode?.(evt, 'point', { intersect: true }, true) || []
      if (el) el.style.cursor = els.length ? 'pointer' : 'default'
    },
    onClick: (evt, activeEls, chart) => {
      const els = chart.getElementsAtEventForMode(evt, 'point', { intersect: true }, true)
      if (!els || !els.length) { setSelectedEntry(null); return }
      const { datasetIndex, index } = els[0]
      const ds = chart.data.datasets?.[datasetIndex]
      // we only make points from the 'Einträge' dataset clickable
      if (!ds || ds.label !== 'Einträge') { setSelectedEntry(null); return }
      const pt = ds.data?.[index]
      if (pt) setSelectedEntry({ ts: pt.x, score: pt.y, note: pt.note, id: pt.id })
    },
    maintainAspectRatio: false,
    scales: {
      x: {
        type: 'time',
        time: { unit: view === 'day' ? 'day' : view === 'week' ? 'week' : 'month' },
        ticks: { autoSkip: true },
        // When a custom range is active, bind the scale to it.
        // Otherwise, let Chart.js size to the data and only suggest padding.
        min: range?.fromTs ?? undefined,
        max: range?.toTs ?? undefined,
        suggestedMin: typeof meta?.first_ts === 'number'
          ? meta.first_ts - Math.max(7 * 24 * 3600 * 1000, 0.05 * Math.max(0, (meta.last_ts ?? meta.first_ts) - meta.first_ts))
          : undefined,
        suggestedMax: typeof meta?.last_ts === 'number'
          ? meta.last_ts + Math.max(7 * 24 * 3600 * 1000, 0.05 * Math.max(0, meta.last_ts - (meta.first_ts ?? meta.last_ts)))
          : undefined,
      },
      y: { min: -10, max: 10, ticks: { stepSize: 5 } },
    },
    plugins: {
      legend: { display: false },
      zoom: {
        pan: {
          enabled: true,
          mode: 'x',
          // small threshold to avoid accidental pans on click
          threshold: 2,
        },
        // allow zoom out beyond the original data extent
        zoom: {
          wheel: { enabled: true, speed: 0.05 },
          pinch: { enabled: true },
          drag: { enabled: false },
          mode: 'x',
          limits: { x: { minRange: 24 * 3600 * 1000 } }, // don't allow collapsing to < 1 day
        },
        onPanStart: ({ chart }) => {
          const s = chart.scales.x
          panStartRef.current = { min: s.min, max: s.max }
        },
        onZoomComplete: ({ chart }) => {
          const s = chart.scales.x
          const min = s.min, max = s.max
          if (typeof min !== 'number' || typeof max !== 'number') return
          const spanDays = (max - min) / (24 * 3600 * 1000)
          const current = view
          let next = current
          if (current === 'month' && spanDays < 90) next = 'week'
          if (current !== 'day' && spanDays < 21) next = 'day'
          if (current === 'day' && spanDays > 90) next = 'month'
          else if (current === 'day' && spanDays > 45) next = 'week'
          else if (current === 'week' && spanDays > 180) next = 'month'
          if (next !== current) {
            setView(next)
            const newRange = { fromTs: Math.round(min), toTs: Math.round(max) }
            setRange(newRange)
            refresh(next, newRange)
          } else {
            setRange({ fromTs: Math.round(min), toTs: Math.round(max) })
          }
        },
        onPanComplete: ({ chart }) => {
          const s = chart.scales.x
          const min = s.min, max = s.max
          if (typeof min !== 'number' || typeof max !== 'number') return
          // Inertia: continue panning a bit after release
          try {
            const start = panStartRef.current
            if (start && typeof start.min === 'number' && typeof start.max === 'number') {
              const startCenter = (start.min + start.max) / 2
              const endCenter = (min + max) / 2
              const deltaValue = endCenter - startCenter
              const scale = chart.scales.x
              const px0 = scale.getPixelForValue(endCenter)
              const px1 = scale.getPixelForValue(endCenter + deltaValue)
              let deltaPx = px1 - px0
              let steps = 20
              let k = 0.9
              const stepPan = () => {
                if (steps-- <= 0 || Math.abs(deltaPx) < 0.5) return
                chart.pan({ x: deltaPx }, undefined, 'default')
                deltaPx *= k
                requestAnimationFrame(stepPan)
              }
              if (Math.abs(deltaPx) > 5) stepPan()
            }
          } catch {}
          setRange({ fromTs: Math.round(min), toTs: Math.round(max) })
          refresh(view, { fromTs: Math.round(min), toTs: Math.round(max) })
        }
      },
    },
  }

  return (
    <div className="wrapper">
      <header className="header">
        <h1>Stimmungsbild</h1>
        <p className="subtitle">Dein persönliches Stimmungs-Journal</p>
      </header>

      <section className="card form-card">
        <h2>Eintrag erstellen</h2>
        <form onSubmit={onSubmit}>
          <div className="slider-row">
            <span className="range-label">-10</span>
            <input
              type="range"
              min="-10"
              max="10"
              step="1"
              value={score}
              onChange={(e) => setScore(parseInt(e.target.value))}
              style={{ accentColor: color }}
            />
            <span className="range-label">+10</span>
            <div className="score-pill" style={{ backgroundColor: color }}>{score}</div>
          </div>
          <textarea
            placeholder="Details (optional): Was ist passiert? Wie fühlst du dich?"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
          />
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 12, alignItems: 'center' }}>
            <label htmlFor="when">Datum/Zeit</label>
            <input id="when" type="datetime-local" value={when}
              onChange={(e) => setWhen(e.target.value)} />
            <button type="button" className="ghost" onClick={() => setWhen(formatLocalDateTime(new Date()))}>Jetzt</button>
          </div>
          <button className="primary" type="submit" disabled={submitting}>
            {submitting ? 'Speichere…' : 'Speichern'}
          </button>
          {error && <div className="error">{error}</div>}
        </form>
      </section>

      {/* Übersicht groß unter dem Formular */}
      <section className="card overview-card">
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
            <h2>Übersicht</h2>
            <div className="segmented" role="tablist" aria-label="Ansicht">
              <button className={view==='day'? 'seg on':'seg'} onClick={() => { setView('day'); setRange(null); refresh('day', null) }}>Tag</button>
              <button className={view==='week'? 'seg on':'seg'} onClick={() => { setView('week'); setRange(null); refresh('week', null) }}>Woche</button>
              <button className={view==='month'? 'seg on':'seg'} onClick={() => { setView('month'); setRange(null); refresh('month', null) }}>Monat</button>
            </div>
            <button className="ghost" onClick={() => { try { chartRef.current?.resetZoom?.(); setRange(null); refresh(view, null) } catch {} }}>Reset Zoom</button>
          </div>
            <div className="stats">
              <Stat label="Einträge" value={stats?.count ?? 0} />
              <Stat label="Durchschnitt" value={stats?.avg?.toFixed?.(2) ?? '–'} />
              <Stat label="Min" value={stats?.min ?? '–'} />
              <Stat label="Max" value={stats?.max ?? '–'} />
            </div>
          <div className="chart-wrap">
            <div className="chart-card" ref={chartCardRef}>
              <div className="chart-actions">
                <button className="ghost" onClick={() => { try { chartRef.current?.resetZoom?.(); setRange(null); refresh(view, null) } catch {} }}>Reset Zoom</button>
                <button className="ghost" onClick={() => toggleFullScreen(chartCardRef.current)}>Fullscreen</button>
              </div>
              <Line ref={chartRef} data={chartData} options={chartOptions} />
            </div>
          </div>
          {selectedEntry && (
            <div className="entry featured" style={{ marginTop: 12 }}>
              <div className="entry-left">
                <div className="entry-score" style={{ backgroundColor: `rgba(0,0,0,0.06)` }}>
                  <span style={{ color: colorForScore(selectedEntry.score) }}>{selectedEntry.score}</span>
                </div>
                <div className="entry-main">
                  <div className="entry-meta">{dayjs(selectedEntry.ts).format('DD.MM.YYYY HH:mm')}</div>
                  <div className="entry-note">{selectedEntry.note || 'Kein Text vorhanden.'}</div>
                </div>
              </div>
              <button className="ghost" onClick={() => setSelectedEntry(null)}>Schließen</button>
            </div>
          )}
      </section>

      {/* Letzte Einträge unter der Übersicht */}
      <section className="card">
          <h2>Letzte Einträge</h2>
          <ul className="entries">
            {items.slice().reverse().slice(0, 20).map((e) => (
              <li key={e.id} className={"entry" + (selectedEntry?.id === e.id ? " selected" : "")}>
                <div className="entry-left">
                  <div className="entry-score" style={{ backgroundColor: `rgba(0,0,0,0.06)` }}>
                    <span style={{ color: colorForScore(e.score) }}>{e.score}</span>
                  </div>
                  <div className="entry-main">
                    <div className="entry-meta">
                      {dayjs(e.created_ts).format('DD.MM.YYYY HH:mm')}
                    </div>
                    {e.note && <div className="entry-note">{e.note}</div>}
                  </div>
                </div>
                <button className="ghost" onClick={() => onDelete(e.id)}>Löschen</button>
              </li>
            ))}
          </ul>
      </section>

      <footer className="footer">Läuft lokal – forwarde Port nach Bedarf. Tipp: Mausrad/Pinch zum Zoomen, Drag zum Pannen.</footer>
    </div>
  )
}

function colorForScore(s) {
  const t = (s + 10) / 20
  const r = Math.round(255 * (1 - t))
  const g = Math.round(180 * t + 60 * (1 - t))
  return `rgb(${r}, ${g}, 100)`
}

export default App

function toggleFullScreen(el) {
  if (!el) return
  const d = document
  if (!d.fullscreenElement && el.requestFullscreen) {
    el.requestFullscreen().catch(() => {})
  } else if (d.exitFullscreen) {
    d.exitFullscreen().catch(() => {})
  }
}

function pad(n) { return String(n).padStart(2, '0') }
function formatLocalDateTime(d) {
  const y = d.getFullYear()
  const m = pad(d.getMonth() + 1)
  const day = pad(d.getDate())
  const hh = pad(d.getHours())
  const mm = pad(d.getMinutes())
  return `${y}-${m}-${day}T${hh}:${mm}`
}
