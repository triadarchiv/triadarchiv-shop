// Netlify-Funktion (v2): prüft einen Rabattcode + E-Mail, BEVOR bezahlt wird.
// Wird vom Warenkorb (cart.html) aufgerufen. Gibt nur zurück, ob einlösbar –
// die eigentliche Rabatt-Anwendung passiert nochmal serverseitig beim Checkout.

import { checkEligibility, DISCOUNT_PERCENT } from './_discount.mjs';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Nur POST erlaubt' }, 405);

  let body;
  try {
    body = await req.json();
  } catch (e) {
    return json({ valid: false, reason: 'bad' }, 400);
  }

  const { code, email } = body || {};
  try {
    const res = await checkEligibility(code, email);
    if (res.ok) return json({ valid: true, percent: res.percent });
    return json({ valid: false, reason: res.reason });
  } catch (e) {
    // Fällt der Speicher aus, lieber ablehnen als versehentlich Rabatt geben.
    return json({ valid: false, reason: 'error', error: e.message }, 500);
  }
};
