// Netlify-Funktion (v2): zaehlt, wie viele Leute GERADE im Shop sind.
//
// Es wird NICHTS auf dem Geraet des Besuchers gespeichert oder ausgelesen -
// kein Cookie, kein sessionStorage. Damit greift § 25 TDDDG nicht und es
// braucht kein Einwilligungsbanner.
//
// Stattdessen bildet der Server eine Pruefsumme aus IP + Browserkennung +
// Tagesdatum. Sie dient einzig dazu, denselben Besucher nicht mehrfach zu
// zaehlen, laesst sich nicht zurueckrechnen, wechselt taeglich und ist
// spaetestens nach fuenf Minuten geloescht. Die IP selbst wird nie abgelegt.
//
// POST { seite }  -> Herzschlag einer offenen Seite (oeffentlich)
// GET             -> aktuelle Zahl (nur Admin, x-admin-key)
//
// Trick gegen Gleichzeitigkeit: es gibt KEINE gemeinsame Zaehler-Datei, die
// mehrere Besucher gleichzeitig ueberschreiben koennten. Jeder Herzschlag legt
// einen eigenen winzigen Eintrag an, dessen SCHLUESSEL schon alles enthaelt:
// Zeitfenster, Seite, Pruefsumme. Gezaehlt wird nur die Schluesselliste.

import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { requireAdmin } from './_auth.mjs';
import { clientIp } from './_ratelimit.mjs';

const json = (o, s = 200) =>
  new Response(JSON.stringify(o), {
    status: s,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

// Der Browser schlaegt alle 15 s an. Aktiv heisst: Herzschlag in einem der
// letzten fuenf Fenster, also vor hoechstens 60-75 s.
//
// Warum so grosszuegig: wer am Handy kurz in eine andere App wechselt, dessen
// Browser friert ein und schickt nichts mehr. Mit einem engen Fenster waere er
// nach 45 s "weg", obwohl der Shop noch offen ist und er gleich zurueckkommt.
const FENSTER_MS = 15000;        // Laenge eines Zeitfensters
const AKTIV_FENSTER = 5;         // aktiv = Herzschlag in den letzten 60-75 s
const ALT_FENSTER = 20;          // aelter als ~5 min -> aufraeumen
const MAX_LOESCHEN = 300;        // pro Aufruf hoechstens so viele Altlasten

const SEITEN = new Set(['shop', 'artikel', 'warenkorb', 'kasse', 'sonst']);

const fensterJetzt = () => Math.floor(Date.now() / FENSTER_MS);

// Fester Zusatz, damit die Pruefsumme nicht allein aus oeffentlich bekannten
// Angaben besteht. Zusammen mit dem Tagesdatum wechselt sie jede Nacht.
const PFEFFER = 'triad-archiv-live-zaehler';

function pruefsumme(req) {
  const ip = clientIp(req) || 'unbekannt';
  const ua = (req.headers.get('user-agent') || '').slice(0, 200);
  const tag = new Date().toISOString().slice(0, 10);
  return crypto.createHash('sha256')
    .update(`${PFEFFER}|${tag}|${ip}|${ua}`)
    .digest('hex')
    .slice(0, 20);
}

export default async (req) => {
  const store = getStore('live');

  // ---------- Herzschlag ----------
  if (req.method === 'POST') {
    let b = null;
    try { b = await req.json(); } catch (e) { b = null; }   // Seite ist optional

    const roh = String((b && b.seite) || '').toLowerCase();
    const seite = SEITEN.has(roh) ? roh : 'sonst';

    try {
      await store.set(`${fensterJetzt()}_${seite}_${pruefsumme(req)}`, '1');
    } catch (e) {
      // Ein verlorener Herzschlag ist egal - der naechste kommt in 15 s.
      return json({ ok: false }, 200);
    }
    return json({ ok: true });
  }

  // ---------- Auswertung ----------
  if (req.method === 'GET') {
    const gate = await requireAdmin(req);
    if (!gate.ok) return gate.res;

    let eintraege = [];
    try {
      const res = await store.list();
      eintraege = (res && res.blobs) || [];
    } catch (e) {
      return json({ error: 'Speicher nicht erreichbar' }, 503);
    }

    const jetzt = fensterJetzt();
    const aktiv = new Map();      // Pruefsumme -> Seite (letzte gewinnt)
    const altlasten = [];

    for (const eintrag of eintraege) {
      const teile = String(eintrag.key).split('_');
      if (teile.length !== 3) { altlasten.push(eintrag.key); continue; }
      const fenster = Number(teile[0]);
      if (!Number.isFinite(fenster)) { altlasten.push(eintrag.key); continue; }

      const alter = jetzt - fenster;
      if (alter < AKTIV_FENSTER) aktiv.set(teile[2], teile[1]);
      else if (alter > ALT_FENSTER) altlasten.push(eintrag.key);
    }

    const proSeite = {};
    for (const seite of aktiv.values()) proSeite[seite] = (proSeite[seite] || 0) + 1;

    // Aufraeumen nebenbei, damit die Liste nicht endlos waechst.
    let aufgeraeumt = 0;
    for (const key of altlasten.slice(0, MAX_LOESCHEN)) {
      try { await store.delete(key); aufgeraeumt++; } catch (e) { /* egal */ }
    }

    return json({
      live: aktiv.size,
      proSeite,
      stand: new Date().toISOString(),
      aufgeraeumt,
    });
  }

  return json({ error: 'Methode nicht erlaubt' }, 405);
};
