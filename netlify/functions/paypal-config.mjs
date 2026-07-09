// Netlify-Funktion (v2): liefert die öffentliche PayPal Client-ID ans Frontend,
// damit die Client-ID nicht fest im HTML steht (leichter zu rotieren/umzuschalten).
// GET, keine Auth nötig — die Client-ID ist per Design öffentlich (kein Secret).

export default async () => {
  const clientId = process.env.PAYPAL_CLIENT_ID || '';
  return new Response(JSON.stringify({ clientId }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
};
