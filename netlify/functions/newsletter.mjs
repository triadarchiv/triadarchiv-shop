// Netlify-Funktion (v2): Newsletter-Anmeldung mit eigenem Double-Opt-In.
// 1) E-Mail wird IMMER in Netlify Blobs geloggt (Admin-Ansicht "Anmeldungen").
// 2) Ist Brevo konfiguriert (BREVO_API_KEY + BREVO_LIST_ID), verschickt der Shop selbst
//    eine Bestätigungsmail über Brevos normalen Transaktions-Versand (kein DOI-Template nötig).
//    Der Bestätigungslink zeigt auf /api/newsletter-confirm?token=… -> erst NACH dem Klick
//    wird der Kontakt in die Brevo-Liste eingetragen (echtes Double-Opt-In, DSGVO-konform).

import { getStore } from "@netlify/blobs";
import { randomUUID } from "node:crypto";

export default async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Nur POST erlaubt" }), { status: 405 });
  }

  let email = "";
  try {
    const body = await req.json();
    email = (body.email || "").trim().toLowerCase();
  } catch (e) {
    return new Response(JSON.stringify({ error: "Ungültige Daten" }), { status: 400 });
  }

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return new Response(JSON.stringify({ error: "Ungültige E-Mail" }), { status: 400 });
  }

  const store = getStore("shop");

  // (1) Roh-Log in Blobs (Admin-Ansicht) – idempotent
  const list = (await store.get("newsletter", { type: "json" })) || [];
  if (!list.some((e) => e.email === email)) {
    list.push({ email, date: new Date().toISOString() });
    await store.setJSON("newsletter", list);
  }

  // (2) Eigenes Double-Opt-In über Brevo-Transaktionsmail
  const apiKey = process.env.BREVO_API_KEY;
  const listId = parseInt(process.env.BREVO_LIST_ID, 10);
  const proto = req.headers.get("x-forwarded-proto") || "https";
  const origin = `${proto}://${req.headers.get("host")}`;
  // Absender läuft über die in Brevo authentifizierte Domain triadarchiv.de (DKIM) -> beste Zustellbarkeit.
  // Antworten gehen an das echte web.de-Postfach, da newsletter@triadarchiv.de kein Postfach hat.
  const senderEmail = process.env.BREVO_SENDER_EMAIL || "newsletter@triadarchiv.de";
  const replyToEmail = process.env.BREVO_REPLYTO_EMAIL || "triadarchiv@web.de";

  let doiSent = false;
  if (apiKey && listId) {
    const token = randomUUID();

    // Pending-Anmeldung merken (bis zum Bestätigungsklick)
    const pending = (await store.get("newsletter_pending", { type: "json" })) || [];
    const filtered = pending.filter((p) => p.email !== email);
    filtered.push({ email, token, listId, date: new Date().toISOString() });
    await store.setJSON("newsletter_pending", filtered);

    const confirmUrl = `${origin}/api/newsletter-confirm?token=${token}`;
    const html = `
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;color:#1a1a1a;line-height:1.6;">
        <p style="font-size:18px;font-weight:bold;margin:0 0 8px;">Fast geschafft!</p>
        <p>Danke für deine Anmeldung beim <strong>TRIAD ARCHIV</strong> Newsletter. Bitte bestätige sie mit einem Klick – danach bist du dabei und erfährst als Erste:r von neuen Drops.</p>
        <p style="margin:24px 0;">
          <a href="${confirmUrl}" style="display:inline-block;background:#111111;color:#ffffff;padding:13px 26px;border-radius:6px;text-decoration:none;font-weight:bold;">Anmeldung bestätigen</a>
        </p>
        <p style="font-size:13px;color:#555;">Falls der Button nicht funktioniert, kopiere diesen Link in deinen Browser:<br>
          <a href="${confirmUrl}" style="color:#555;word-break:break-all;">${confirmUrl}</a></p>
        <p style="color:#888;font-size:12px;">Wenn du dich nicht angemeldet hast, ignoriere diese E-Mail einfach – es passiert dann nichts.</p>
        <hr style="border:none;border-top:1px solid #e5e5e5;margin:24px 0;">
        <p style="color:#999;font-size:11px;line-height:1.5;margin:0;">
          TRIAD ARCHIV · Fabian Müller<br>
          Schubertstraße 11, 71277 Rutesheim, Deutschland<br>
          <a href="https://triadarchiv.de" style="color:#999;">triadarchiv.de</a> · <a href="mailto:triadarchiv@web.de" style="color:#999;">triadarchiv@web.de</a>
        </p>
      </div>`;

    // Reine Text-Version: Mails ohne Text-Teil (nur HTML + Button) werden von
    // Spamfiltern – besonders web.de/GMX – deutlich schlechter bewertet.
    const text = `Fast geschafft!

Danke für deine Anmeldung beim TRIAD ARCHIV Newsletter. Bitte bestätige sie über diesen Link – danach bist du dabei und erfährst als Erste:r von neuen Drops:

${confirmUrl}

Wenn du dich nicht angemeldet hast, ignoriere diese E-Mail einfach – es passiert dann nichts.

—
TRIAD ARCHIV · Fabian Müller
Schubertstraße 11, 71277 Rutesheim, Deutschland
triadarchiv.de · triadarchiv@web.de`;

    try {
      const resp = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "api-key": apiKey,
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: JSON.stringify({
          sender: { email: senderEmail, name: "TRIAD ARCHIV" },
          replyTo: { email: replyToEmail, name: "TRIAD ARCHIV" },
          to: [{ email }],
          subject: "Bitte bestätige deine Anmeldung – TRIAD ARCHIV",
          htmlContent: html,
          textContent: text,
        }),
      });
      if (resp.ok) {
        doiSent = true;
      } else {
        console.error("Brevo send Fehler:", resp.status, await resp.text());
      }
    } catch (err) {
      console.error("Brevo send Ausnahme:", err && err.message);
    }
  }

  return new Response(JSON.stringify({ ok: true, doi: doiSent }), { status: 200 });
};
