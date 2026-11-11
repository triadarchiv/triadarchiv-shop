// Netlify-Funktion (v2): Newsletter-Anmeldung(en) loeschen.
// POST { emails: ["a@b.de", ...] }, nur mit Admin-Passwort (x-admin-key).
//
// Entfernt die Adresse aus allen drei Listen im Blob-Store ("newsletter",
// "newsletter_pending", "newsletter_confirmed") und loescht den Kontakt auch
// bei Brevo - sonst bekaeme die Person weiter Newsletter.
// Braucht die DSGVO: Betroffene koennen die Loeschung ihrer Daten verlangen.

import { getStore } from '@netlify/blobs';
import { requireAdmin } from './_auth.mjs';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

const norm = (v) => String(v || '').trim().toLowerCase();

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Nur POST erlaubt' }, 405);

  const gate = await requireAdmin(req);
  if (!gate.ok) return gate.res;

  let body;
  try { body = await req.json(); } catch (e) { return json({ error: 'Ungueltige Daten' }, 400); }

  const wanted = (Array.isArray(body && body.emails) ? body.emails : [body && body.email])
    .map(norm).filter(Boolean);
  if (wanted.length === 0) return json({ error: 'Keine E-Mail angegeben' }, 400);
  const hit = new Set(wanted);

  const store = getStore('shop');
  const removed = {};

  for (const key of ['newsletter', 'newsletter_pending', 'newsletter_confirmed']) {
    const list = (await store.get(key, { type: 'json' })) || [];
    const kept = list.filter((e) => {
      const mail = typeof e === 'string' ? e : (e && e.email);
      return !hit.has(norm(mail));
    });
    removed[key] = list.length - kept.length;
    if (kept.length !== list.length) await store.setJSON(key, kept);
  }

  // Auch bei Brevo austragen, damit wirklich keine Mails mehr rausgehen.
  const apiKey = process.env.BREVO_API_KEY;
  const brevo = {};
  if (apiKey) {
    for (const email of wanted) {
      try {
        const r = await fetch(`https://api.brevo.com/v3/contacts/${encodeURIComponent(email)}`, {
          method: 'DELETE',
          headers: { 'api-key': apiKey, Accept: 'application/json' },
        });
        brevo[email] = r.status === 204 ? 'geloescht' : (r.status === 404 ? 'war nicht vorhanden' : 'Fehler ' + r.status);
      } catch (e) {
        brevo[email] = 'Fehler';
      }
    }
  }

  return json({ ok: true, emails: wanted, removed, brevo });
};
