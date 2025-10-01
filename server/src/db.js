import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const dataDir = path.join(process.cwd(), 'server', 'data');
const dbPath = path.join(dataDir, 'mood.sqlite3');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(dbPath);

db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at TEXT NOT NULL,
    created_ts INTEGER NOT NULL,
    score INTEGER NOT NULL CHECK(score BETWEEN -10 AND 10),
    note TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_entries_created_at ON entries(created_at);
`);

// Migration: add created_ts if missing and backfill
const cols = db.prepare("PRAGMA table_info(entries)").all();
const hasTs = cols.some(c => c.name === 'created_ts');
if (!hasTs) {
  db.exec('ALTER TABLE entries ADD COLUMN created_ts INTEGER');
  db.exec("UPDATE entries SET created_ts = CAST(strftime('%s', created_at) AS INTEGER) * 1000 WHERE created_ts IS NULL");
}
// Ensure index on created_ts exists after column is present
db.exec('CREATE INDEX IF NOT EXISTS idx_entries_created_ts ON entries(created_ts)');

export function insertEntry(score, note, createdTsInput) {
  const ts = (createdTsInput != null && Number.isFinite(Number(createdTsInput)))
    ? Number(createdTsInput)
    : Date.now();
  const createdTs = ts;
  const createdAt = new Date(createdTs).toISOString();
  const stmt = db.prepare(
    'INSERT INTO entries (created_at, created_ts, score, note) VALUES (?, ?, ?, ?)' 
  );
  const info = stmt.run(createdAt, createdTs, score, note ?? null);
  return { id: info.lastInsertRowid, created_at: createdAt, created_ts: createdTs, score, note: note ?? null };
}

export function listEntries({ limit = 500, from, to, fromTs, toTs } = {}) {
  let sql = 'SELECT * FROM entries';
  const where = [];
  const params = [];
  if (fromTs != null) { where.push('created_ts >= ?'); params.push(Number(fromTs)); }
  if (toTs != null) { where.push('created_ts <= ?'); params.push(Number(toTs)); }
  if (from && !fromTs) { where.push('created_at >= ?'); params.push(from); }
  if (to && !toTs) { where.push('created_at <= ?'); params.push(to); }
  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ORDER BY created_ts ASC';
  if (limit) sql += ` LIMIT ${Number(limit)}`;
  return db.prepare(sql).all(...params);
}

export function deleteEntry(id) {
  const stmt = db.prepare('DELETE FROM entries WHERE id = ?');
  const info = stmt.run(id);
  return info.changes > 0;
}

export function getBounds() {
  const row = db.prepare('SELECT MIN(created_ts) as first_ts, MAX(created_ts) as last_ts, COUNT(*) as count FROM entries').get();
  return row || { first_ts: null, last_ts: null, count: 0 };
}

function isoWeekKey(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = (d.getUTCDay() + 6) % 7; // 0=Mon..6=Sun
  d.setUTCDate(d.getUTCDate() - dayNum + 3); // Thursday of this ISO week
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstThursdayDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstThursdayDayNum + 3);
  const week = 1 + Math.round((d - firstThursday) / (7 * 24 * 3600 * 1000));
  const year = d.getUTCFullYear();
  return `${year}-W${String(week).padStart(2, '0')}`;
}

function monthKey(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

export function statsSummary({ days = 30, from, to, fromTs, toTs, granularity = 'day' } = {}) {
  let where = '';
  const params = [];
  if (fromTs != null && toTs != null) { where = 'WHERE created_ts >= ? AND created_ts <= ?'; params.push(Number(fromTs), Number(toTs)); }
  else if (fromTs != null) { where = 'WHERE created_ts >= ?'; params.push(Number(fromTs)); }
  else if (toTs != null) { where = 'WHERE created_ts <= ?'; params.push(Number(toTs)); }
  else if (from && to) { where = 'WHERE created_at >= ? AND created_at <= ?'; params.push(from, to); }
  else if (from) { where = 'WHERE created_at >= ?'; params.push(from); }
  else if (to) { where = 'WHERE created_at <= ?'; params.push(to); }
  else { const sinceTs = Date.now() - days * 24 * 3600 * 1000; where = 'WHERE created_ts >= ?'; params.push(sinceTs); }

  const rows = db
    .prepare(`SELECT * FROM entries ${where} ORDER BY created_ts ASC`)
    .all(...params);

  const count = rows.length;
  if (count === 0) return { count: 0, avg: null, min: null, max: null, last: null, granularity, series: [] };

  let sum = 0;
  let min = rows[0].score;
  let max = rows[0].score;
  for (const r of rows) { sum += r.score; if (r.score < min) min = r.score; if (r.score > max) max = r.score; }

  const byKey = new Map();
  for (const r of rows) {
    const d = new Date(r.created_ts);
    let key;
    if (granularity === 'month') key = monthKey(d);
    else if (granularity === 'week') key = isoWeekKey(d);
    else key = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString().slice(0,10);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(r.score);
  }
  const series = Array.from(byKey.entries()).map(([key, scores]) => {
    let ts;
    if (granularity === 'month') {
      const [y, m] = key.split('-').map(Number); ts = Date.UTC(y, m - 1, 1);
    } else if (granularity === 'week') {
      // approximate: take Thursday of ISO week then return Monday as bucket ts
      const [y, wStr] = key.split('-W');
      const yNum = Number(y), wNum = Number(wStr);
      const jan4 = new Date(Date.UTC(yNum, 0, 4));
      const jan4Day = (jan4.getUTCDay() + 6) % 7; // 0=Mon
      const mondayWeek1 = new Date(jan4); mondayWeek1.setUTCDate(jan4.getUTCDate() - jan4Day);
      const monday = new Date(mondayWeek1); monday.setUTCDate(mondayWeek1.getUTCDate() + (wNum - 1) * 7);
      ts = monday.getTime();
    } else {
      const [y, m, d] = key.split('-').map(Number); ts = Date.UTC(y, m - 1, d);
    }
    return ({
      key,
      ts,
      avg: scores.reduce((a, b) => a + b, 0) / scores.length,
      min: Math.min(...scores),
      max: Math.max(...scores),
    })
  }).sort((a, b) => a.ts - b.ts);

  return {
    count,
    avg: sum / count,
    min,
    max,
    last: rows[rows.length - 1],
    granularity,
    series,
  };
}

export default db;
