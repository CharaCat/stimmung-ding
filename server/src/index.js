import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import dotenv from 'dotenv';
import { insertEntry, listEntries, deleteEntry, statsSummary, getBounds } from './db.js';
import path from 'path';
import fs from 'fs';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, time: new Date().toISOString() });
});

app.get('/api/meta', (_req, res) => {
  try {
    const meta = getBounds();
    res.json(meta);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/entries', (req, res) => {
  const { limit, from, to, fromTs, toTs } = req.query;
  try {
    const rows = listEntries({
      limit: limit ? Number(limit) : 500,
      from,
      to,
      fromTs: fromTs != null ? Number(fromTs) : undefined,
      toTs: toTs != null ? Number(toTs) : undefined,
    });
    res.json(rows);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post('/api/entries', (req, res) => {
  const { score, note, createdTs } = req.body || {};
  const n = Number(score);
  if (!Number.isInteger(n) || n < -10 || n > 10) {
    return res.status(400).json({ error: 'score must be integer between -10 and 10' });
  }
  try {
    let ts = undefined;
    if (createdTs != null) {
      const t = Number(createdTs);
      if (!Number.isFinite(t)) return res.status(400).json({ error: 'createdTs must be a number (milliseconds since epoch)' });
      ts = t;
    }
    const row = insertEntry(n, typeof note === 'string' ? note.trim() : null, ts);
    res.status(201).json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/entries/:id', (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: 'invalid id' });
  try {
    const ok = deleteEntry(id);
    if (!ok) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/stats', (req, res) => {
  const days = req.query.days ? Number(req.query.days) : undefined;
  const { from, to, fromTs, toTs, granularity } = req.query;
  try {
    const stats = statsSummary({
      days,
      from,
      to,
      fromTs: fromTs != null ? Number(fromTs) : undefined,
      toTs: toTs != null ? Number(toTs) : undefined,
      granularity: granularity || 'day'
    });
    res.json(stats);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Serve frontend build if available
const distPath = path.join(process.cwd(), 'client', 'dist');
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(distPath, 'index.html'));
  });
}

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;
app.listen(PORT, () => {
  console.log(`[server] listening on http://localhost:${PORT}`);
});
