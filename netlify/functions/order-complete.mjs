// Netlify-Funktion (v2): nach erfolgreicher Zahlung Bestellung verifizieren,
// Artikel als verkauft markieren und Bestellung protokollieren. Speicher: Netlify Blobs.

import { getStore } from "@netlify/blobs";

export default async (req) => {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const url = new URL(req.url);
  const sessionId = url.searchParams.get("session_id");

  if (!sessionId || !stripeKey) {
    return new Response(JSON.stringify({ error: "session_id oder Stripe-Schlüssel fehlt" }), { status: 400 });
  }

  try {
    // Bestellung bei Stripe abfragen (line_items mitladen, um die Artikelnamen
    // fest zu speichern – unabhängig davon, ob das Produkt später gelöscht/umbenannt wird)
    const resp = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=line_items`, {
      headers: { Authorization: `Bearer ${stripeKey}` },
    });
    const session = await resp.json();
    if (!resp.ok) {
      return new Response(JSON.stringify({ error: (session.error && session.error.message) || "Stripe-Fehler" }), { status: 500 });
    }
    if (session.payment_status !== "paid") {
      return new Response(JSON.stringify({ error: "Zahlung nicht abgeschlossen", paid: false }), { status: 402 });
    }

    const store = getStore("shop");

    // Schon verbucht? (Idempotenz)
    const orders = (await store.get("orders", { type: "json" })) || [];
    if (orders.some((o) => o.sessionId === sessionId)) {
      return new Response(JSON.stringify({ ok: true, paid: true, already: true }), { status: 200 });
    }

    // Gekaufte Artikel als verkauft markieren
    const idsRaw = (session.metadata && session.metadata.product_ids) || "";
    const soldIds = idsRaw.split(",").map((s) => s.trim()).filter(Boolean);
    if (soldIds.length) {
      const products = (await store.get("products", { type: "json" })) || [];
      products.forEach((p) => {
        if (soldIds.includes(String(p.id))) {
          p.stock = 0;
          p.sold = true;
        }
      });
      await store.setJSON("products", products);
    }

    // Gekaufte Artikel (Name/Menge/Preis) fest aus den Stripe-Line-Items übernehmen,
    // damit die Bestellung ihre Artikelnamen behält, auch wenn das Produkt später weg ist.
    const items = ((session.line_items && session.line_items.data) || []).map((li) => ({
      name: (li.description || (li.price && li.price.product_data && li.price.product_data.name) || "Artikel"),
      qty: li.quantity || 1,
      amount: typeof li.amount_total === "number" ? (li.amount_total / 100).toFixed(2) : "",
    }));

    // Bestellung protokollieren (inkl. Lieferadresse fürs Versandlabel)
    orders.push({
      date: new Date().toISOString(),
      sessionId,
      email: (session.customer_details && session.customer_details.email) || "",
      amount: session.amount_total ? (session.amount_total / 100).toFixed(2) : "",
      currency: (session.currency || "eur").toUpperCase(),
      items,
      productIds: idsRaw,
      shipping: session.shipping_details || null,
      customer: session.customer_details || null,
    });
    await store.setJSON("orders", orders);

    return new Response(JSON.stringify({ ok: true, paid: true }), { status: 200 });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
};
