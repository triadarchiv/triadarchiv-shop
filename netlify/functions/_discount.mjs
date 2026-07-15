// Gemeinsame Rabattcode-Logik für alle Funktionen (Stripe + PayPal).
// Code: ARCHIV10 = 10% auf die Zwischensumme, gültig NUR EINMAL pro Kunde (E-Mail).
// "Einmal pro Kunde" heißt: die E-Mail darf noch nie bestellt und den Code noch nie
// genutzt haben. Geprüft wird gegen Netlify Blobs (Store "shop"):
//   - "orders"             -> alle bisherigen Bestellungen (mit .email)
//   - "discountCodesUsed"  -> Liste eingelöster E-Mails

import { getStore } from '@netlify/blobs';

export const DISCOUNT_CODE = 'ARCHIV10';
export const DISCOUNT_PERCENT = 10;

export function normalizeCode(v) { return String(v || '').trim().toUpperCase(); }
export function normalizeEmail(v) { return String(v || '').trim().toLowerCase(); }
export function isValidEmail(v) { return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(v || '').trim()); }
export function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }

// Prüft, ob (Code + E-Mail) aktuell einlösbar sind.
// Rückgabe: { ok, percent, reason } — reason ∈ 'unknown' | 'email' | 'used'
export async function checkEligibility(code, email) {
  const c = normalizeCode(code);
  const e = normalizeEmail(email);
  if (c !== DISCOUNT_CODE) return { ok: false, percent: 0, reason: 'unknown' };
  if (!isValidEmail(e)) return { ok: false, percent: 0, reason: 'email' };

  const store = getStore('shop');
  const orders = (await store.get('orders', { type: 'json' })) || [];
  const used = (await store.get('discountCodesUsed', { type: 'json' })) || [];

  const hasOrdered = orders.some((o) => normalizeEmail(o && o.email) === e);
  const hasUsed = used.some((x) => normalizeEmail(x) === e);
  if (hasOrdered || hasUsed) return { ok: false, percent: 0, reason: 'used' };

  return { ok: true, percent: DISCOUNT_PERCENT, reason: 'ok' };
}

// E-Mail nach erfolgreicher, rabattierter Zahlung als "verbraucht" vormerken.
export async function markUsed(email) {
  const e = normalizeEmail(email);
  if (!e) return;
  const store = getStore('shop');
  const used = (await store.get('discountCodesUsed', { type: 'json' })) || [];
  if (!used.some((x) => normalizeEmail(x) === e)) {
    used.push(e);
    await store.setJSON('discountCodesUsed', used);
  }
}
