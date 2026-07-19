// Netlify-Funktion (v2): PayPal-Bestellung erfassen (capture), Artikel als verkauft markieren,
// Bestellung protokollieren. Spiegelt order-complete.mjs (Stripe), nur für PayPal. Speicher: Netlify Blobs.

import { getStore } from '@netlify/blobs';
import { getAccessToken, PAYPAL_API } from './_paypal.mjs';
import { markUsed } from './_discount.mjs';
import { sendOrderConfirmation } from './_order-email.mjs';

export default async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Nur POST erlaubt' }), { status: 405 });
  }

  let body;
  try {
    body = await req.json();
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Ungültige Anfrage.' }), { status: 400 });
  }
  const orderID = body && body.orderID;
  if (!orderID) {
    return new Response(JSON.stringify({ error: 'orderID fehlt.' }), { status: 400 });
  }

  try {
    const token = await getAccessToken();
    const resp = await fetch(`${PAYPAL_API}/v2/checkout/orders/${encodeURIComponent(orderID)}/capture`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    const order = await resp.json();
    if (!resp.ok) {
      return new Response(JSON.stringify({ error: order.message || 'PayPal-Fehler bei der Zahlung.' }), { status: 500 });
    }
    if (order.status !== 'COMPLETED') {
      return new Response(JSON.stringify({ error: 'Zahlung nicht abgeschlossen.', paid: false }), { status: 402 });
    }

    const store = getStore('shop');

    // Schon verbucht? (Idempotenz)
    const orders = (await store.get('orders', { type: 'json' })) || [];
    if (orders.some((o) => o.sessionId === orderID)) {
      return new Response(JSON.stringify({ ok: true, paid: true, already: true }), { status: 200 });
    }

    const pu = (order.purchase_units && order.purchase_units[0]) || {};

    // Gekaufte Artikel als verkauft markieren
    const idsRaw = pu.custom_id || '';
    const soldIds = idsRaw.split(',').map((s) => s.trim()).filter(Boolean);
    if (soldIds.length) {
      const products = (await store.get('products', { type: 'json' })) || [];
      products.forEach((p) => {
        if (soldIds.includes(String(p.id))) {
          p.stock = 0;
          p.sold = true;
        }
      });
      await store.setJSON('products', products);
    }

    const items = (pu.items || []).map((li) => ({
      name: li.name || 'Artikel',
      qty: Number(li.quantity) || 1,
      amount: li.unit_amount ? li.unit_amount.value : '',
    }));

    const capture = pu.payments && pu.payments.captures && pu.payments.captures[0];
    const amount = capture ? capture.amount.value : (pu.amount ? pu.amount.value : '');
    const currency = capture ? capture.amount.currency_code : (pu.amount ? pu.amount.currency_code : 'EUR');

    const payer = order.payer || {};
    const shippingInfo = pu.shipping || {};
    const addr = shippingInfo.address || {};
    const payerName = payer.name ? [payer.name.given_name, payer.name.surname].filter(Boolean).join(' ') : '';

    // Bestellung protokollieren (gleiches Schema wie order-complete.mjs, fürs Admin-Panel)
    const orderRecord = {
      date: new Date().toISOString(),
      sessionId: orderID,
      provider: 'paypal',
      email: payer.email_address || '',
      amount,
      currency,
      items,
      productIds: idsRaw,
      shipping: {
        name: (shippingInfo.name && shippingInfo.name.full_name) || payerName,
        address: {
          line1: addr.address_line_1 || '',
          line2: addr.address_line_2 || '',
          postal_code: addr.postal_code || '',
          city: addr.admin_area_2 || '',
          country: addr.country_code || '',
        },
      },
      customer: { email: payer.email_address || '', name: payerName },
    };
    orders.push(orderRecord);
    await store.setJSON('orders', orders);

    // Gebrandete Bestellbestätigung an den Kunden (+ Kopie an den Shop). Wirft nie.
    await sendOrderConfirmation(orderRecord);

    // Wurde diese Bestellung mit Rabattcode angelegt? Dann die vorgemerkte E-Mail
    // als "verbraucht" markieren (einmal pro Kunde) und den Merker aufräumen.
    try {
      const pending = (await store.get('discountPending', { type: 'json' })) || {};
      if (pending[orderID]) {
        await markUsed(pending[orderID]);
        delete pending[orderID];
        await store.setJSON('discountPending', pending);
      }
    } catch (e) {
      // Markierung fehlgeschlagen -> Bestellung bleibt trotzdem gültig.
    }

    return new Response(JSON.stringify({ ok: true, paid: true }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
};
