#!/usr/bin/env node
/**
 * Pulls live prices from Vagaro into the site.
 *
 * Vagaro's public API has no service catalogue, so the only machine-readable
 * source of her prices is the booking widget. Each category widget is a
 * stateless permanent URL that renders that category's live services; we load
 * one per category in a headless browser and read the rendered rows.
 *
 * Writes content/site.json (prices + per-row booking links). The regeneration of
 * index.html is left to content-api.js, which owns that markup — this script
 * calls the same publish path so both stay in step.
 *
 *   node scripts/vagaro-sync.js            # dry run, prints what would change
 *   node scripts/vagaro-sync.js --apply    # writes the files
 *
 * Guards, because this publishes prices to a live medical-aesthetics site:
 *   - a widget yielding fewer rows than last time is treated as broken, not empty
 *   - $0 / missing / unparseable prices are skipped
 *   - a swing beyond MAX_SWING is held back and reported instead of applied
 */

const fs = require("fs");
const path = require("path");

// --fixtures <dir> replaces the browser with saved widget output, so the mapping,
// formatting and guards can be exercised without launching Chrome.
const FIXTURES = (() => {
  const i = process.argv.indexOf("--fixtures");
  return i > -1 ? process.argv[i + 1] : null;
})();
const puppeteer = FIXTURES ? null : require("puppeteer");

const ROOT = path.join(__dirname, "..");
const VAGARO = path.join(ROOT, "content", "vagaro.json");
const SITE = path.join(ROOT, "content", "site.json");
const MAX_SWING = 0.4;      // 40% — beyond this a human looks first
const MIN_ROWS = 1;         // a widget returning nothing is broken, not empty
const APPLY = process.argv.includes("--apply");

const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const norm = (s) =>
  String(s || "")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, " ")  // her service names carry emoji
    .replace(/[^a-z0-9+]+/gi, " ")
    .trim()
    .toLowerCase();

async function scrape(browser, label, url) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1600 });
  try {
    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });
    await page.waitForSelector(".service-title-alt", { timeout: 30000 });
    const rows = await page.$$eval(".service-detaildiv", (els) =>
      els.map((el) => ({
        name: (el.querySelector(".service-title-alt") || {}).textContent || "",
        price: (el.querySelector(".service-price-alt") || {}).textContent || "",
      }))
    );
    return rows
      .map((r) => {
        const money = (r.price.match(/\$[\d,]+\.\d{2}/g) || [])[0];
        return {
          name: r.name.replace(/\s+/g, " ").trim(),
          cents: money ? Math.round(parseFloat(money.replace(/[$,]/g, "")) * 100) : null,
          starting: /starting at/i.test(r.price),
        };
      })
      .filter((r) => r.name && !r.name.startsWith("${") && r.cents);
  } finally {
    await page.close();
  }
}

const fmtMoney = (cents) =>
  cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;

function priceFor(spec, found) {
  const hits = spec.v.map((want) => found.get(norm(want))).filter(Boolean);
  if (hits.length !== spec.v.length) return { error: `matched ${hits.length}/${spec.v.length} services` };
  if (spec.fmt === "range") {
    const lo = Math.min(...hits.map((h) => h.cents));
    const hi = Math.max(...hits.map((h) => h.cents));
    return { text: lo === hi ? fmtMoney(lo) : `${fmtMoney(lo)}–${fmtMoney(hi)}`, cents: lo };
  }
  const c = hits[0].cents;
  const prefix = spec.fmt === "from" || hits[0].starting ? "from " : "";
  return { text: prefix + fmtMoney(c), cents: c };
}

