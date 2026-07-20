// Netlify-Funktion (v2): eine Bestellung als "versendet" markieren und den Kunden
// per E-Mail benachrichtigen ("Dein Paket ist unterwegs"). POST, nur mit Admin-Passwort
// (x-admin-key). Speicher: Netlify Blobs ("orders").

import { getStore } from "@netlify/blobs";
import { sendShippingConfirmation } from "./_order-email.mjs";

export default async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Nur POST erlaubt" }), { status: 405 });
  }

  const adminKey = process.env.ADMIN_PASSWORD;
  const provided = req.headers.get("x-admin-key");
  if (!adminKey || provided !== adminKey) {
    return new Response(JSON.stringify({ error: "Nicht autorisiert" }), { status: 401 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Ungültige Daten" }), { status: 400 });
  }

  const sessionId = body && body.sessionId;
  if (!sessionId) {
    return new Response(JSON.stringify({ error: "sessionId fehlt" }), { status: 400 });
  }
  const tracking = (body.tracking || "").toString().trim();
  const carrier = (body.carrier || "").toString().trim();

  const store = getStore("shop");
  const orders = (await store.get("orders", { type: "json" })) || [];
  const order = orders.find((o) => o.sessionId === sessionId);
  if (!order) {
    return new Response(JSON.stringify({ error: "Bestellung nicht gefunden" }), { status: 404 });
  }

  const wasShipped = order.shipped === true;
  order.shipped = true;
  if (!order.shippedDate) order.shippedDate = new Date().toISOString();
  if (tracking) order.tracking = tracking;
  if (carrier) order.carrier = carrier;

  await store.setJSON("orders", orders);

  // Versandbestätigung nur beim ERSTEN Markieren senden (kein Doppelversand,
  // falls der Knopf versehentlich erneut gedrückt wird).
  let mailed = false;
  if (!wasShipped) {
    mailed = await sendShippingConfirmation(order);
  }

  return new Response(JSON.stringify({ ok: true, mailed, alreadyShipped: wasShipped, order }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
};
