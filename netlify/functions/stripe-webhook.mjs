// Netlify-Funktion (v2): Stripe-Webhook.
//
// Stripe meldet bezahlte Bestellungen hierüber DIREKT an den Server – unabhängig
// davon, ob der Browser des Kunden je auf success.html landet. Das ist die
// Absicherung gegen "Kunde bezahlt, schließt den Tab -> Bestellung verschwindet".
//
// Einrichtung im Stripe-Dashboard (einmalig):
//   Entwickler -> Webhooks -> Endpunkt hinzufügen
//   URL:     https://triadarchiv.de/api/stripe-webhook
//   Event:   checkout.session.completed  (async_payment_succeeded optional)
//   Danach das "Signing secret" (whsec_…) als Netlify-Env STRIPE_WEBHOOK_SECRET setzen.

import crypto from "node:crypto";
import { fulfillStripeOrder } from "./_fulfill-stripe.mjs";

export default async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!secret || !stripeKey) {
    console.error("Stripe-Webhook: STRIPE_WEBHOOK_SECRET oder STRIPE_SECRET_KEY fehlt");
    return new Response("Server not configured", { status: 500 });
  }

  // Rohen Body brauchen wir unverändert für die Signaturprüfung.
  const rawBody = await req.text();
  const sig = req.headers.get("stripe-signature") || "";

  if (!verifyStripeSignature(rawBody, sig, secret)) {
    console.error("Stripe-Webhook: ungültige oder fehlende Signatur");
    return new Response("Invalid signature", { status: 400 });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response("Bad payload", { status: 400 });
  }

  // Nur abgeschlossene Zahlungen lösen die Verarbeitung aus.
  if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
    const sessionId = event.data && event.data.object && event.data.object.id;
    try {
      const result = await fulfillStripeOrder(sessionId, stripeKey);
      // Immer 200 zurück (auch "already"), damit Stripe den Webhook nicht
      // unnötig wiederholt. Idempotenz in fulfillStripeOrder verhindert Doppelungen.
      return new Response(JSON.stringify({ received: true, ...result }), { status: 200 });
    } catch (e) {
      // 500 -> Stripe stellt den Webhook später erneut zu (temporäre Fehler heilen sich).
      console.error("Stripe-Webhook: Verarbeitung fehlgeschlagen:", e && e.message);
      return new Response("Processing error", { status: 500 });
    }
  }

  // Alle anderen Event-Typen einfach bestätigen (Stripe erwartet 2xx).
  return new Response(JSON.stringify({ received: true, ignored: event.type }), { status: 200 });
};

// Prüft die Stripe-Signatur nach offiziellem Schema:
//   Header:  t=<timestamp>,v1=<hmac>,v1=<hmac>,…   (mehrere v1 bei Secret-Rotation)
//   Erwartet: HMAC-SHA256( "<t>.<rawBody>", secret ) == eines der v1
function verifyStripeSignature(payload, header, secret) {
  let t = null;
  const v1s = [];
  for (const part of header.split(",")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key === "t") t = val;
    else if (key === "v1") v1s.push(val);
  }
  if (!t || v1s.length === 0) return false;

  // Replay-Schutz: höchstens 5 Minuten Abweichung zulassen.
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(t));
  if (!Number.isFinite(age) || age > 300) return false;

  const expected = crypto.createHmac("sha256", secret).update(`${t}.${payload}`).digest("hex");
  const expBuf = Buffer.from(expected);
  return v1s.some((v1) => {
    const gotBuf = Buffer.from(v1);
    return gotBuf.length === expBuf.length && crypto.timingSafeEqual(gotBuf, expBuf);
  });
}
