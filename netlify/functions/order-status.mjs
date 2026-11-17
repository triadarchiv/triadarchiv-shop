// Netlify-Funktion (v2): Bestellung als storniert/erstattet markieren,
// Storno zuruecknehmen, oder die Artikel der Bestellung wieder einstellen.
// POST { sessionId, action: "cancel" | "uncancel" | "restock" }
// Nur mit Admin-Passwort (x-admin-key). Speicher: Netlify Blobs ("shop").
//
// Hier bewegt sich KEIN Geld. Die Erstattung macht Fabi in Stripe bzw. PayPal;
// diese Funktion haelt nur fest, dass es passiert ist, damit der Admin den
// Stand zeigt. Die Bestellung bleibt in der Liste stehen - sie ist eine
// Geschaeftsunterlage (§ 147 AO).

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

  const sessionId = String((body && body.sessionId) || '').trim();
  const action = String((body && body.action) || '').trim();
  if (!sessionId) return json({ error: 'sessionId fehlt' }, 400);
  if (!['cancel', 'uncancel', 'restock'].includes(action)) {
    return json({ error: 'Unbekannte Aktion' }, 400);
  }

  const store = getStore('shop');
  const orders = (await store.get('orders', { type: 'json' })) || [];
  const order = orders.find((o) => o.sessionId === sessionId);
  if (!order) return json({ error: 'Bestellung nicht gefunden' }, 404);

  if (action === 'cancel') {
    order.cancelled = true;
    order.cancelledDate = new Date().toISOString();
    await store.setJSON('orders', orders);
    return json({ ok: true, cancelled: true });
  }

  if (action === 'uncancel') {
    order.cancelled = false;
    delete order.cancelledDate;
    await store.setJSON('orders', orders);
    return json({ ok: true, cancelled: false });
  }

  // --- restock: Artikel dieser Bestellung zurueck in den Shop ---
  // Menge je Artikel aus items[] nehmen, sonst 1 Stueck annehmen.
  const mengen = {};
  if (Array.isArray(order.items) && order.items.length) {
    for (const it of order.items) {
      const id = String((it && it.id) || '').trim();
      if (id) mengen[id] = (mengen[id] || 0) + (Number(it.qty) > 0 ? Number(it.qty) : 1);
    }
  }
  if (Object.keys(mengen).length === 0) {
    for (const raw of String(order.productIds || '').split(',')) {
      const id = raw.trim();
      if (id) mengen[id] = (mengen[id] || 0) + 1;
    }
  }
  if (Object.keys(mengen).length === 0) {
    return json({ error: 'Zu dieser Bestellung sind keine Artikel gespeichert' }, 400);
  }

  const products = (await store.get('products', { type: 'json' })) || [];
  const wieder = [];
  for (const p of products) {
    const id = String(p && p.id);
    if (!(id in mengen)) continue;
    const alt = typeof p.stock === 'number' ? p.stock : 0;
    p.stock = alt + mengen[id];
    p.sold = false;
    wieder.push({ id, name: p.name || '', stock: p.stock });
  }
  if (wieder.length === 0) {
    return json({ error: 'Artikel nicht mehr im Bestand gefunden' }, 404);
  }

  await store.setJSON('products', products);
  order.restocked = true;
  order.restockedDate = new Date().toISOString();
  await store.setJSON('orders', orders);

  return json({ ok: true, wieder });
};
