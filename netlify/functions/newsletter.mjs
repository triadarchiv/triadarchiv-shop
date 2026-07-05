// Netlify-Funktion (v2): Newsletter-Anmeldung (E-Mail sammeln). Speicher: Netlify Blobs.
// HINWEIS: aktuell Single-Opt-In. Vor echtem Launch auf Double-Opt-In / Newsletter-Dienst umstellen (DSGVO).

import { getStore } from "@netlify/blobs";

export default async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Nur POST erlaubt" }), { status: 405 });
  }

  let email = "";
  try {
    const body = await req.json();
    email = (body.email || "").trim();
  } catch (e) {
    return new Response(JSON.stringify({ error: "Ungültige Daten" }), { status: 400 });
  }

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return new Response(JSON.stringify({ error: "Ungültige E-Mail" }), { status: 400 });
  }

  const store = getStore("shop");
  const list = (await store.get("newsletter", { type: "json" })) || [];
  if (!list.some((e) => e.email === email)) {
    list.push({ email, date: new Date().toISOString() });
    await store.setJSON("newsletter", list);
  }

  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};
