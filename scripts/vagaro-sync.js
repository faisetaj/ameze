#!/usr/bin/env node
/**
 * Mirrors her live Vagaro service catalogue onto the site — one source of truth.
 *
 * She edits services in Vagaro only: add, remove, rename, reprice, or rewrite a
 * description there, and the next sync carries it to the site's treatment menu.
 * Categories become the menu tabs, in Vagaro's order; services become the rows.
 *
 * Vagaro's public API has no service catalogue, so the source is the booking
 * widget: a stateless permanent URL that renders her live services grouped by
 * category, with prices (promo-aware) and descriptions.
 *
 *   node scripts/vagaro-sync.js                   # dry run, prints what would change
 *   node scripts/vagaro-sync.js --apply           # publish through content-api (the Action)
 *   node scripts/vagaro-sync.js --write-local     # write content/site.json + index.html here
 *   node scripts/vagaro-sync.js --dump cat.json   # save the scraped catalogue (fixture/debug)
 *   node scripts/vagaro-sync.js --fixtures cat.json  # run from a saved catalogue, no Chrome
 *
 * Guards, because this publishes to a live medical-aesthetics site:
 *   - a short read (few rows or categories) is a broken render, not a pruned menu
 *   - if most of the current menu would vanish, refuse and ask a human
 *   - $0 / missing / unparseable prices are skipped and reported
 *   - a price swing beyond MAX_SWING on an existing row keeps the old price and reports
 */

const fs = require("fs");
const path = require("path");

const argAfter = (flag) => {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : null;
};
const FIXTURES = argAfter("--fixtures");
const DUMP = argAfter("--dump");
const APPLY = process.argv.includes("--apply");
const WRITE_LOCAL = process.argv.includes("--write-local");
// The Action installs full puppeteer (bundled Chromium); a dev machine may only
// have puppeteer-core plus its own Chrome.
const puppeteer = FIXTURES ? null : (() => {
  try { return require("puppeteer"); } catch { return require("puppeteer-core"); }
})();

const ROOT = path.join(__dirname, "..");
const VAGARO = path.join(ROOT, "content", "vagaro.json");
const SITE = path.join(ROOT, "content", "site.json");
const PAGE = path.join(ROOT, "index.html");

const MAX_SWING = 0.4;   // 40% price move on an existing row — a human looks first
const MIN_ROWS = 20;     // fewer service rows than this = partial render
const MIN_CATS = 3;      // fewer categories than this = partial render
const MIN_KEEP = 0.6;    // if less than 60% of current rows survive, refuse to publish
const NAME_MAX = 90, DESC_MAX = 300;   // content-api field limits

const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

// Matching key: emoji and punctuation out, case-folded. Same rule as always.
const norm = (s) =>
  String(s || "")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, " ")
    .replace(/[^a-z0-9+]+/gi, " ")
    .trim()
    .toLowerCase();

// Display cleanup: her Vagaro names carry emoji; the menu's type doesn't.
const display = (s, max) =>
  String(s || "")
    .replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

const fmtMoney = (cents) =>
  cents % 100 === 0 ? `$${cents / 100}` : `$${(cents / 100).toFixed(2)}`;

const cents = (money) =>
  money ? Math.round(parseFloat(money.replace(/[$,]/g, "")) * 100) : null;

