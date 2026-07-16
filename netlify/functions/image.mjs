// Netlify-Funktion (v2): Bilder EINZELN speichern (Admin) und öffentlich ausliefern.
// So bleibt die Produktliste winzig (sie merkt sich nur kurze Links statt der Fotodaten) –
// egal wie viele Fotos/Artikel. Speicher: Netlify Blobs (Store "images").
//
//   POST /api/image   { dataUrl }  -> { key, url }   (nur mit Admin-Passwort)
//   GET  /api/image?key=...        -> das Bild        (öffentlich, dauerhaft cachebar)

import { getStore } from "@netlify/blobs";

export default async (req) => {
  const store = getStore("images");
  const url = new URL(req.url);

  // ----- Bild ausliefern (öffentlich) -----
  if (req.method === "GET") {
    const key = url.searchParams.get("key");
    if (!key) return new Response("missing key", { status: 400 });
    const r = await store.getWithMetadata(key, { type: "text" });
    if (!r || r.data == null) return new Response("not found", { status: 404 });
    const contentType = (r.metadata && r.metadata.contentType) || "image/jpeg";
    const bytes = Buffer.from(r.data, "base64");
    return new Response(bytes, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        // Bilder sind unveränderlich (eigener Key je Upload) -> lange cachen.
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  }

  // ----- Bild speichern (geschützt) -----
  if (req.method === "POST") {
    const adminKey = process.env.ADMIN_PASSWORD;
    const provided = req.headers.get("x-admin-key");
    if (!adminKey || provided !== adminKey) {
      return new Response(JSON.stringify({ error: "Nicht autorisiert" }), { status: 401 });
    }

    let body;
    try {
      body = await req.json();
    } catch (e) {
      return new Response(JSON.stringify({ error: "Ungültige Daten" }), { status: 400 });
    }

    const dataUrl = body && body.dataUrl;
    const m = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]+)$/.exec(dataUrl || "");
    if (!m) {
      return new Response(JSON.stringify({ error: "Kein gültiges Bild" }), { status: 400 });
    }
    const contentType = m[1];
    const base64 = m[2];
    // Sicherheitsgrenze pro Bild (der Admin verkleinert vorher, das reicht locker).
    if (base64.length > 8 * 1024 * 1024) {
      return new Response(JSON.stringify({ error: "Bild zu groß" }), { status: 413 });
    }

    const key = "img_" + Date.now() + "_" + Math.random().toString(36).slice(2, 10);
    await store.set(key, base64, { metadata: { contentType } });
    return new Response(JSON.stringify({ key, url: "/api/image?key=" + key }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response("method not allowed", { status: 405 });
};
