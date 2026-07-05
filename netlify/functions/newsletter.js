// Netlify-Funktion: Newsletter-Anmeldung (E-Mail sammeln).
// Ersetzt "/api/newsletter" aus server.ps1. Speicher: Netlify Blobs.
// HINWEIS: aktuell einfaches Sammeln (Single-Opt-In). Vor echtem Launch
// noch auf Double-Opt-In / Newsletter-Dienst umstellen (DSGVO).

const { getStore } = require('@netlify/blobs');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Nur POST erlaubt' }) };
  }

  let email = '';
  try {
    email = (JSON.parse(event.body || '{}').email || '').trim();
  } catch (e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Ungültige Daten' }) };
  }

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Ungültige E-Mail' }) };
  }

  const store = getStore('shop');
  const list = (await store.get('newsletter', { type: 'json' })) || [];
  if (!list.some(e => e.email === email)) {
    list.push({ email, date: new Date().toISOString() });
    await store.setJSON('newsletter', list);
  }

  return { statusCode: 200, body: JSON.stringify({ ok: true }) };
};
