// Gemeinsame Helfer für die PayPal-Funktionen.
// PAYPAL_ENV=live in Netlify setzen, sobald live getestet werden soll (Standard: sandbox).

export const PAYPAL_API = process.env.PAYPAL_ENV === 'live'
  ? 'https://api-m.paypal.com'
  : 'https://api-m.sandbox.paypal.com';

export async function getAccessToken() {
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) {
    throw new Error('PayPal-Zugangsdaten fehlen (PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET in Netlify setzen).');
  }
  const auth = Buffer.from(`${id}:${secret}`).toString('base64');
  const resp = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const data = await resp.json();
  if (!resp.ok) throw new Error(data.error_description || 'PayPal-Token-Fehler');
  return data.access_token;
}

// Gleiche Logik wie checkout.mjs (Stripe): Zwischensumme + Versand, gratis ab 90 EUR.
// PayPal fragt die Lieferadresse erst NACH der Bestell-Erstellung ab (shipping_preference:
// GET_FROM_FILE), der Versandpreis muss also schon vorher feststehen. Da die meisten
// Bestellungen aus Deutschland kommen, wird der DE-Satz als Standard berechnet; ein
// EU-Ausland-Aufschlag lässt sich hier technisch nicht vorab je Bestellung unterscheiden
// (anders als bei Stripe, wo der Kunde selbst zwischen zwei Versandoptionen wählt).
// discountPercent (z. B. 10) reduziert die Zwischensumme; der Versand bleibt gleich.
export function cartTotals(cart, discountPercent = 0) {
  let subtotal = 0;
  const ids = [];
  const items = cart.map((item) => {
    const price = Number(item.price) || 0;
    let qty = parseInt(item.qty, 10) || 1;
    if (qty < 1) qty = 1;
    subtotal += price * qty;
    if (item.id) ids.push(String(item.id));
    return { name: String(item.name || 'Artikel').slice(0, 127), price, qty };
  });
  const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const discount = discountPercent > 0 ? round2(subtotal * discountPercent / 100) : 0;
  const shipping = subtotal >= 90 ? 0 : 6.19;
  const total = round2(subtotal - discount + shipping);
  return { items, ids, subtotal: round2(subtotal), discount, shipping, total };
}
