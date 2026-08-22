// Every authenticated call is now same-origin (app.capas.digasnikas.com
// calling its own /api/*), so this is only ever exercised by public,
// credential-less reads (/stats, /matches) — no origin scoping needed.
export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}
