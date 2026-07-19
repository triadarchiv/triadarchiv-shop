// Gemeinsamer Helfer: verschickt die gebrandete Bestellbestätigung an den Kunden
// (und – falls konfiguriert – eine Kopie per BCC an den Shop). Wird von
// order-complete.mjs (Stripe) und paypal-capture-order.mjs (PayPal) genutzt.
//
// Wichtig: Diese Funktion wirft NIE einen Fehler nach oben. Eine bezahlte Bestellung
// darf niemals scheitern, nur weil der Mailversand hakt – im Zweifel wird geloggt
// und die Bestellung gilt trotzdem als abgeschlossen.

const SHOP_NAME = "TRIAD ARCHIV";
const SEND_URL = "https://api.brevo.com/v3/smtp/email";

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

// "45.00" -> "45,00 €"  (leere/ungültige Werte -> "—")
function money(value, currency = "EUR") {
  if (value === "" || value == null) return "—";
  const num = Number(value);
  const str = Number.isFinite(num) ? num.toFixed(2) : String(value);
  const symbol = currency === "EUR" ? "€" : ` ${currency}`;
  return `${str.replace(".", ",")}${currency === "EUR" ? " €" : symbol}`;
}

// Kurze, lesbare Bestellnummer aus der Session-/Order-ID (letzte 8 alphanumerische Zeichen).
function orderRef(sessionId) {
  const tail = String(sessionId || "").replace(/[^a-zA-Z0-9]/g, "").slice(-8).toUpperCase();
  return `TA-${tail || "XXXXXXXX"}`;
}

// Lieferadresse aus dem Order-Objekt (Stripe shipping_details und die in
// paypal-capture-order.mjs normalisierte Form teilen sich dieselben Feldnamen).
function addressLines(order) {
  const sh = order.shipping || {};
  const a = sh.address || {};
  const name = sh.name || (order.customer && order.customer.name) || "";
  const cityLine = [a.postal_code, a.city].filter(Boolean).join(" ");
  return [name, a.line1, a.line2, cityLine, a.country].filter(Boolean);
}

