import { json, requireAdmin } from '../lib/http.js';
import { buildEmailHtml } from '../lib/email.js';

const FROM = 'Capas Desportivas <capas@capas.digasnikas.com>';

export async function handleNotify(request, env) {
  const denied = requireAdmin(request, env);
  if (denied) return denied;

  // Latest covers (most recent date in DB)
  const { results: latestCovers } = await env.DB
    .prepare(`SELECT newspaper, date, url FROM covers
              WHERE date = (SELECT MAX(date) FROM covers)
              ORDER BY newspaper ASC`)
    .all();

  if (!latestCovers.length) return json({ error: 'No covers found' }, 404);

  // All users + their pending count
  const { results: users } = await env.DB
    .prepare(`SELECT u.email,
                (SELECT COUNT(*) FROM covers) - u.swipe_count AS pending
              FROM users u`)
    .all();

  if (!users.length) return json({ ok: true, sent: 0 });

  // Fetch up to 4 unswiped example covers per user (from older dates, random)
  const exampleStmt = env.DB.prepare(`
    SELECT c.newspaper, c.date, c.url FROM covers c
    WHERE c.date < (SELECT MAX(date) FROM covers)
      AND c.id NOT IN (SELECT cover_id FROM swipes WHERE user_email = ?)
    ORDER BY RANDOM() LIMIT 4
  `);

  const exampleResults = await env.DB.batch(users.map(u => exampleStmt.bind(u.email)));

  // Build one email payload per user
  const emails = users.map((user, i) => ({
    from:    FROM,
    to:      user.email,
    subject: '📰 Novas capas disponíveis',
    html:    buildEmailHtml({
      latestCovers,
      pendingCount: Math.max(0, user.pending),
      examples:     exampleResults[i].results,
    }),
  }));

  // Send via Resend in batches of 100
  let sent = 0;
  for (let i = 0; i < emails.length; i += 100) {
    const batch = emails.slice(i, i + 100);
    const res = await fetch('https://api.resend.com/emails/batch', {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify(batch),
    });
    if (res.ok) sent += batch.length;
  }

  return json({ ok: true, sent });
}
