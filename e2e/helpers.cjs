// Shared plumbing for the end-to-end suites. Plain CommonJS, no build step —
// same constraint as the frontend (dashboard/ and app/ have none): these
// run straight off disk with `node`, nothing to compile.
const path = require("node:path");

const API_URL = "http://localhost:8787";
const DASHBOARD_URL = "http://localhost:8788";
const APP_URL = "http://localhost:8789";

// Playwright and Chromium come from the environment rather than
// package.json: they're only needed to run these suites, and adding
// ~300MB of devDependency to a repo that deploys as a plain Cloudflare
// Worker + two static Pages projects isn't worth it. A list tried in
// order, overridable by env var, so a machine with Playwright already in
// node_modules or Chrome in /Applications just works.
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

// Access ("app.capas.digasnikas.com") is a Cloudflare edge product with no
// local equivalent under `wrangler dev` — the worker just trusts
// Cf-Access-Authenticated-User-Email on every app-side handler (see
// api/handlers/covers.js, swipes.js). Locally that means setting the same
// header ourselves reproduces exactly the trust boundary Access provides
// in production, nothing more.
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
