// Admin-Zugang: zeitsicherer Passwortvergleich + Versuchsbegrenzung.
//
// requireAdmin(req) ist das, was die geschuetzten Funktionen aufrufen:
//   const gate = await requireAdmin(req);
//   if (!gate.ok) return gate.res;
//
// Nach MAX_TRIES Fehlversuchen von derselben IP ist fuer WINDOW_MIN Minuten Schluss.

import crypto from 'node:crypto';
import { clientIp, isBlocked, countFail, resetLimit } from './_ratelimit.mjs';

const BUCKET = 'admin';
const MAX_TRIES = 5;
const WINDOW_MIN = 15;
const WINDOW_MS = WINDOW_MIN * 60 * 1000;

const json = (obj, status, extra = {}) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...extra },
  });

export function adminOk(req) {
  const expected = process.env.ADMIN_PASSWORD || '';
  const provided = req.headers.get('x-admin-key') || '';
  if (!expected) return false;
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;   // Laenge verraet nichts Brauchbares
  return crypto.timingSafeEqual(a, b);
}

export async function requireAdmin(req) {
  const ip = clientIp(req);

  const blocked = await isBlocked(BUCKET, ip, MAX_TRIES, WINDOW_MS);
  if (blocked.blocked) {
    const min = Math.ceil(blocked.retryAfter / 60);
    return {
      ok: false,
      res: json(
        { error: `Zu viele Fehlversuche. Bitte in ${min} Minute${min === 1 ? '' : 'n'} erneut versuchen.` },
        429,
        { 'Retry-After': String(blocked.retryAfter) }
      ),
    };
  }

  if (adminOk(req)) {
    await resetLimit(BUCKET, ip);
    return { ok: true };
  }

  const n = await countFail(BUCKET, ip, WINDOW_MS);
  const left = Math.max(0, MAX_TRIES - n);
  return {
    ok: false,
    res: json({ error: 'Nicht autorisiert', versucheUebrig: left }, 401),
  };
}
