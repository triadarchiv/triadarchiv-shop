// Netlify-Funktion (v2): erstellt eine PayPal-Bestellung (Orders API v2).
// Payload (neu): { items:[{id,name,price,qty}], discount:{code,email}|null }
// Ein reines Array wird weiterhin als Warenkorb ohne Rabatt akzeptiert.

import { getStore } from '@netlify/blobs';
import { getAccessToken, cartTotals, PAYPAL_API } from './_paypal.mjs';
import { checkEligibility, normalizeEmail } from './_discount.mjs';

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Nur POST erlaubt' }), { status: 405 });
  }

  let payload;
  try {
    payload = await req.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Ungültiger Warenkorb.' }), { status: 400 });
  }

  const cart = Array.isArray(payload) ? payload : (payload && payload.items) || [];
  const discountReq = Array.isArray(payload) ? null : (payload && payload.discount) || null;
  if (!Array.isArray(cart) || cart.length === 0) {
    return new Response(JSON.stringify({ error: 'Warenkorb ist leer.' }), { status: 400 });
  }

  // Rabattcode serverseitig prüfen (Frontend nie vertrauen).
  let discountPercent = 0;
  let discountEmail = '';
  if (discountReq && discountReq.code) {
    try {
      const elig = await checkEligibility(discountReq.code, discountReq.email);
      if (elig.ok) {
        discountPercent = elig.percent;
        discountEmail = normalizeEmail(discountReq.email);
      }
    } catch (e) {
      // Bei Speicherfehler ohne Rabatt fortfahren.
    }
  }

  const { items, ids, subtotal, discount, shipping, total } = cartTotals(cart, discountPercent);

  const breakdown = {
    item_total: { currency_code: 'EUR', value: subtotal.toFixed(2) },
    shipping: { currency_code: 'EUR', value: shipping.toFixed(2) },
  };
  if (discount > 0) {
    breakdown.discount = { currency_code: 'EUR', value: discount.toFixed(2) };
  }

  try {
    const token = await getAccessToken();
    const resp = await fetch(`${PAYPAL_API}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [
          {
            // Produkt-IDs mitschicken -> nach Zahlung als verkauft markieren
            custom_id: ids.join(',').slice(0, 127),
            amount: {
              currency_code: 'EUR',
              value: total.toFixed(2),
              breakdown,
            },
            items: items.map((it) => ({
              name: it.name,
              unit_amount: { currency_code: 'EUR', value: it.price.toFixed(2) },
              quantity: String(it.qty),
            })),
          },
        ],
        application_context: {
          shipping_preference: 'GET_FROM_FILE',
          user_action: 'PAY_NOW',
        },
      }),
    });
    const data = await resp.json();
    if (!resp.ok) {
      return new Response(JSON.stringify({ error: data.message || 'PayPal-Fehler' }), { status: 500 });
    }

    // Rabatt-E-Mail zur PayPal-Bestell-ID vormerken -> beim Capture als "verbraucht" markieren.
    if (discountEmail && data.id) {
      try {
        const store = getStore('shop');
        const pending = (await store.get('discountPending', { type: 'json' })) || {};
        pending[data.id] = discountEmail;
        await store.setJSON('discountPending', pending);
      } catch (e) {
        // Vormerken fehlgeschlagen -> Zahlung trotzdem zulassen.
      }
    }

    return new Response(JSON.stringify({ id: data.id }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
};
