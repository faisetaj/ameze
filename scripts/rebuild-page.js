#!/usr/bin/env node
/**
 * Regenerates the cms: regions of index.html from content/site.json, using the
 * same renderers the live publish path uses. Normally the Netlify function does
 * this on publish; this is for bootstrapping and for verifying locally that a
 * content change produces the markup you expect.
 *
 *   node scripts/rebuild-page.js          # report whether the page is in sync
 *   node scripts/rebuild-page.js --write  # rewrite index.html
 */
const fs = require("fs");
const path = require("path");
const { applySections } = require("../netlify/functions/content-api.js");

const ROOT = path.join(__dirname, "..");
const PAGE = path.join(ROOT, "index.html");
const SITE = path.join(ROOT, "content", "site.json");

const before = fs.readFileSync(PAGE, "utf8");
const content = JSON.parse(fs.readFileSync(SITE, "utf8"));
const after = applySections(before, content);

if (before === after) {
  console.log("index.html already matches content/site.json");
  process.exit(0);
}

const delta = after.length - before.length;
console.log(`index.html differs from content/site.json (${delta >= 0 ? "+" : ""}${delta} chars)`);

if (process.argv.includes("--write")) {
  fs.writeFileSync(PAGE, after, "utf8");
  console.log("rewrote index.html");
} else {
  console.log("(pass --write to apply)");
}
