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

// Gleiche Logik wie checkout.js (Stripe): Zwischensumme + Versand (6,19 EUR, gratis ab 80 EUR)
export function cartTotals(cart) {
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
  const shipping = subtotal >= 80 ? 0 : 6.19;
  const total = subtotal + shipping;
  return { items, ids, subtotal, shipping, total };
}
