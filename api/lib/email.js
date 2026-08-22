const APP_URL = 'https://capas.digasnikas.com';

const NEWSPAPER_LABELS = { record: 'Record', abola: 'A Bola', ojogo: 'O Jogo' };

function coverCol(cover, width) {
  const label = NEWSPAPER_LABELS[cover.newspaper] ?? cover.newspaper;
  return `
    <td width="${width}%" style="padding:4px;text-align:center;vertical-align:top;">
      <a href="${APP_URL}" style="text-decoration:none;display:block;">
        <img src="${cover.url}" alt="${label}"
          style="width:100%;max-width:${Math.round(560 * width / 100)}px;border-radius:6px;display:block;margin:0 auto;border:0;" />
        <span style="display:block;margin-top:6px;font-size:11px;color:#9ca3af;
          text-transform:uppercase;letter-spacing:0.06em;font-family:Arial,sans-serif;">
          ${label}
        </span>
      </a>
    </td>`;
}

function pendingBadge(count) {
  if (count <= 0) {
    return `
      <tr>
        <td style="padding:0 24px 16px;">
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="background:#f0fdf4;border-radius:8px;padding:16px;text-align:center;">
                <span style="font-size:1.5rem;">✅</span>
                <p style="margin:6px 0 0;color:#166534;font-size:14px;font-family:Arial,sans-serif;">
                  Estás em dia! Só faltam as de hoje.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>`;
  }
  return `
    <tr>
      <td style="padding:0 24px 16px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="background:#fef3c7;border-radius:8px;padding:20px;text-align:center;">
              <span style="font-size:2.2rem;font-weight:700;color:#92400e;font-family:Arial,sans-serif;">${count}</span>
              <p style="margin:4px 0 0;color:#92400e;font-size:13px;font-family:Arial,sans-serif;">
                capas por avaliar (incluindo as de hoje)
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>`;
}

function examplesSection(examples) {
  if (!examples.length) return '';
  const colWidth = Math.floor(100 / examples.length);
  return `
    <tr>
      <td style="padding:0 24px 8px;">
        <p style="margin:0 0 10px;color:#374151;font-size:13px;font-weight:700;
          font-family:Arial,sans-serif;text-transform:uppercase;letter-spacing:0.04em;">
          Algumas que ficaram para trás
        </p>
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            ${examples.map(c => coverCol(c, colWidth)).join('')}
          </tr>
        </table>
      </td>
    </tr>`;
}

export function buildEmailHtml({ latestCovers, pendingCount, examples }) {
  const colWidth = latestCovers.length ? Math.floor(100 / latestCovers.length) : 33;

  return `<!DOCTYPE html>
<html lang="pt">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Novas capas disponíveis</title>
</head>
<body style="margin:0;padding:0;background:#f3f4f6;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;">
    <tr>
      <td align="center" style="padding:24px 16px;">
        <table width="600" cellpadding="0" cellspacing="0"
          style="max-width:600px;width:100%;border-radius:12px;overflow:hidden;
            box-shadow:0 2px 8px rgba(0,0,0,0.08);">

          <!-- Header -->
          <tr>
            <td style="background:#111827;padding:24px;text-align:center;">
              <div style="font-size:32px;line-height:1;">⚽</div>
              <h1 style="margin:8px 0 0;color:#f9fafb;font-size:16px;font-weight:600;
                font-family:Arial,sans-serif;letter-spacing:0.02em;">
                Avaliador de capas desportivas
              </h1>
            </td>
          </tr>

          <!-- Hero -->
          <tr>
            <td style="background:#fff;padding:28px 24px 20px;text-align:center;">
              <h2 style="margin:0 0 6px;color:#111827;font-size:22px;font-weight:700;
                font-family:Arial,sans-serif;">
                Novas capas disponíveis 📰
              </h2>
              <p style="margin:0;color:#6b7280;font-size:14px;font-family:Arial,sans-serif;">
                As capas de hoje estão à tua espera. Só demora um minuto!
              </p>
            </td>
          </tr>

          <!-- Latest covers -->
          <tr>
            <td style="background:#fff;padding:0 24px 20px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  ${latestCovers.map(c => coverCol(c, colWidth)).join('')}
                </tr>
              </table>
            </td>
          </tr>

          <!-- Pending count -->
          ${pendingBadge(pendingCount)}

          <!-- Unswiped examples -->
          ${examplesSection(examples)}

          <!-- CTA -->
          <tr>
            <td style="background:#fff;padding:16px 24px 32px;text-align:center;">
              <a href="${APP_URL}"
                style="display:inline-block;background:#2563eb;color:#fff;text-decoration:none;
                  padding:14px 36px;border-radius:8px;font-weight:700;font-size:15px;
                  font-family:Arial,sans-serif;letter-spacing:0.02em;">
                Avaliar agora →
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:16px 24px;
              text-align:center;border-radius:0 0 12px 12px;">
              <p style="margin:0;color:#9ca3af;font-size:11px;font-family:Arial,sans-serif;">
                Recebeste este email porque participas no projecto capas desportivas.
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
