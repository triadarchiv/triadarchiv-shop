// Netlify-Funktion (v2): zaehlt Besuche je Kampagne (utm_source/utm_campaign).
//
// Bewusst datensparsam: gespeichert wird NUR ein Zaehler je Quelle und Tag.
// Keine IP, kein Cookie, keine Kennung des Besuchers - damit sind es keine
// personenbezogenen Daten und es braucht kein Einwilligungsbanner.
//
// POST { source, campaign }  -> zaehlt hoch (oeffentlich, vom Shop aufgerufen)
// GET                        -> Auswertung fuer den Admin (x-admin-key)

import { getStore } from '@netlify/blobs';
import { requireAdmin } from './_auth.mjs';

const json = (o, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });

const clean = (v) => String(v || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40);

export default async (req) => {
  const store = getStore('shop');

  if (req.method === 'POST') {
    let b;
    try { b = await req.json(); } catch (e) { return json({ ok: false }, 400); }
    const source = clean(b && b.source);
    if (!source) return json({ ok: false }, 400);
    const campaign = clean(b && b.campaign) || 'ohne';
    const tag = new Date().toISOString().slice(0, 10);

    const data = (await store.get('visits', { type: 'json' })) || {};
    const key = source + '|' + campaign;
    data[key] = data[key] || { gesamt: 0, tage: {} };
    data[key].gesamt += 1;
    data[key].tage[tag] = (data[key].tage[tag] || 0) + 1;
    await store.setJSON('visits', data);
    return json({ ok: true });
  }

  if (req.method === 'GET') {
    const gate = await requireAdmin(req);
    if (!gate.ok) return gate.res;
    const visits = (await store.get('visits', { type: 'json' })) || {};
    const subs = (await store.get('newsletter', { type: 'json' })) || [];
    // Anmeldungen je Quelle: die Quelle wird bei der Anmeldung mitgespeichert
    const proQuelle = {};
    for (const s of subs) {
      const q = clean(s && s.source) || 'direkt';
      proQuelle[q] = (proQuelle[q] || 0) + 1;
    }
    return json({ besuche: visits, anmeldungen: proQuelle, anmeldungenGesamt: subs.length });
  }

  return json({ error: 'Methode nicht erlaubt' }, 405);
};
