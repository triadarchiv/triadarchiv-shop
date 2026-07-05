// Netlify-Funktion: nach erfolgreicher Zahlung die Bestellung verifizieren,
// den Artikel als verkauft markieren und die Bestellung protokollieren.
// Ersetzt den "/api/order-complete"-Teil aus server.ps1.
// Speicher: Netlify Blobs (online, da es keine Dateien mehr gibt).

const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const sessionId = event.queryStringParameters && event.queryStringParameters.session_id;

  if (!sessionId || !stripeKey) {
    return { statusCode: 400, body: JSON.stringify({ error: 'session_id oder Stripe-Schlüssel fehlt' }) };
  }

  try {
    // Bestellung bei Stripe abfragen
    const resp = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
      headers: { 'Authorization': `Bearer ${stripeKey}` }
    });
    const session = await resp.json();
    if (!resp.ok) {
      return { statusCode: 500, body: JSON.stringify({ error: (session.error && session.error.message) || 'Stripe-Fehler' }) };
    }
    if (session.payment_status !== 'paid') {
      return { statusCode: 402, body: JSON.stringify({ error: 'Zahlung nicht abgeschlossen', paid: false }) };
    }

    const store = getStore('shop');

    // Schon verbucht? (Idempotenz – gleiche Bestellung nicht doppelt zählen)
    const orders = (await store.get('orders', { type: 'json' })) || [];
    if (orders.some(o => o.sessionId === sessionId)) {
      return { statusCode: 200, body: JSON.stringify({ ok: true, paid: true, already: true }) };
    }

    // Gekaufte Artikel als verkauft markieren
    const idsRaw = (session.metadata && session.metadata.product_ids) || '';
    const soldIds = idsRaw.split(',').map(s => s.trim()).filter(Boolean);
    if (soldIds.length) {
      const products = (await store.get('products', { type: 'json' })) || [];
      products.forEach(p => {
        if (soldIds.includes(String(p.id))) {
          p.stock = 0;
          p.sold = true;
        }
      });
      await store.setJSON('products', products);
    }

    // Bestellung protokollieren (inkl. Lieferadresse fürs Versandlabel)
    orders.push({
      date: new Date().toISOString(),
      sessionId,
      email: (session.customer_details && session.customer_details.email) || '',
      amount: session.amount_total ? (session.amount_total / 100).toFixed(2) : '',
      currency: (session.currency || 'eur').toUpperCase(),
      productIds: idsRaw,
      shipping: session.shipping_details || null,
      customer: session.customer_details || null
    });
    await store.setJSON('orders', orders);

    return { statusCode: 200, body: JSON.stringify({ ok: true, paid: true }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
