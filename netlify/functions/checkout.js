// Netlify-Funktion: erstellt eine Stripe Checkout Session.
// Ersetzt den "/api/checkout"-Teil aus server.ps1.
// Der geheime Stripe-Schlüssel kommt aus der geschützten Netlify-Einstellung
// STRIPE_SECRET_KEY (niemals im Code oder im Frontend!).

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Nur POST erlaubt' }) };
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Stripe-Schlüssel fehlt (STRIPE_SECRET_KEY in Netlify nicht gesetzt).' })
    };
  }

  let cart;
  try {
    cart = JSON.parse(event.body || '[]');
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Ungültiger Warenkorb.' }) };
  }
  if (!Array.isArray(cart) || cart.length === 0) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Warenkorb ist leer.' }) };
  }

  // Basis-Adresse (funktioniert automatisch für triadarchiv.netlify.app UND eine spätere eigene Domain)
  const proto = event.headers['x-forwarded-proto'] || 'https';
  const origin = `${proto}://${event.headers.host}`;

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

  // Versandkosten: 4,95 EUR, gratis ab 80 EUR (muss mit cart.html/versand.html übereinstimmen)
  let shippingCents = 495;
  if (subtotal >= 80) shippingCents = 0;
  const shipName = shippingCents === 0 ? 'Kostenloser Versand' : 'Versand (DHL)';
  params.append('shipping_options[0][shipping_rate_data][type]', 'fixed_amount');
  params.append('shipping_options[0][shipping_rate_data][fixed_amount][amount]', String(shippingCents));
  params.append('shipping_options[0][shipping_rate_data][fixed_amount][currency]', 'eur');
  params.append('shipping_options[0][shipping_rate_data][display_name]', shipName);

  // Produkt-IDs als Metadaten -> nach Zahlung als verkauft markieren (order-complete)
  params.append('metadata[product_ids]', ids.join(','));

  try {
    const resp = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });
    const data = await resp.json();
    if (!resp.ok) {
      return { statusCode: 500, body: JSON.stringify({ error: (data.error && data.error.message) || 'Stripe-Fehler' }) };
    }
    return { statusCode: 200, body: JSON.stringify({ url: data.url }) };
  } catch (e) {
    return { statusCode: 500, body: JSON.stringify({ error: e.message }) };
  }
};
