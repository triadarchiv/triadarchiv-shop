// Netlify-Funktion (v2): zaehlt, wie viele Leute GERADE im Shop sind.
//
// Datensparsam wie visits.mjs: gespeichert wird nur eine zufaellige Kennung,
// die der Browser selbst wuerfelt, plus ein Zeitstempel. Keine IP, kein Cookie,
// kein Name - die Kennung lebt nur solange der Tab offen ist und laesst sich
// keiner Person zuordnen. Nach zwei Minuten ist jeder Eintrag weg.
//
// POST { id, seite }  -> Herzschlag einer offenen Seite (oeffentlich)
// GET                 -> aktuelle Zahl (nur Admin, x-admin-key)
//
// Trick gegen Gleichzeitigkeit: es gibt KEINE gemeinsame Zaehler-Datei, die
// mehrere Besucher gleichzeitig ueberschreiben koennten. Stattdessen legt jeder
// Herzschlag einen eigenen winzigen Eintrag an, dessen SCHLUESSEL schon alles
// enthaelt: Zeitfenster, Seite, Kennung. Gezaehlt wird dann nur die Schluesselliste.

import { getStore } from '@netlify/blobs';
import { requireAdmin } from './_auth.mjs';

const json = (o, s = 200) =>
  new Response(JSON.stringify(o), {
    status: s,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });

// Der Browser schlaegt alle 15 s an. Aktiv heisst: Herzschlag in einem der
// letzten drei Fenster, also vor hoechstens 30-45 s. Damit faellt jemand, der
// den Tab zumacht, nach spaetestens ~45 s wieder raus - und wer nur einen
// einzelnen Herzschlag verpasst (Funkloch, Tab kurz traege), bleibt drin.
const FENSTER_MS = 15000;        // Laenge eines Zeitfensters
const AKTIV_FENSTER = 3;         // aktiv = Herzschlag in den letzten 30-45 s
const ALT_FENSTER = 20;          // aelter als ~5 min -> aufraeumen
const MAX_LOESCHEN = 300;        // pro Aufruf hoechstens so viele Altlasten

const SEITEN = new Set(['shop', 'artikel', 'warenkorb', 'kasse', 'sonst']);

const fensterJetzt = () => Math.floor(Date.now() / FENSTER_MS);

export default async (req) => {
  const store = getStore('live');

  // ---------- Herzschlag ----------
  if (req.method === 'POST') {
    let b;
    try { b = await req.json(); } catch (e) { return json({ ok: false }, 400); }

    // Kennung: genau das, was der Browser erzeugt - 8-32 Zeichen a-z0-9.
    const id = String((b && b.id) || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 32);
    if (id.length < 8) return json({ ok: false }, 400);

    const roh = String((b && b.seite) || '').toLowerCase();
    const seite = SEITEN.has(roh) ? roh : 'sonst';

    try {
      await store.set(`${fensterJetzt()}_${seite}_${id}`, '1');
    } catch (e) {
      // Ein verlorener Herzschlag ist egal - naechster kommt in 20 s.
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
    const aktiv = new Map();      // Kennung -> Seite (letzte gewinnt)
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
