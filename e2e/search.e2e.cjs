// GET /search + search.html's modal, driven end to end. A unit test can
// cover buildFtsQuery's escaping (api/handlers/search.test.mjs already
// does), but not that typing into #q actually renders a result and that
// clicking it opens #modal1 with the right image — that's real DOM
// behavior, worth an e2e check per the "don't mock a whole browser" call
// made across this project's other suites.
const { execSync } = require("node:child_process");
const { DASHBOARD_URL, launchBrowser, check, checkTrue, failureCount } = require("./helpers.cjs");

const HEADLINE = "E2E teste palhinha derby";
const COVER_URL = "https://example.com/e2e-cover.jpg";

// INSERT OR IGNORE: reruns against an already-seeded local D1 (dev left the
// server up, a previous run didn't clean up) must not fail on the
// (newspaper, date) unique constraint.
execSync(
  `npx wrangler d1 execute capas-db --local --command "` +
    `INSERT OR IGNORE INTO covers (newspaper, date, r2_key, url, thumb_url, headlines) ` +
    `VALUES ('record', '2020-01-01', 'e2e/test.jpg', '${COVER_URL}', '${COVER_URL}', '${HEADLINE}')"`,
  { stdio: "ignore" },
);

(async () => {
  const browser = await launchBrowser();
  const page = await browser.newPage();

  console.log("searching for a seeded headline renders and opens it");
  await page.goto(`${DASHBOARD_URL}/search.html`);
  // "attached" not the default "visible": #results starts empty and
  // zero-size, which Playwright otherwise reads as hidden.
  await page.waitForSelector("#results", { state: "attached" });

  await page.fill("#q", "palhinha derby");
  // Debounced 300ms in search.html before the fetch fires.
  await page.waitForFunction(
    () => document.querySelectorAll("#results .result").length > 0,
    { timeout: 5000 },
  );

  const resultCount = await page.evaluate(() => document.querySelectorAll("#results .result").length);
  check("exactly one result for the seeded headline", resultCount, 1);

  await page.click("#results .result");
  await page.waitForSelector("#modal1:not(.hidden)");
  const modalSrc = await page.evaluate(() => document.getElementById("modal1-img").src);
  check("modal1 shows the clicked cover's full image", modalSrc, COVER_URL);

  console.log("Escape closes the modal");
  await page.keyboard.press("Escape");
  // "attached": .hidden sets display:none, which is display:none by
  // design here — the opposite of what "visible" would wait for.
  await page.waitForSelector("#modal1.hidden", { state: "attached" });
  checkTrue("modal1 is hidden again", await page.evaluate(() => document.getElementById("modal1").classList.contains("hidden")));

  console.log("an empty-looking query returns nothing and shows the empty state");
  await page.fill("#q", "xyznonexistentheadline");
  await page.waitForFunction(
    () => document.querySelector("#results .empty") !== null,
    { timeout: 5000 },
  );
  checkTrue("empty state shown", await page.evaluate(() => document.querySelector("#results .empty") !== null));

  await browser.close();
  process.exit(failureCount() > 0 ? 1 : 0);
})();
