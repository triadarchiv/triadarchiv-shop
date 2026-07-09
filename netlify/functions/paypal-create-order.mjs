// Netlify-Funktion (v2): erstellt eine PayPal-Bestellung (Orders API v2).
// Nimmt denselben Warenkorb wie checkout.js (Stripe) entgegen: [{id, name, price, qty}].

import { getAccessToken, cartTotals, PAYPAL_API } from './_paypal.mjs';

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Nur POST erlaubt' }), { status: 405 });
  }

  let cart;
  try {
    cart = await req.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Ungültiger Warenkorb.' }), { status: 400 });
  }
  if (!Array.isArray(cart) || cart.length === 0) {
    return new Response(JSON.stringify({ error: 'Warenkorb ist leer.' }), { status: 400 });
  }

  const { items, ids, subtotal, shipping, total } = cartTotals(cart);

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
            // Produkt-IDs mitschicken -> nach Zahlung als verkauft markieren (wie bei Stripe metadata.product_ids)
            custom_id: ids.join(',').slice(0, 127),
            amount: {
              currency_code: 'EUR',
              value: total.toFixed(2),
              breakdown: {
                item_total: { currency_code: 'EUR', value: subtotal.toFixed(2) },
                shipping: { currency_code: 'EUR', value: shipping.toFixed(2) },
              },
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
    return new Response(JSON.stringify({ id: data.id }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
};