/* ── scrape: the whole catalogue, grouped by category ── */
async function scrapeCatalogue(url) {
  const browser = await puppeteer.launch({
    headless: true,
    executablePath:
      process.env.PUPPETEER_EXECUTABLE_PATH ||
      (fs.existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
        ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        : undefined),
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 1600 });
    await page.goto(url, { waitUntil: "networkidle2", timeout: 60000 });

    // Vagaro loads an Incapsula beacon on healthy pages too — only classify a
    // failure once the page has actually failed to produce services.
    try {
      await page.waitForSelector(".service-title-alt", { timeout: 30000 });
    } catch {
      const html = await page.content();
      if (/Request unsuccessful|Incapsula incident|\bincident ID\b/i.test(html) || html.length < 5000) {
        throw new Error("blocked by Vagaro's bot protection — backing off, not working around it");
      }
      throw new Error("no service rows rendered — Vagaro may have changed their markup");
    }

    const categories = await page.evaluate(() => {
      const cards = Array.from(document.querySelectorAll(".card"))
        .filter((c) => c.querySelector(".service-detaildiv"));
      return cards.map((card) => {
        const headerEl = card.querySelector(".card-header");
        const name = headerEl
          ? headerEl.textContent.replace(/\s+/g, " ").replace(/\(\d+\)/g, "").trim()
          : "";
        const rows = Array.from(card.querySelectorAll(".service-detaildiv")).map((row) => {
          const titleEl = row.querySelector(".service-title-alt");
          const priceEl = row.querySelector(".service-price-alt");
          const descEl = row.querySelector(".service-mobile-hide p, #pServiceDesc");
          let prices = [];
          let promo = false;
          if (priceEl) {
            const all = priceEl.textContent.match(/\$[\d,]+\.\d{2}/g) || [];
            const struckText = Array.from(priceEl.querySelectorAll('[style*="line-through"]'))
              .map((e) => e.textContent).join(" ");
            const struck = struckText.match(/\$[\d,]+\.\d{2}/g) || [];
            promo = struck.length > 0;
            prices = all.filter((p) => !struck.includes(p));
            if (!prices.length) prices = all;
          }
          return {
            name: titleEl ? titleEl.textContent.replace(/\s+/g, " ").trim() : "",
            price: prices[0] || "",
            starting: /starting at/i.test(priceEl ? priceEl.textContent : ""),
            promo,
            desc: descEl ? descEl.textContent.replace(/\s+/g, " ").trim() : "",
          };
        });
        return { name, rows };
      });
    });
    return categories;
  } finally {
    await browser.close();
  }
}

