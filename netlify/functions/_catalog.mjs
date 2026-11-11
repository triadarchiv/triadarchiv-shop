// Gemeinsame Warenkorb-Pruefung fuer Stripe und PayPal.
//
// WICHTIG: Preise, Namen und Verfuegbarkeit kommen AUSSCHLIESSLICH aus dem
// Produktspeicher (Netlify Blobs). Aus dem Browser wird nur noch uebernommen,
// WELCHER Artikel gekauft wird - nicht, was er kostet. Ohne das koennte jeder
// den Preis in der Anfrage aendern und fuer einen Cent bestellen.

import { getStore } from '@netlify/blobs';

const SOLD_OUT = 'ist bereits verkauft';

export async function resolveCart(cart) {
  if (!Array.isArray(cart) || cart.length === 0) {
    return { ok: false, status: 400, error: 'Warenkorb ist leer.' };
  }
  if (cart.length > 50) {
    return { ok: false, status: 400, error: 'Zu viele Artikel im Warenkorb.' };
  }

  let products;
  try {
    const store = getStore('shop');
    products = (await store.get('products', { type: 'json' })) || [];
  } catch (e) {
    // Lieber abbrechen als mit ungepruefte Preisen weiterrechnen.
    return { ok: false, status: 503, error: 'Produktdaten nicht erreichbar. Bitte spaeter erneut versuchen.' };
  }

  const byId = new Map(products.map((p) => [String(p && p.id), p]));
  const items = [];
  const ids = [];
  const seen = new Set();

  for (const raw of cart) {
    const id = String((raw && raw.id) || '').trim();
    if (!id) return { ok: false, status: 400, error: 'Ein Artikel im Warenkorb hat keine Kennung.' };
    if (seen.has(id)) return { ok: false, status: 409, error: 'Ein Artikel liegt doppelt im Warenkorb.' };
    seen.add(id);

    const p = byId.get(id);
    if (!p) return { ok: false, status: 409, error: 'Ein Artikel ist nicht mehr verfuegbar.' };
    if (p.published === false) return { ok: false, status: 409, error: 'Ein Artikel ist nicht mehr verfuegbar.' };

    const name = String(p.name || 'Artikel').slice(0, 127);
    const stock = Number.isFinite(Number(p.stock)) ? Math.max(0, parseInt(p.stock, 10)) : 1;
    if (p.sold === true || stock < 1) {
      return { ok: false, status: 409, error: `„${name}“ ${SOLD_OUT}.` };
    }

    let qty = parseInt(raw && raw.qty, 10) || 1;
    if (qty < 1) qty = 1;
    if (qty > stock) qty = stock;

    const price = Math.round((Number(p.price) || 0) * 100) / 100;
    if (!(price > 0)) {
      return { ok: false, status: 409, error: `Fuer „${name}“ ist kein Preis hinterlegt.` };
    }

    items.push({ id, name, price, qty });
    ids.push(id);
  }

  return { ok: true, items, ids };
}
