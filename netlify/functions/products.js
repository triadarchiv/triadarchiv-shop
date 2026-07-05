// Netlify-Funktion: Produkte lesen (Shop) und speichern (Admin).
// Ersetzt "/api/products" aus server.ps1. Speicher: Netlify Blobs.
// GET  -> gibt die Produktliste zurück (öffentlich, für den Shop)
// POST -> speichert die Produktliste (nur mit Admin-Passwort)

const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  const store = getStore('shop');

  // --- Shop liest Produkte ---
  if (event.httpMethod === 'GET') {
    const products = (await store.get('products', { type: 'json' })) || [];
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify(products)
    };
  }

  // --- Admin speichert Produkte (geschützt) ---
  if (event.httpMethod === 'POST') {
    const adminKey = process.env.ADMIN_PASSWORD;
    const provided = event.headers['x-admin-key'];
    if (!adminKey || provided !== adminKey) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Nicht autorisiert' }) };
    }

    let products;
    try {
      products = JSON.parse(event.body || '[]');
    } catch (e) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Ungültige Daten' }) };
    }
    if (!Array.isArray(products)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Erwarte eine Liste' }) };
    }

    await store.setJSON('products', products);
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  }

  return { statusCode: 405, body: JSON.stringify({ error: 'Methode nicht erlaubt' }) };
};
