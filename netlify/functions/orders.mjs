// Netlify-Funktion (v2): Bestellungen für die Admin-Übersicht ausgeben.
// GET, nur mit Admin-Passwort (x-admin-key). Speicher: Netlify Blobs ("orders").

import { getStore } from "@netlify/blobs";

export default async (req) => {
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Nur GET erlaubt" }), { status: 405 });
  }

  const adminKey = process.env.ADMIN_PASSWORD;
  const provided = req.headers.get("x-admin-key");
  if (!adminKey || provided !== adminKey) {
    return new Response(JSON.stringify({ error: "Nicht autorisiert" }), { status: 401 });
  }

  const store = getStore("shop");
  const orders = (await store.get("orders", { type: "json" })) || [];
  return new Response(JSON.stringify(orders), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
};
