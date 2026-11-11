// Netlify-Funktion (v2): Newsletter-Anmeldungen für die Admin-Übersicht ausgeben.
// GET, nur mit Admin-Passwort (x-admin-key). Speicher: Netlify Blobs ("newsletter").

import { getStore } from "@netlify/blobs";
import { requireAdmin } from './_auth.mjs';

export default async (req) => {
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Nur GET erlaubt" }), { status: 405 });
  }

  const gate = await requireAdmin(req);
  if (!gate.ok) return gate.res;

  const store = getStore("shop");
  const list = (await store.get("newsletter", { type: "json" })) || [];
  return new Response(JSON.stringify(list), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
};
