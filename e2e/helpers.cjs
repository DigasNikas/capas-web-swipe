// Shared plumbing for the end-to-end suites. Plain CommonJS, no build step —
// same constraint as the frontend (dashboard/ and app/ have none): these
// run straight off disk with `node`, nothing to compile.
const path = require("node:path");

const API_URL = "http://localhost:8787";
const DASHBOARD_URL = "http://localhost:8788";
const APP_URL = "http://localhost:8789";

// Playwright is a pinned devDependency (the npm package is small; browsers
// are a separate `npx playwright install chromium`). PLAYWRIGHT_PATH and
// CHROMIUM_PATH override, and an installed Chrome is used if present.
const PLAYWRIGHT_CANDIDATES = [
  process.env.PLAYWRIGHT_PATH,
  "playwright",
].filter(Boolean);

const CHROMIUM_CANDIDATES = [
  process.env.CHROMIUM_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean);

function requirePlaywright() {
  for (const candidate of PLAYWRIGHT_CANDIDATES) {
    let resolved;
    try {
      resolved = require.resolve(candidate);
    } catch {
      continue;
    }
    // Deliberately outside the try: a Playwright that resolves but throws
    // on load is a real failure worth seeing, not a reason to fall
    // through to the next candidate and report "not installed".
    return require(resolved);
  }
  throw new Error(
    `Playwright not found. Looked in:\n${PLAYWRIGHT_CANDIDATES.map((c) => `  ${c}`).join("\n")}\n` +
      "Install it (npm i --no-save playwright && npx playwright install chromium) or set PLAYWRIGHT_PATH.",
  );
}

// null means "whatever browser Playwright installed for itself", which is
// the right answer after `npx playwright install chromium`.
function chromiumExecutable() {
  return CHROMIUM_CANDIDATES.find((c) => {
    try {
      return require("node:fs").existsSync(c);
    } catch {
      return false;
    }
  }) || null;
}

async function launchBrowser() {
  const { chromium } = requirePlaywright();
  return chromium.launch({ executablePath: chromiumExecutable() || undefined });
}

// No Access under `wrangler dev`, so no signed JWT. run.cjs sets
// TRUST_ACCESS_EMAIL_HEADER there and the worker takes this header instead
// (api/lib/access.js).
async function withAccessUser(context, email = "e2e@test.local") {
  await context.setExtraHTTPHeaders({ "Cf-Access-Authenticated-User-Email": email });
}

let failures = 0;
let passes = 0;

function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    passes++;
    console.log(`  PASS ${label}`);
  } else {
    failures++;
    console.log(`  FAIL ${label}\n       got:      ${a}\n       expected: ${e}`);
  }
}

function checkTrue(label, actual) {
  check(label, !!actual, true);
}

function failureCount() {
  return failures;
}

module.exports = {
  API_URL,
  DASHBOARD_URL,
  APP_URL,
  requirePlaywright,
  launchBrowser,
  withAccessUser,
  check,
  checkTrue,
  failureCount,
};