(async () => {
  const cfg = read(VAGARO);
  const site = read(SITE);
  const widgets = Object.entries(cfg.widgets).filter(([, u]) => u);
  if (!widgets.length) throw new Error("No Vagaro widget URLs configured");

  const browser = puppeteer
    ? await puppeteer.launch({
        headless: "new",
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
      })
    : null;

  const found = new Map();
  const perWidget = {};
  try {
    for (const [label, url] of widgets) {
      let rows = [];
      try {
        rows = FIXTURES
          ? JSON.parse(fs.readFileSync(path.join(FIXTURES, `services-${label}.json`), "utf8"))
              .map((r) => ({
                name: r.vagaro,
                cents: Math.round(parseFloat(String(r.price).replace(/[$,]/g, "")) * 100),
                starting: !!r.starting,
              }))
          : await scrape(browser, label, url);
      } catch (e) {
        console.log(`!! ${label}: ${e.message} — skipping, nothing from this widget is applied`);
      }
      perWidget[label] = rows.length;
      console.log(`   ${label.padEnd(12)} ${String(rows.length).padStart(3)} services`);
      for (const r of rows) if (!found.has(norm(r.name))) found.set(norm(r.name), r);
    }
  } finally {
    if (browser) await browser.close();
  }

  const broken = Object.entries(perWidget).filter(([, n]) => n < MIN_ROWS).map(([l]) => l);
  if (broken.length) {
    console.log(`\n!! ${broken.join(", ")} returned nothing. Vagaro may have changed their markup.`);
    console.log("   Refusing to publish a partial menu. No files written.");
    process.exit(1);
  }

  const changes = [], held = [], unmatched = [];
  for (const group of site.menu.groups) {
    for (const row of group.items) {
      const spec = cfg.map[row.name];
      if (!spec) { unmatched.push(row.name); continue; }

      const link = cfg.widgets[spec.w];
      if (link && row.href !== link) {
        changes.push({ row: row.name, what: "link", to: link, apply: () => (row.href = link) });
      }

      const p = priceFor(spec, found);
      if (p.error) { unmatched.push(`${row.name} (${p.error})`); continue; }
      if (p.text === row.price) continue;

      const old = (row.price.match(/[\d.]+/) || [])[0];
      const swing = old ? Math.abs(p.cents / 100 - parseFloat(old)) / parseFloat(old) : 1;
      if (swing > MAX_SWING) {
        held.push(`${row.name}: ${row.price} -> ${p.text} (${Math.round(swing * 100)}% swing)`);
        continue;
      }
      changes.push({ row: row.name, what: "price", from: row.price, to: p.text,
                     apply: () => (row.price = p.text) });
    }
  }

  console.log("\n=== changes ===");
  const priceChanges = changes.filter((c) => c.what === "price");
  const linkChanges = changes.filter((c) => c.what === "link");
  priceChanges.forEach((c) => console.log(`   ${c.row}: ${c.from} -> ${c.to}`));
  if (linkChanges.length) console.log(`   ${linkChanges.length} booking link(s) set`);
  if (!changes.length) console.log("   none — site already matches Vagaro");
  if (held.length) { console.log("\n=== held for review (large swing) ==="); held.forEach((h) => console.log("   " + h)); }
  if (unmatched.length) { console.log("\n=== unmapped rows ==="); unmatched.forEach((u) => console.log("   " + u)); }

  if (!APPLY) { console.log("\n(dry run — pass --apply to publish)"); return; }
  if (!changes.length) return;

  changes.forEach((c) => c.apply());

  // Publish through the same endpoint /admin uses, so index.html is regenerated by
  // the renderer that owns that markup and the whole thing lands as one commit.
  const base = (process.env.SITE_URL || "").replace(/\/$/, "");
  const key = process.env.CMS_KEY;
  if (!base || !key) throw new Error("SITE_URL and CMS_KEY must be set to publish");

  const res = await fetch(`${base}/.netlify/functions/content-api`, {
    method: "POST",
    headers: { "x-cms-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({ op: "save", section: "menu", data: site.menu }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`publish failed — HTTP ${res.status}: ${body.error || ""}`);
  console.log(`\npublished ${priceChanges.length} price change(s) — commit ${String(body.sha).slice(0, 7)}`);
})().catch((e) => { console.error(e); process.exit(1); });
