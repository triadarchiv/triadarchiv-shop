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
  const isNew = !confirmed.some((c) => c.email === entry.email);
  if (isNew) {
    confirmed.push({ email: entry.email, date: new Date().toISOString() });
    await store.setJSON("newsletter_confirmed", confirmed);
  }

  // Willkommens-Mail: liefert den ARCHIV10-Code + Drop-Termin und wärmt die
  // Absender-Domain auf. Nur beim ERSTEN Bestätigen senden (nicht bei Reload).
  if (isNew && apiKey) {
    await sendWelcome(entry.email, origin).catch((err) =>
      console.error("Willkommensmail Ausnahme:", err && err.message)
    );
  }

  return done();
};

// ---- Willkommens-Mail (Brevo-Transaktionsmail, gleiche Domain wie DOI) ----
async function sendWelcome(email, origin) {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) return;
  const senderEmail = process.env.BREVO_SENDER_EMAIL || "newsletter@triadarchiv.de";
  const replyToEmail = process.env.BREVO_REPLYTO_EMAIL || "triadarchiv@web.de";
  const shopUrl = `${origin}/shop.html`;

  const html = `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;color:#1a1a1a;line-height:1.6;">
      <p style="font-size:18px;font-weight:bold;margin:0 0 8px;">Willkommen im Archiv 🖤</p>
      <p>Schön, dass du dabei bist. Ab jetzt erfährst du als Erste:r, wenn neue handverlesene Vintage-Unikate ins <strong>TRIAD ARCHIV</strong> kommen.</p>
      <p style="margin:20px 0 8px;">Dein Willkommensgeschenk für die erste Bestellung:</p>
      <div style="border:1px dashed #ff3d78;background:#fff5f8;padding:16px 18px;text-align:center;margin:0 0 20px;">
        <span style="font-family:'Courier New',monospace;font-size:22px;font-weight:bold;letter-spacing:3px;color:#111;">ARCHIV10</span><br>
        <span style="font-size:13px;color:#555;">10 % auf deine erste Bestellung</span>
      </div>
      <p><strong>Der erste große Drop: 15. August, 19:00 Uhr.</strong><br>
      Streng limitiert, jedes Teil 1 von 1 – und du bist von Anfang an dabei.</p>
      <p style="margin:24px 0;">
        <a href="${shopUrl}" style="display:inline-block;background:#111111;color:#ffffff;padding:13px 26px;border-radius:6px;text-decoration:none;font-weight:bold;">Zum Archiv</a>
      </p>
      <hr style="border:none;border-top:1px solid #e5e5e5;margin:24px 0;">
      <p style="color:#999;font-size:11px;line-height:1.5;margin:0;">
        TRIAD ARCHIV · Fabian Müller<br>
        Schubertstraße 11, 71277 Rutesheim, Deutschland<br>
        <a href="https://triadarchiv.de" style="color:#999;">triadarchiv.de</a> · <a href="mailto:triadarchiv@web.de" style="color:#999;">triadarchiv@web.de</a><br>
        Du bekommst diese Mail, weil du gerade deine Newsletter-Anmeldung bestätigt hast. Abmelden? Eine kurze Antwort auf diese Mail genügt.
      </p>
    </div>`;

  const text = `Willkommen im Archiv

Schön, dass du dabei bist. Ab jetzt erfährst du als Erste:r, wenn neue handverlesene Vintage-Unikate ins TRIAD ARCHIV kommen.

Dein Willkommensgeschenk für die erste Bestellung:
ARCHIV10 – 10 % auf deine erste Bestellung

Der erste große Drop: 15. August, 19:00 Uhr.
Streng limitiert, jedes Teil 1 von 1 – und du bist von Anfang an dabei.

Zum Archiv: ${shopUrl}

—
TRIAD ARCHIV · Fabian Müller
Schubertstraße 11, 71277 Rutesheim, Deutschland
triadarchiv.de · triadarchiv@web.de
Du bekommst diese Mail, weil du gerade deine Newsletter-Anmeldung bestätigt hast. Abmelden? Eine kurze Antwort auf diese Mail genügt.`;

  const resp = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": apiKey, "Content-Type": "application/json", "Accept": "application/json" },
    body: JSON.stringify({
      sender: { email: senderEmail, name: "TRIAD ARCHIV" },
      replyTo: { email: replyToEmail, name: "TRIAD ARCHIV" },
      to: [{ email }],
      subject: "Willkommen im Archiv – dein 10%-Code & der erste Drop",
      htmlContent: html,
      textContent: text,
    }),
  });
  if (!resp.ok) console.error("Willkommensmail Brevo-Fehler:", resp.status, await resp.text());
}
