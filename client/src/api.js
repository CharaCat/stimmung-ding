const API_BASE = import.meta.env.VITE_API_URL || '';

export async function getEntries({ limit = 500, fromTs, toTs } = {}) {
  const params = new URLSearchParams();
  if (limit != null) params.set('limit', String(limit));
  if (fromTs != null) params.set('fromTs', String(fromTs));
  if (toTs != null) params.set('toTs', String(toTs));
  const res = await fetch(`${API_BASE}/api/entries?${params.toString()}`);
  if (!res.ok) throw new Error('Failed to load entries');
  return res.json();
}

export async function addEntry({ score, note, createdTs }) {
  const res = await fetch(`${API_BASE}/api/entries`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ score, note, createdTs })
  });
  if (!res.ok) throw new Error('Failed to add entry');
  return res.json();
}

export async function deleteEntry(id) {
  const res = await fetch(`${API_BASE}/api/entries/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete');
  return res.json();
}

export async function getStats({ days, from, to, fromTs, toTs, granularity = 'day' } = {}) {
  const params = new URLSearchParams();
  if (days != null) params.set('days', String(days));
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (fromTs != null) params.set('fromTs', String(fromTs));
  if (toTs != null) params.set('toTs', String(toTs));
  if (granularity) params.set('granularity', granularity);
  const res = await fetch(`${API_BASE}/api/stats?${params.toString()}`);
  if (!res.ok) throw new Error('Failed to load stats');
  return res.json();
}

export async function getMeta() {
  const res = await fetch(`${API_BASE}/api/meta`);
  if (!res.ok) throw new Error('Failed to load meta');
  return res.json();
}
