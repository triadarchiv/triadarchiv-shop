// Netlify-Funktion (v2): wird vom Browser des Kunden (success.html) nach der
// Zahlung aufgerufen. Verifiziert die Stripe-Session und stößt die Verarbeitung an.
//
// Die eigentliche Logik liegt in _fulfill-stripe.mjs und wird identisch auch vom
// Stripe-Webhook genutzt – so ist die Bestellung selbst dann sicher erfasst, wenn
// der Kunde diese Seite nie erreicht (Tab geschlossen, Verbindung weg …).

import { fulfillStripeOrder } from "./_fulfill-stripe.mjs";

export default async (req) => {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("session_id");

  try {
    const result = await fulfillStripeOrder(sessionId, stripeKey);
    const { status = 200, ...body } = result;
    return new Response(JSON.stringify(body), { status });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
};
