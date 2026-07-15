// Netlify-Funktion (v2): erstellt eine Stripe Checkout Session.
// Der geheime Stripe-Schlüssel kommt aus der geschützten Netlify-Einstellung
// STRIPE_SECRET_KEY (niemals im Code oder im Frontend!).
//
// Warenkorb-Payload (neu): { items:[{id,name,price,qty}], discount:{code,email}|null }
// Zur Sicherheit wird ein reines Array weiterhin als Warenkorb ohne Rabatt akzeptiert.

import { checkEligibility, DISCOUNT_CODE } from './_discount.mjs';

const STRIPE_COUPON_ID = 'ARCHIV10-FIRST'; // fester, wiederverwendbarer Coupon in Stripe

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

// Coupon einmalig anlegen (falls noch nicht vorhanden) und dessen ID zurückgeben.
async function ensureCoupon(stripeKey, percent) {
  const get = await fetch(`https://api.stripe.com/v1/coupons/${STRIPE_COUPON_ID}`, {
    headers: { Authorization: `Bearer ${stripeKey}` },
  });
  if (get.ok) return STRIPE_COUPON_ID;

  const p = new URLSearchParams();
  p.append('id', STRIPE_COUPON_ID);
  p.append('percent_off', String(percent));
  p.append('duration', 'once');
  p.append('name', `${DISCOUNT_CODE} (${percent}%)`);
  await fetch('https://api.stripe.com/v1/coupons', {
    method: 'POST',
    headers: { Authorization: `Bearer ${stripeKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: p.toString(),
  });
  // Auch bei Race-Condition ("resource_already_exists") existiert der Coupon danach.
  return STRIPE_COUPON_ID;
}

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Nur POST erlaubt' }, 405);

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    return json({ error: 'Stripe-Schlüssel fehlt (STRIPE_SECRET_KEY in Netlify nicht gesetzt).' }, 500);
  }

  let payload;
  try {
    payload = await req.json();
  } catch (e) {
    return json({ error: 'Ungültiger Warenkorb.' }, 400);
  }

  const cart = Array.isArray(payload) ? payload : (payload && payload.items) || [];
  const discountReq = Array.isArray(payload) ? null : (payload && payload.discount) || null;
  if (!Array.isArray(cart) || cart.length === 0) {
    return json({ error: 'Warenkorb ist leer.' }, 400);
  }

  const proto = req.headers.get('x-forwarded-proto') || 'https';
  const origin = `${proto}://${req.headers.get('host')}`;

  const params = new URLSearchParams();
  params.append('mode', 'payment');
  params.append('success_url', `${origin}/success.html?session_id={CHECKOUT_SESSION_ID}`);
  params.append('cancel_url', `${origin}/cart.html`);

  // Lieferadresse abfragen (Versand nach Deutschland) + Rechnungsadresse
  params.append('shipping_address_collection[allowed_countries][0]', 'DE');
  params.append('billing_address_collection', 'auto');

  let subtotal = 0;
  const ids = [];
  cart.forEach((item, i) => {
    const price = Number(item.price) || 0;
    let qty = parseInt(item.qty, 10) || 1;
    if (qty < 1) qty = 1;
    subtotal += price * qty;
    if (item.id) ids.push(String(item.id));
    const amount = Math.round(price * 100); // Betrag in Cent
    params.append(`line_items[${i}][price_data][currency]`, 'eur');
    params.append(`line_items[${i}][price_data][product_data][name]`, String(item.name || 'Artikel'));
    params.append(`line_items[${i}][price_data][unit_amount]`, String(amount));
    params.append(`line_items[${i}][quantity]`, String(qty));
  });

  // Versandkosten: 6,19 EUR, gratis ab 80 EUR (Basis = Warenwert vor Rabatt)
  let shippingCents = 619;
  if (subtotal >= 80) shippingCents = 0;
  const shipName = shippingCents === 0 ? 'Kostenloser Versand' : 'Versand (DHL)';
  params.append('shipping_options[0][shipping_rate_data][type]', 'fixed_amount');
  params.append('shipping_options[0][shipping_rate_data][fixed_amount][amount]', String(shippingCents));
  params.append('shipping_options[0][shipping_rate_data][fixed_amount][currency]', 'eur');
  params.append('shipping_options[0][shipping_rate_data][display_name]', shipName);

  // Produkt-IDs als Metadaten -> nach Zahlung als verkauft markieren (order-complete)
  params.append('metadata[product_ids]', ids.join(','));

  // Rabattcode serverseitig prüfen (Frontend nie vertrauen) und ggf. Coupon anhängen.
  if (discountReq && discountReq.code) {
    try {
      const elig = await checkEligibility(discountReq.code, discountReq.email);
      if (elig.ok) {
        const couponId = await ensureCoupon(stripeKey, elig.percent);
        params.append('discounts[0][coupon]', couponId);
        // E-Mail fest übernehmen -> auf der Stripe-Seite nicht mehr änderbar
        // (verhindert, dass mit einer anderen E-Mail bezahlt wird).
        params.append('customer_email', String(discountReq.email).trim());
        params.append('metadata[discount_code]', DISCOUNT_CODE);
        params.append('metadata[discount_email]', String(discountReq.email).trim().toLowerCase());
      }
      // Nicht einlösbar -> einfach ohne Rabatt fortfahren (nie zu viel Rabatt geben).
    } catch (e) {
      // Bei Speicherfehler ebenfalls ohne Rabatt fortfahren.
    }
  }

  try {
    const resp = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });
    const data = await resp.json();
    if (!resp.ok) {
      return json({ error: (data.error && data.error.message) || 'Stripe-Fehler' }, 500);
    }
    return json({ url: data.url }, 200);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
};
