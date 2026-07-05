// Netlify-Funktion (v2): Produkte lesen (Shop) und speichern (Admin).
// Speicher: Netlify Blobs. Im v2-Format wird der Blobs-Speicher automatisch verbunden.
// GET  -> gibt die Produktliste zurück (öffentlich, für den Shop)
// POST -> speichert die Produktliste (nur mit Admin-Passwort)

import { getStore } from "@netlify/blobs";

export default async (req) => {
  const store = getStore("shop");

  // --- Shop liest Produkte ---
  if (req.method === "GET") {
    const products = (await store.get("products", { type: "json" })) || [];
    return new Response(JSON.stringify(products), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  }

  // --- Admin speichert Produkte (geschützt) ---
  if (req.method === "POST") {
    const adminKey = process.env.ADMIN_PASSWORD;
    const provided = req.headers.get("x-admin-key");
    if (!adminKey || provided !== adminKey) {
      return new Response(JSON.stringify({ error: "Nicht autorisiert" }), { status: 401 });
    }

    let products;
    try {
      products = await req.json();
    } catch (e) {
      return new Response(JSON.stringify({ error: "Ungültige Daten" }), { status: 400 });
    }
    if (!Array.isArray(products)) {
      return new Response(JSON.stringify({ error: "Erwarte eine Liste" }), { status: 400 });
    }

    await store.setJSON("products", products);
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }

  return new Response(JSON.stringify({ error: "Methode nicht erlaubt" }), { status: 405 });
};