export async function sendOrderConfirmation(order) {
  const apiKey = process.env.BREVO_API_KEY;
  const senderEmail = process.env.BREVO_SENDER_EMAIL || "newsletter@triadarchiv.de";
  const replyToEmail = process.env.BREVO_REPLYTO_EMAIL || "triadarchiv@web.de";
  // Kopie an den Shop (Standard: das echte Postfach). Auf "" setzen, um Kopie abzuschalten.
  const shopCopy = process.env.ORDER_NOTIFY_EMAIL != null ? process.env.ORDER_NOTIFY_EMAIL : replyToEmail;

  const email = (order.email || "").trim();
  if (!apiKey || !email) return false; // ohne Brevo-Key oder Kunden-Mail: still nichts tun

  const ref = orderRef(order.sessionId);
  const currency = order.currency || "EUR";
  const items = Array.isArray(order.items) ? order.items : [];
  const addr = addressLines(order);

  // --- Artikelzeilen ---
  const itemsHtml = items
    .map(
      (it) => `
        <tr>
          <td style="padding:10px 0;border-bottom:1px solid #2a2a2a;color:#e8e8e8;">
            ${esc(it.name)}${(Number(it.qty) || 1) > 1 ? ` <span style="color:#888;">× ${esc(it.qty)}</span>` : ""}
          </td>
          <td style="padding:10px 0;border-bottom:1px solid #2a2a2a;color:#e8e8e8;text-align:right;white-space:nowrap;">
            ${money(it.amount, currency)}
          </td>
        </tr>`
    )
    .join("");

  const itemsText = items
    .map((it) => `- ${it.name}${(Number(it.qty) || 1) > 1 ? ` × ${it.qty}` : ""}  ${money(it.amount, currency)}`)
    .join("\n");

  const addrHtml = addr.map((l) => esc(l)).join("<br>");
  const addrText = addr.join("\n");

  const html = `
  <div style="background:#111111;padding:32px 0;">
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;background:#181818;border:1px solid #2a2a2a;border-radius:10px;overflow:hidden;">
      <div style="padding:28px 32px 20px;border-bottom:1px solid #2a2a2a;">
        <div style="font-size:13px;letter-spacing:3px;color:#e8e8e8;font-weight:bold;">/// ${SHOP_NAME}</div>
      </div>
      <div style="padding:28px 32px;color:#cfcfcf;line-height:1.65;">
        <p style="font-size:19px;font-weight:bold;color:#ffffff;margin:0 0 8px;">Danke für deine Bestellung.</p>
        <p style="margin:0 0 4px;">Wir haben deine Zahlung erhalten und archivieren dein Stück gerade für den Versand. Jedes Teil ist ein Unikat – du hast es dir gesichert.</p>
        <p style="margin:16px 0 0;color:#888;font-size:13px;">Bestellnummer <strong style="color:#cfcfcf;">${ref}</strong></p>

        <table style="width:100%;border-collapse:collapse;margin:22px 0 0;">
          ${itemsHtml}
          <tr>
            <td style="padding:14px 0 0;color:#ffffff;font-weight:bold;">Gesamt (inkl. Versand)</td>
            <td style="padding:14px 0 0;color:#ffffff;font-weight:bold;text-align:right;">${money(order.amount, currency)}</td>
          </tr>
        </table>

        ${
          addr.length
            ? `<div style="margin:26px 0 0;padding:18px 20px;background:#111111;border:1px solid #2a2a2a;border-radius:8px;">
                 <div style="font-size:11px;letter-spacing:1.5px;text-transform:uppercase;color:#888;margin-bottom:8px;">Lieferadresse</div>
                 <div style="color:#e8e8e8;line-height:1.6;">${addrHtml}</div>
               </div>`
            : ""
        }

        <p style="margin:26px 0 0;">Dein Paket wird in <strong style="color:#e8e8e8;">2–4 Werktagen</strong> verschickt. Sobald es unterwegs ist, hörst du von uns.</p>
        <p style="margin:14px 0 0;color:#888;font-size:13px;">Fragen? Antworte einfach auf diese E-Mail.</p>
      </div>
      <div style="padding:20px 32px;border-top:1px solid #2a2a2a;color:#777;font-size:11px;line-height:1.6;">
        ${SHOP_NAME} · Fabian Müller<br>
        Schubertstraße 11, 71277 Rutesheim, Deutschland<br>
        <a href="https://triadarchiv.de" style="color:#999;">triadarchiv.de</a> · <a href="mailto:triadarchiv@web.de" style="color:#999;">triadarchiv@web.de</a>
      </div>
    </div>
  </div>`;

  // Reine Text-Version – ohne sie werten Spamfilter (v.a. web.de/GMX) die Mail deutlich ab.
  const text = `Danke für deine Bestellung.

Wir haben deine Zahlung erhalten und archivieren dein Stück gerade für den Versand.

Bestellnummer ${ref}

${itemsText}

Gesamt (inkl. Versand): ${money(order.amount, currency)}
${addr.length ? `\nLieferadresse:\n${addrText}\n` : ""}
Dein Paket wird in 2–4 Werktagen verschickt. Sobald es unterwegs ist, hörst du von uns.
Fragen? Antworte einfach auf diese E-Mail.

—
${SHOP_NAME} · Fabian Müller
Schubertstraße 11, 71277 Rutesheim, Deutschland
triadarchiv.de · triadarchiv@web.de`;

  const payload = {
    sender: { email: senderEmail, name: SHOP_NAME },
    replyTo: { email: replyToEmail, name: SHOP_NAME },
    to: [{ email }],
    subject: `Bestellung bestätigt (${ref}) – ${SHOP_NAME}`,
    htmlContent: html,
    textContent: text,
  };
  // Kopie an den Shop als BCC (sieht der Kunde nicht), nur wenn gesetzt und ≠ Kunde.
  if (shopCopy && shopCopy.trim() && shopCopy.trim().toLowerCase() !== email.toLowerCase()) {
    payload.bcc = [{ email: shopCopy.trim() }];
  }

  try {
    const resp = await fetch(SEND_URL, {
      method: "POST",
      headers: { "api-key": apiKey, "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      console.error("Bestellbestätigung Brevo-Fehler:", resp.status, await resp.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error("Bestellbestätigung Ausnahme:", err && err.message);
    return false;
  }
}
