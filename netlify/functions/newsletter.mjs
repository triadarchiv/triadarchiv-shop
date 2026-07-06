// Netlify-Funktion (v2): Newsletter-Anmeldung.
// 1) Speichert die E-Mail IMMER in Netlify Blobs (Roh-Log für die Admin-Ansicht).
// 2) Ist Brevo konfiguriert (Env-Vars gesetzt), wird zusätzlich ein Double-Opt-In-
//    Kontakt bei Brevo angelegt -> Brevo schickt die Bestätigungsmail (DSGVO-konform).
//    Ohne Env-Vars passiert nur (1) -> nichts bricht, solange Brevo noch nicht eingerichtet ist.

import { getStore } from "@netlify/blobs";

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

  // (1) Roh-Log in Blobs (Admin-Ansicht) – idempotent
  const store = getStore("shop");
  const list = (await store.get("newsletter", { type: "json" })) || [];
  if (!list.some((e) => e.email === email)) {
    list.push({ email, date: new Date().toISOString() });
    await store.setJSON("newsletter", list);
  }

  // (2) Brevo Double-Opt-In (nur wenn vollständig konfiguriert)
  const apiKey = process.env.BREVO_API_KEY;
  const listId = parseInt(process.env.BREVO_LIST_ID, 10);
  // TEMP: erlaubt ?tid=N zum Durchprobieren der DOI-Template-ID
  let tidOverride = null;
  try { tidOverride = new URL(req.url).searchParams.get("tid"); } catch (e) {}
  const templateId = tidOverride ? parseInt(tidOverride, 10) : parseInt(process.env.BREVO_DOI_TEMPLATE_ID, 10);
  const origin = `${req.headers.get("x-forwarded-proto") || "https"}://${req.headers.get("host")}`;
  const redirectionUrl = process.env.BREVO_REDIRECT_URL || `${origin}/newsletter-bestaetigt.html`;

  let doiSent = false;
  const dbg = { hasApiKey: !!apiKey, listId, templateId, redirectionUrl, brevoStatus: null, brevoBody: null };
  if (apiKey && listId && templateId) {
    try {
      const resp = await fetch("https://api.brevo.com/v3/contacts/doubleOptinConfirmation", {
        method: "POST",
        headers: {
          "api-key": apiKey,
          "Content-Type": "application/json",
          "Accept": "application/json",
        },
        body: JSON.stringify({
          email,
          includeListIds: [listId],
          templateId,
          redirectionUrl,
        }),
      });
      dbg.brevoStatus = resp.status;
      // 201 = Bestätigungsmail verschickt.
      // 400 = Kontakt existiert schon / ist bereits in der Liste -> kein Fehler für uns.
      if (resp.status === 201) {
        doiSent = true;
      } else {
        dbg.brevoBody = (await resp.text()).slice(0, 400);
        if (resp.status !== 400) console.error("Brevo DOI Fehler:", resp.status, dbg.brevoBody);
      }
    } catch (err) {
      dbg.brevoBody = "EXC: " + (err && err.message);
      console.error("Brevo DOI Ausnahme:", err && err.message);
    }
  }

  // TEMP: Brevo-Vorlagen auflisten, um die DOI-Template-ID zu finden
  if (apiKey) {
    try {
      const tr = await fetch("https://api.brevo.com/v3/smtp/templates?limit=100&sort=desc", {
        headers: { "api-key": apiKey, "Accept": "application/json" },
      });
      const tj = await tr.json();
      dbg.templates = (tj.templates || []).map((t) => ({ id: t.id, name: t.name, isActive: t.isActive, doi: t.doiTemplate }));
    } catch (e) {
      dbg.templatesErr = e && e.message;
    }
  }

  return new Response(JSON.stringify({ ok: true, doi: doiSent, debug: dbg }), { status: 200 });
};
