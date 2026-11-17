// Netlify-Funktion (v2): Bestellung(en) aus der Admin-Liste loeschen.
// POST { sessionIds: ["cs_test_...", ...] }, nur mit Admin-Passwort (x-admin-key).
//
// Gedacht zum Aufraeumen von Testbestellungen. ACHTUNG: echte Bestellungen
// sind Geschaeftsunterlagen und muessen nach § 147 AO zehn Jahre aufbewahrt
// werden - die gehoeren hier nicht geloescht, sondern bleiben stehen.
// Die Zahlung selbst liegt ohnehin bei Stripe bzw. PayPal, hier verschwindet
// nur die Anzeige im Admin.

import { getStore } from '@netlify/blobs';
import { requireAdmin } from './_auth.mjs';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Nur POST erlaubt' }, 405);

  const gate = await requireAdmin(req);
  if (!gate.ok) return gate.res;

  let body;
  try { body = await req.json(); } catch (e) { return json({ error: 'Ungueltige Daten' }, 400); }

  const wanted = (Array.isArray(body && body.sessionIds) ? body.sessionIds : [body && body.sessionId])
    .map((v) => String(v || '').trim()).filter(Boolean);
  if (wanted.length === 0) return json({ error: 'Keine Bestellung angegeben' }, 400);
  const hit = new Set(wanted);

  const store = getStore('shop');
  const orders = (await store.get('orders', { type: 'json' })) || [];
  const kept = orders.filter((o) => !hit.has(String((o && o.sessionId) || '')));
  const removed = orders.length - kept.length;
  if (removed > 0) await store.setJSON('orders', kept);

  return json({ ok: true, geloescht: removed, verbleibend: kept.length });
};
