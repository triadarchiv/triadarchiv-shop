// Einfache Versuchsbegrenzung ueber Netlify Blobs, pro IP und Zweck ("bucket").
// Faellt der Speicher aus, wird NICHT blockiert - eine kaputte Bremse darf den
// Shop nicht lahmlegen. Der Schutz ist eine Huerde gegen Automaten, kein Tresor.

import { getStore } from '@netlify/blobs';

export function clientIp(req) {
  const h = req.headers;
  const ip =
    h.get('x-nf-client-connection-ip') ||
    (h.get('x-forwarded-for') || '').split(',')[0].trim() ||
    '';
  return ip || 'unknown';
}

function store() { return getStore('ratelimit'); }

// Nur lesen: ist diese IP fuer diesen Zweck gerade gesperrt?
export async function isBlocked(bucket, id, limit, windowMs) {
  try {
    const rec = await store().get(`${bucket}:${id}`, { type: 'json' });
    if (!rec) return { blocked: false };
    if (Date.now() - rec.start > windowMs) return { blocked: false };
    if (rec.n < limit) return { blocked: false };
    return { blocked: true, retryAfter: Math.max(1, Math.ceil((rec.start + windowMs - Date.now()) / 1000)) };
  } catch (e) {
    return { blocked: false };
  }
}

// Einen Fehlversuch zaehlen.
export async function countFail(bucket, id, windowMs) {
  try {
    const s = store();
    const key = `${bucket}:${id}`;
    let rec = await s.get(key, { type: 'json' });
    if (!rec || Date.now() - rec.start > windowMs) rec = { start: Date.now(), n: 0 };
    rec.n += 1;
    await s.setJSON(key, rec);
    return rec.n;
  } catch (e) {
    return 0;
  }
}

// Zaehler loeschen (nach erfolgreicher Anmeldung).
export async function resetLimit(bucket, id) {
  try { await store().delete(`${bucket}:${id}`); } catch (e) {}
}
