// Gemeinsame Fulfillment-Logik für eine bezahlte Stripe-Checkout-Session:
// Artikel als verkauft markieren, Bestellung protokollieren, Bestätigungsmail
// senden und einen genutzten Rabattcode als verbraucht markieren.
//
// Wird von ZWEI Stellen aufgerufen:
//   - order-complete.mjs   -> vom Browser des Kunden (success.html)
//   - stripe-webhook.mjs    -> direkt von Stripe, unabhängig vom Browser
// Deshalb ist die Verarbeitung idempotent über die sessionId: Egal ob eine
// oder beide Quellen feuern (auch beide gleichzeitig), es entsteht genau EINE
// Bestellung, EINE Mail, EIN "verkauft"-Status.

import { getStore } from "@netlify/blobs";
import { markUsed } from "./_discount.mjs";
import { sendOrderConfirmation } from "./_order-email.mjs";

export async function fulfillStripeOrder(sessionId, stripeKey) {
  if (!sessionId || !stripeKey) {
    return { ok: false, status: 400, error: "session_id oder Stripe-Schlüssel fehlt" };
  }

  // Bestellung bei Stripe abfragen (line_items mitladen, um die Artikelnamen
  // fest zu speichern – unabhängig davon, ob das Produkt später gelöscht/umbenannt wird)
  const resp = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}?expand[]=line_items`,
    { headers: { Authorization: `Bearer ${stripeKey}` } }
  );
  const session = await resp.json();
  if (!resp.ok) {
    return { ok: false, status: 502, error: (session.error && session.error.message) || "Stripe-Fehler" };
  }
  if (session.payment_status !== "paid") {
    return { ok: false, status: 402, paid: false, error: "Zahlung nicht abgeschlossen" };
  }

  const store = getStore("shop");

  // Schon verbucht? (Idempotenz) – trägt beide Quellen, egal wer zuerst kommt.
  const orders = (await store.get("orders", { type: "json" })) || [];
  if (orders.some((o) => o.sessionId === sessionId)) {
    return { ok: true, status: 200, paid: true, already: true };
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
    name: li.description || (li.price && li.price.product_data && li.price.product_data.name) || "Artikel",
    qty: li.quantity || 1,
    amount: typeof li.amount_total === "number" ? (li.amount_total / 100).toFixed(2) : "",
  }));

  // Bestellung protokollieren (inkl. Lieferadresse fürs Versandlabel)
  const orderRecord = {
    date: new Date().toISOString(),
    sessionId,
    email: (session.customer_details && session.customer_details.email) || "",
    amount: session.amount_total ? (session.amount_total / 100).toFixed(2) : "",
    currency: (session.currency || "eur").toUpperCase(),
    items,
    productIds: idsRaw,
    shipping: session.shipping_details || null,
    customer: session.customer_details || null,
  };
  orders.push(orderRecord);
  await store.setJSON("orders", orders);

  // Gebrandete Bestellbestätigung an den Kunden (+ Kopie an den Shop). Wirft nie.
  await sendOrderConfirmation(orderRecord);

  // Wurde ein Rabattcode genutzt? Dann die E-Mail als "verbraucht" markieren,
  // damit dieser Kunde den Code kein zweites Mal einlösen kann.
  if (session.metadata && session.metadata.discount_code) {
    await markUsed(session.metadata.discount_email || (session.customer_details && session.customer_details.email));
  }

  return { ok: true, status: 200, paid: true };
}
