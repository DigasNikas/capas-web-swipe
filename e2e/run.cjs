// Starts wrangler dev (the worker, port 8787) and two http-server instances
// serving dashboard/ (8788) and app/ (8789), runs every *.e2e.cjs in this
// directory, then tears everything down. `npm run test:e2e`.
//
// Each static server is started with --proxy http://localhost:8787: any
// request that isn't a file on disk (i.e. every /api/* call) falls through
// to the worker. That's the same effective routing capas.digasnikas.com
// gets from Cloudflare (Pages serves the static file, the zone route sends
// /api/* to the worker instead) — reproduced locally without inventing a
// second thing to maintain.
//
// Separate from `node --test`: the unit tests are pure and finish in a
// second; these need a real browser and two dev servers and take longer.
const { spawn, execSync } = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { requirePlaywright } = require("./helpers.cjs");

const REPO_ROOT = path.resolve(__dirname, "..");
const API_LOG = path.join(__dirname, ".e2e-api.log");

const children = [];

const args = process.argv.slice(2);
const filters = args.filter((a) => !a.startsWith("--"));

const all = fs
  .readdirSync(__dirname)
  .filter((f) => f.endsWith(".e2e.cjs"))
  .sort();

function startServer(name, command, cmdArgs, cwd, logPath) {
  const out = logPath ? fs.openSync(logPath, "w") : "ignore";
  const child = spawn(command, cmdArgs, { cwd, stdio: ["ignore", out, out], detached: true });
  children.push({ name, child });
  return child;
}

async function waitForHttp(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.status) return true;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

function portInUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: "127.0.0.1", port });
    const done = (answer) => {
      socket.destroy();
      resolve(answer);
    };
    socket.setTimeout(1000);
    socket.once("connect", () => done(true));
    socket.once("timeout", () => done(false));
    socket.once("error", () => done(false));
  });
}

function shutdown() {
  for (const { child } of children) {
    try {
      // Negative pid: kill the whole process group. wrangler and
      // http-server both spawn children that outlive a plain kill and
      // then hold the ports, breaking the next run.
      process.kill(-child.pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
}
process.on("exit", shutdown);
process.on("SIGINT", () => {
  shutdown();
  process.exit(130);
});

(async () => {
  for (const [port, what] of [
    [8787, "the worker (wrangler dev)"],
    [8788, "dashboard (http-server)"],
    [8789, "app (http-server)"],
  ]) {
    if (await portInUse(port)) {
      console.error(
        `Port ${port} is already in use — ${what} is running elsewhere.\n` +
          "Close it before rerunning (pkill -f 'wrangler dev'; pkill -f workerd; pkill -f http-server).",
      );
      process.exit(1);
    }
  }

  try {
    requirePlaywright();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  // schema.sql is the authoritative full-state schema (see
  // dashboard/documentation/deployment.md's "D1 migrations" section) —
  // ai_club/ai_headline/ai_why and every migrations/*.sql column are
  // already in it. `wrangler d1 migrations apply` instead would try to
  // ALTER TABLE-add columns schema.sql already created and fail; a fresh
  // local D1 has no bootstrap migration for the base schema at all,
  // because production got it by hand before `migrations/` existed.
  console.log("Applying api/schema.sql to the local D1...");
  execSync(`npx wrangler d1 execute capas-db --local --file=api/schema.sql`, { cwd: REPO_ROOT, stdio: "ignore" });

  console.log("Starting the worker (wrangler dev) and the two static servers...");
  startServer(
    "worker",
    "npx",
    ["wrangler", "dev", "--port", "8787", "--var", "ADMIN_SECRET:e2e-test-secret"],
    REPO_ROOT,
    API_LOG,
  );
  startServer("dashboard", "npx", ["http-server", "dashboard", "-p", "8788", "--proxy", "http://localhost:8787"], REPO_ROOT, null);
  startServer("app", "npx", ["http-server", "app", "-p", "8789", "--proxy", "http://localhost:8787"], REPO_ROOT, null);

  if (!(await waitForHttp("http://localhost:8787/api/covers"))) {
    console.error("The worker did not start — see", API_LOG);
    process.exit(1);
  }
  if (!(await waitForHttp("http://localhost:8788/index.html"))) {
    console.error("dashboard's http-server did not start");
    process.exit(1);
  }
  if (!(await waitForHttp("http://localhost:8789/index.html"))) {
    console.error("app's http-server did not start");
    process.exit(1);
  }

  let suites = all;
  if (filters.length > 0) {
    suites = all.filter((f) => filters.some((needle) => f.includes(needle)));
    if (suites.length === 0) {
      console.error(`No suite matches ${filters.join(", ")}. Available: ${all.join(", ")}`);
      process.exit(1);
    }
  }

  let failed = 0;
  const failures = [];
  for (const suite of suites) {
    console.log(`\n=== ${suite} ===`);
    try {
      execSync(`node ${path.join(__dirname, suite)}`, { stdio: "inherit" });
    } catch (err) {
      // A suite that *asserts* wrong prints its own FAIL lines — the
      // reason is already on screen. A suite that dies before its first
      // check (thrown exception, browser wouldn't launch) exits without
      // printing anything, so this still needs to be surfaced.
      failed++;
      failures.push(suite);
      if (err.signal) console.error(`  (${suite} terminated by signal ${err.signal})`);
      else if (err.status !== 1) console.error(`  (${suite} exited with code ${err.status}: ${err.message})`);
    }
  }

  console.log(
    failed === 0
      ? `\nAll ${suites.length} suites passed.`
      : `\n${failed} of ${suites.length} suites failed: ${failures.join(", ")}`,
  );
  process.exit(failed > 0 ? 1 : 0);
})();