(async () => {
  const cfg = read(VAGARO);
  const site = read(SITE);
  if (!cfg.widgets.all) throw new Error('content/vagaro.json needs an "all" widget — it is the catalogue source');

  let catalogue;
  try {
    catalogue = FIXTURES ? read(FIXTURES) : await scrapeCatalogue(cfg.widgets.all);
  } catch (e) {
    console.log(`!! ${e.message}`);
    console.log("   Refusing to publish. The site keeps its current menu.");
    process.exit(1);
  }
  if (DUMP) {
    fs.writeFileSync(DUMP, JSON.stringify(catalogue, null, 1));
    console.log(`catalogue dumped to ${DUMP}`);
  }

  /* ── validate the read ── */
  const totalRows = catalogue.reduce((n, c) => n + c.rows.length, 0);
  console.log(`   read ${catalogue.length} categories, ${totalRows} services from Vagaro`);
  if (totalRows < MIN_ROWS || catalogue.length < MIN_CATS) {
    console.log(`\n!! too little rendered (${catalogue.length} categories / ${totalRows} rows).`);
    console.log("   Treating that as a broken read. Refusing to publish a partial menu.");
    process.exit(1);
  }

  /* ── carry-over maps from the current site content ── */
  const oldItems = new Map();   // norm(name) -> {price, desc}
  const oldNotes = new Map();   // norm(group) -> note
  for (const g of site.menu.groups) {
    if (g.note) oldNotes.set(norm(g.name), g.note);
    for (const it of g.items) oldItems.set(norm(it.name), it);
  }

  const widgetFor = (catName) => {
    const key = (cfg.categoryWidgets || {})[norm(catName)];
    return (key && cfg.widgets[key]) || cfg.widgets.all;
  };

  /* ── build the new menu ── */
  // cfg.hide lists normalized category/service names that are bookable line
  // items but not menu material (e.g. the no-show fee).
  const hidden = new Set((cfg.hide || []).map(norm));
  const skipped = [], held = [], promos = [];
  const groups = catalogue
    .filter((c) => c.name && c.rows.length && !hidden.has(norm(c.name)))
    .map((c) => {
      const items = c.rows
        .map((r) => {
          if (hidden.has(norm(r.name))) return null;
          const cts = cents(r.price);
          if (!r.name || !cts) { skipped.push(`${r.name || "(unnamed)"} — no usable price`); return null; }
          let priceText = (r.starting ? "from " : "") + fmtMoney(cts);
          const old = oldItems.get(norm(r.name));
          if (old) {
            const oldNum = (String(old.price).match(/[\d.]+/) || [])[0];
            const swing = oldNum ? Math.abs(cts / 100 - parseFloat(oldNum)) / parseFloat(oldNum) : 0;
            if (swing > MAX_SWING) {
              held.push(`${r.name}: ${old.price} -> ${priceText} (${Math.round(swing * 100)}% swing — kept old price)`);
              priceText = old.price;
            }
          }
          if (r.promo) promos.push(r.name);
          const desc = display(r.desc || (old ? old.desc : ""), 10000);
          return {
            name: display(r.name, NAME_MAX),
            price: priceText,
            desc: desc.length > DESC_MAX ? desc.slice(0, DESC_MAX - 1).trimEnd() + "…" : desc,
            href: widgetFor(c.name),
          };
        })
        .filter(Boolean);
      return {
        name: display(c.name, 40),
        note: oldNotes.get(norm(c.name)) || "",
        items,
      };
    })
    .filter((g) => g.items.length);

  /* ── mass-removal guard ── */
  const newNames = new Set(groups.flatMap((g) => g.items.map((i) => norm(i.name))));
  const survivors = [...oldItems.keys()].filter((k) => newNames.has(k)).length;
  const keepRatio = oldItems.size ? survivors / oldItems.size : 1;
  const removed = [...oldItems.keys()].filter((k) => !newNames.has(k));
  const added = [...newNames].filter((k) => !oldItems.has(k));

  console.log(`\n=== changes ===`);
  console.log(`   ${added.length} added, ${removed.length} removed, ${groups.length} categories`);
  if (added.length) added.forEach((a) => console.log(`   + ${a}`));
  if (removed.length) removed.forEach((r) => console.log(`   - ${r}`));
  if (promos.length) console.log(`   ${promos.length} on promo pricing: ${promos.join(", ")}`);
  if (held.length) { console.log("\n=== held (large swing, kept old price) ==="); held.forEach((h) => console.log("   " + h)); }
  if (skipped.length) { console.log("\n=== skipped rows ==="); skipped.forEach((s) => console.log("   " + s)); }

  if (keepRatio < MIN_KEEP && !process.env.FORCE_SYNC) {
    console.log(`\n!! only ${Math.round(keepRatio * 100)}% of the current menu survives this read.`);
    console.log("   That looks like a broken read, not a pruned menu. Refusing to publish.");
    console.log("   (Set FORCE_SYNC=1 if the menu really did shrink that much.)");
    process.exit(1);
  }

  const photoCount = ((site["photos-menu"] || {}).items || []).length;
  if (photoCount && photoCount < groups.length) {
    console.log(`\n   note: ${groups.length} categories but ${photoCount} rotator photos —`);
    console.log("   later tabs keep the previous photo. Add photos in /admin if wanted.");
  }

  const newMenu = { groups };
  if (JSON.stringify(newMenu) === JSON.stringify(site.menu)) {
    console.log("\n   site already matches Vagaro — nothing to publish");
    return;
  }

  if (!APPLY && !WRITE_LOCAL) { console.log("\n(dry run — pass --apply to publish)"); return; }

  site.menu = newMenu;

  if (WRITE_LOCAL) {
    // Same renderer the live publish path uses — one definition of the markup.
    const { applySections } = require("../netlify/functions/content-api.js");
    fs.writeFileSync(SITE, JSON.stringify(site, null, 2) + "\n");
    fs.writeFileSync(PAGE, applySections(fs.readFileSync(PAGE, "utf8"), site));
    console.log("\nwrote content/site.json and regenerated index.html locally");
    return;
  }

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
  console.log(`\npublished — commit ${String(body.sha).slice(0, 7)}`);
})().catch((e) => { console.error(e); process.exit(1); });
