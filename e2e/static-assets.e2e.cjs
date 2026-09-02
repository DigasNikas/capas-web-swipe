// Structural checks across every page in dashboard/ and app/ — the two
// failure modes a stray edit to a shared file (dashboard.css, dashboard.js,
// app.js, style.css) can introduce that nothing else here would catch:
//
// 1. A mistyped path in a <link>/<script> tag. A <script src> that 404s
//    doesn't throw and doesn't run — the page just silently loses whatever
//    that file was supposed to define, until someone notices a control
//    that never wires up.
// 2. A leftover inline declaration colliding with a shared one, or any
//    other error thrown at load time — invisible to a check that only
//    looks at rendered content, since the browser paints nothing to look
//    at when a script dies before running.
const path = require("node:path");
const fs = require("node:fs");
const { DASHBOARD_URL, APP_URL, launchBrowser, withAccessUser, check, checkTrue, failureCount } = require("./helpers.cjs");

const REPO_ROOT = path.resolve(__dirname, "..");

// [dir, baseUrl, htmlFile, readySelector]
const PAGES = [
  ["dashboard", DASHBOARD_URL, "index.html", "#calendar"],
  ["dashboard", DASHBOARD_URL, "search.html", "#results"],
  ["dashboard", DASHBOARD_URL, "similarities.html", "main"],
  ["dashboard", DASHBOARD_URL, "documentation.html", "#content h1"],
  ["app", APP_URL, "index.html", "#card-area"],
];

(async () => {
  const browser = await launchBrowser();

  console.log("every root-relative resource path resolves");
  const roots = new Set();
  for (const [dir, , file] of PAGES) {
    const html = fs.readFileSync(path.join(REPO_ROOT, dir, file), "utf8");
    for (const m of html.matchAll(/(?:src|href)="(\/[^"]*)"/g)) {
      const url = m[1].split(/[?#]/)[0];
      // /cdn-cgi/* is injected and served by the Cloudflare edge itself
      // (Access login/logout among others) — never a file on disk, and
      // has no local equivalent to resolve against.
      if (url.startsWith("/cdn-cgi/")) continue;
      roots.add(`${dir}:${url}`);
    }
  }
  const broken = [];
  for (const entry of roots) {
    const [dir, url] = entry.split(":");
    if (!url || url === "/") continue;
    const base = dir === "app" ? APP_URL : DASHBOARD_URL;
    const res = await fetch(`${base}${url}`);
    if (res.status !== 200) broken.push(`${entry}: ${res.status}`);
  }
  check("no broken resource path", broken.sort(), []);
  checkTrue("...the check itself covers dashboard.css", roots.has("dashboard:/dashboard.css"));
  checkTrue("...and dashboard.js", roots.has("dashboard:/dashboard.js"));
  checkTrue("...and app's style.css", roots.has("app:/style.css"));
  checkTrue("...and app.js", roots.has("app:/app.js"));

  console.log("no page throws or repeats a DOM id");
  const context = await browser.newContext();
  await withAccessUser(context);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));

  const dupesByPage = {};
  async function visit(label, url, readySelector) {
    try {
      await page.goto(url);
      // "attached" not the default "visible": several ready selectors
      // (e.g. search.html's empty #results) are correctly zero-size until
      // there's content, which Playwright otherwise reads as hidden.
      await page.waitForSelector(readySelector, { state: "attached", timeout: 15000 });
      const ids = await page.evaluate(() => [...document.querySelectorAll("[id]")].map((el) => el.id));
      const seen = new Set();
      const dupes = new Set();
      for (const id of ids) {
        if (seen.has(id)) dupes.add(id);
        seen.add(id);
      }
      dupesByPage[label] = [...dupes].sort();
    } catch (err) {
      dupesByPage[label] = [`(page did not load: ${err.message.split("\n")[0]})`];
    }
  }

  for (const [dir, base, file, readySelector] of PAGES) {
    await visit(`${dir}/${file}`, `${base}/${file}`, readySelector);
  }

  for (const [pageName, dupes] of Object.entries(dupesByPage)) {
    check(`${pageName}: no duplicate id`, dupes, []);
  }
  check("no page threw (pageerror)", errors, []);

  await browser.close();
  process.exit(failureCount() > 0 ? 1 : 0);
})();
