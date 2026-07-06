// Netlify-Funktion (v2): Bestätigungslink des Double-Opt-In.
// GET /api/newsletter-confirm?token=…  -> prüft Token, trägt den Kontakt in die Brevo-Liste ein
// und leitet auf die Danke-Seite weiter. Speicher: Netlify Blobs.

import { getStore } from "@netlify/blobs";

export default async (req) => {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const origin = `${proto}://${req.headers.get("host")}`;
  const done = () => Response.redirect(`${origin}/newsletter-bestaetigt.html`, 302);

  if (!token) return Response.redirect(`${origin}/shop.html`, 302);

  const store = getStore("shop");
  const pending = (await store.get("newsletter_pending", { type: "json" })) || [];
  const entry = pending.find((p) => p.token === token);

  // Kein passender Token (abgelaufen / schon bestätigt) -> trotzdem freundlich zur Danke-Seite
  if (!entry) return done();

  const apiKey = process.env.BREVO_API_KEY;
  const listId = entry.listId || parseInt(process.env.BREVO_LIST_ID, 10);

  if (apiKey && listId) {
    try {
      await fetch("https://api.brevo.com/v3/contacts", {
        method: "POST",
        headers: {
          "api-key": apiKey,
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: JSON.stringify({ email: entry.email, listIds: [listId], updateEnabled: true }),
      });
      // 201 = neu angelegt, 204 = aktualisiert, 400 = existiert schon -> updateEnabled deckt das ab
    } catch (err) {
      console.error("Brevo contacts Ausnahme:", err && err.message);
    }
  }

  // Token verbrauchen + als bestätigt vermerken
  await store.setJSON("newsletter_pending", pending.filter((p) => p.token !== token));
  const confirmed = (await store.get("newsletter_confirmed", { type: "json" })) || [];
  if (!confirmed.some((c) => c.email === entry.email)) {
    confirmed.push({ email: entry.email, date: new Date().toISOString() });
    await store.setJSON("newsletter_confirmed", confirmed);
  }

  return done();
};
