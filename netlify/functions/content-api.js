// CMS API for the text sections of the home page — everything Vagaro can't reach.
//
// Companion to specials-api.js, which owns the promo cards (those involve image
// uploads and their own history). This one owns the treatment menu, reviews,
// membership, protocol, studio hours and the headline numbers.
//
// Same contract as specials: one Publish = one commit = one deploy. Content lives in
// content/site.json, and the matching regions of index.html are regenerated between
// <!-- cms:<name>:start --> / <!-- cms:<name>:end --> markers, so there is no
// client-side rendering to go stale and no JS needed to read the page.
//
// GET  ?op=load                        -> { content, history }
// POST {op:"save", section, data}      -> publish one section
// POST {op:"restore", sha}             -> republish the whole file from an older commit
//
// Env vars: GH_TOKEN, REPO, CMS_KEY (or ADMIN_KEY), BRANCH (default "main")

const GH_API = "https://api.github.com";
const JSON_PATH = "content/site.json";
const PAGE_PATH = "index.html";
const BOOKING = "https://www.vagaro.com/amezeskinelements/services";

/* ─────────────────────────────────────────────
   Section registry — the whole surface in one place.
   kind "list"   : a flat list of records
   kind "groups" : named groups, each holding a list of records
   ───────────────────────────────────────────── */
const SECTIONS = {
  menu: {
    label: "Treatment menu",
    marker: "menu",
    kind: "groups",
    groupLabel: "Category",
    groupFields: [
      { key: "name", label: "Tab name", max: 40, required: true },
      { key: "note", label: "Intro line", max: 220 },
    ],
    fields: [
      { key: "name", label: "Treatment", max: 90, required: true },
      { key: "price", label: "Price", max: 24, required: true },
      { key: "desc", label: "Description", max: 300 },
      // Set by the Vagaro sync so a row opens its own category in the booking
      // modal instead of the top of the full menu. Hidden from the editor.
      { key: "href", label: "Booking link", max: 900, type: "url", internal: true },
    ],
    maxGroups: 6,
    maxItems: 16,
    render: renderMenu,
  },
  reviews: {
    label: "Reviews",
    marker: "reviews",
    kind: "list",
    fields: [
      { key: "quote", label: "Quote", max: 600, required: true, multiline: true },
      { key: "who", label: "Attribution", max: 120, required: true },
      { key: "lead", label: "Show as the big quote", type: "bool" },
    ],
    maxItems: 8,
    extras: [
      { key: "eyebrow", label: "Section eyebrow", max: 120 },
      { key: "scores", label: "Score line (separate with |)", max: 240 },
    ],
    render: renderReviews,
  },
  membership: {
    label: "Membership & payment",
    marker: "membership",
    kind: "list",
    fields: [
      { key: "tag", label: "Label", max: 40, required: true },
      { key: "title", label: "Heading", max: 60, required: true },
      { key: "price", label: "Price", max: 30, required: true },
      { key: "priceNote", label: "After the price", max: 60 },
      { key: "bullets", label: "Bullet points (one per line, **bold**)", max: 900, multiline: true },
      { key: "cta", label: "Button text", max: 40 },
      { key: "href", label: "Button link", max: 300, type: "url" },
      { key: "feature", label: "Highlight this one", type: "bool" },
    ],
    maxItems: 4,
    render: renderMembership,
  },
  protocol: {
    label: "Before & after care",
    marker: "protocol",
    kind: "groups",
    groupLabel: "Column",
    groupFields: [{ key: "name", label: "Heading", max: 60, required: true }],
    fields: [{ key: "text", label: "Step", max: 300, required: true, multiline: true }],
    maxGroups: 2,
    maxItems: 10,
    render: renderProtocol,
  },
  "hours-houston": {
    label: "Houston hours",
    marker: "hours-houston",
    kind: "list",
    fields: [
      { key: "days", label: "Days", max: 30, required: true },
      { key: "time", label: "Hours", max: 30, required: true },
    ],
    maxItems: 7,
    render: renderHours,
  },
  "hours-richmond": {
    label: "Richmond hours",
    marker: "hours-richmond",
    kind: "list",
    fields: [
      { key: "days", label: "Days", max: 30, required: true },
      { key: "time", label: "Hours", max: 30, required: true },
    ],
    maxItems: 7,
    render: renderHours,
  },
  numbers: {
    label: "Headline numbers",
    marker: "numbers",
    kind: "list",
    fields: [
      { key: "value", label: "Number", max: 12, required: true },
      { key: "suffix", label: "Small text after it", max: 12 },
      { key: "label", label: "Caption", max: 120, required: true },
    ],
    maxItems: 4,
    render: renderNumbers,
  },
};

exports.handler = async (event) => {
  const expected = (process.env.CMS_KEY || process.env.ADMIN_KEY || "").trim();
  if (!expected) {
    return json(503, {
      error: "This site has no CMS_KEY set. Add it in Netlify → Site configuration → " +
             "Environment variables (scope: Functions, or All), then redeploy.",
    });
  }
  if ((event.headers["x-cms-key"] || "").trim() !== expected) {
    return json(401, { error: "unauthorized" });
  }

  const repo = process.env.REPO;
  const token = process.env.GH_TOKEN;
  const branch = process.env.BRANCH || "main";
  const missing = ["REPO", "GH_TOKEN"].filter((v) => !process.env[v]);
  if (missing.length) {
    return json(500, {
      error: `This site is missing ${missing.join(" and ")} in its Netlify environment ` +
             `variables. Add ${missing.length > 1 ? "them" : "it"} under Site configuration → ` +
             `Environment variables with Scopes including Functions, then redeploy.`,
    });
  }

  const gh = (path, opts = {}) =>
    fetch(`${GH_API}${path}`, {
      ...opts,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        ...(opts.headers || {}),
      },
    });

  const ghJson = async (path, opts) => {
    const r = await gh(path, opts);
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`GitHub ${r.status} on ${path}: ${data.message || r.statusText}`);
    return data;
  };

  const readFile = async (path, ref) => {
    const d = await ghJson(`/repos/${repo}/contents/${path}?ref=${ref || branch}`);
    return Buffer.from(d.content, "base64").toString("utf8");
  };

  const commitFiles = async (files, message) => {
    const ref = await ghJson(`/repos/${repo}/git/ref/heads/${branch}`);
    const parent = ref.object.sha;
    const base = await ghJson(`/repos/${repo}/git/commits/${parent}`);
    const tree = [];
    for (const f of files) {
      const blob = await ghJson(`/repos/${repo}/git/blobs`, {
        method: "POST",
        body: JSON.stringify({ content: f.base64, encoding: "base64" }),
      });
      tree.push({ path: f.path, mode: "100644", type: "blob", sha: blob.sha });
    }
    const newTree = await ghJson(`/repos/${repo}/git/trees`, {
      method: "POST",
      body: JSON.stringify({ base_tree: base.tree.sha, tree }),
    });
    const commit = await ghJson(`/repos/${repo}/git/commits`, {
      method: "POST",
      body: JSON.stringify({ message, tree: newTree.sha, parents: [parent] }),
    });
    await ghJson(`/repos/${repo}/git/refs/heads/${branch}`, {
      method: "PATCH",
      body: JSON.stringify({ sha: commit.sha }),
    });
    return commit.sha;
  };

  // Read site.json, falling back to whatever is currently in the page so the very
  // first publish starts from the real content rather than a blank slate.
  const loadContent = async (ref) => {
    let stored = {};
    try { stored = JSON.parse(await readFile(JSON_PATH, ref)); } catch (e) { stored = {}; }
    return stored;
  };

  const publish = async (content, message) => {
    let page = await readFile(PAGE_PATH);
    for (const [name, spec] of Object.entries(SECTIONS)) {
      if (!content[name]) continue;
      const start = `<!-- cms:${spec.marker}:start -->`;
      const end = `<!-- cms:${spec.marker}:end -->`;
      if (!page.includes(start) || !page.includes(end)) {
        throw new Error(`index.html is missing the ${start} / ${end} markers`);
      }
      page = page.replace(
        new RegExp(`${escapeRe(start)}[\\s\\S]*?${escapeRe(end)}`),
        () => start + "\n" + spec.render(content[name]) + "\n      " + end
      );
    }
    const sha = await commitFiles(
      [
        { path: JSON_PATH, base64: b64(JSON.stringify(content, null, 2) + "\n") },
        { path: PAGE_PATH, base64: b64(page) },
      ],
      message
    );
    return { sha, content };
  };

  try {
    if (event.httpMethod === "GET") {
      const [content, commits] = await Promise.all([
        loadContent(),
        ghJson(`/repos/${repo}/commits?path=${JSON_PATH}&sha=${branch}&per_page=8`).catch(() => []),
      ]);
      return json(200, {
        schema: publicSchema(),
        // The change-request portal link carries the portal key, so it must never sit in
        // the public /admin HTML — it is only handed out here, behind the CMS key.
        careUrl: process.env.CARE_URL || "",
        content,
        history: commits.slice(1).map((c) => ({
          sha: c.sha,
          message: (c.commit.message || "").split("\n")[0],
          date: c.commit.committer.date,
        })),
      });
    }

    if (event.httpMethod === "POST") {
      const body = JSON.parse(event.body || "{}");

      if (body.op === "save") {
        const spec = SECTIONS[body.section];
        if (!spec) return json(400, { error: `Unknown section "${body.section}"` });
        const content = await loadContent();
        content[body.section] = validate(spec, body.data);
        const result = await publish(content, `Update ${spec.label.toLowerCase()} (via /admin)`);
        return json(200, result);
      }

      if (body.op === "restore") {
        if (!/^[0-9a-f]{7,40}$/i.test(body.sha || "")) return json(400, { error: "bad sha" });
        const old = await loadContent(body.sha);
        const result = await publish(old, `Restore site content from ${body.sha.slice(0, 7)} (via /admin)`);
        return json(200, result);
      }

      return json(400, { error: "unknown op" });
    }

    return json(405, { error: "method not allowed" });
  } catch (e) {
    console.error(e);
    return json(500, { error: e.message });
  }
};

/* ─────────────────────────────────────────────
   validation
   ───────────────────────────────────────────── */

function validate(spec, data) {
  if (spec.kind === "groups") {
    const groups = Array.isArray(data && data.groups) ? data.groups : null;
    if (!groups || !groups.length) throw new Error(`${spec.label} needs at least one ${(spec.groupLabel || "group").toLowerCase()}.`);
    if (groups.length > spec.maxGroups) throw new Error(`${spec.label}: no more than ${spec.maxGroups} ${(spec.groupLabel || "group").toLowerCase()}s.`);
    return {
      groups: groups.map((g, gi) => {
        const out = {};
        for (const f of spec.groupFields) out[f.key] = checkField(f, g[f.key], `${spec.label} ${spec.groupLabel} ${gi + 1}`);
        const items = Array.isArray(g.items) ? g.items : [];
        if (!items.length) throw new Error(`"${out.name || spec.groupLabel + " " + (gi + 1)}" has no rows yet.`);
        if (items.length > spec.maxItems) throw new Error(`"${out.name}": no more than ${spec.maxItems} rows.`);
        out.items = items.map((it, i) => checkRecord(spec.fields, it, `"${out.name}" row ${i + 1}`));
        return out;
      }),
    };
  }

  const items = Array.isArray(data && data.items) ? data.items : null;
  if (!items || !items.length) throw new Error(`${spec.label} needs at least one entry.`);
  if (items.length > spec.maxItems) throw new Error(`${spec.label}: no more than ${spec.maxItems} entries.`);
  const out = { items: items.map((it, i) => checkRecord(spec.fields, it, `${spec.label} entry ${i + 1}`)) };
  for (const f of spec.extras || []) out[f.key] = checkField(f, (data || {})[f.key], spec.label);
  return out;
}

function checkRecord(fields, rec, where) {
  const out = {};
  for (const f of fields) out[f.key] = checkField(f, (rec || {})[f.key], where);
  return out;
}

function checkField(f, raw, where) {
  if (f.type === "bool") return !!raw;
  const v = f.multiline
    ? String(raw == null ? "" : raw).replace(/\r/g, "").replace(/[ \t]+$/gm, "").trim()
    : String(raw == null ? "" : raw).replace(/\s+/g, " ").trim();
  if (f.required && !v) throw new Error(`${where}: ${f.label.toLowerCase()} can't be empty.`);
  if (v.length > f.max) throw new Error(`${where}: ${f.label.toLowerCase()} is too long (max ${f.max}).`);
  if (f.type === "url" && v && !/^https:\/\//.test(v)) throw new Error(`${where}: the link must start with https://`);
  return v.slice(0, f.max);
}

/* ─────────────────────────────────────────────
   renderers — markup mirrors the hand-written page exactly,
   including the reveal classes the animations depend on
   ───────────────────────────────────────────── */

function renderMenu(d) {
  const tabs = d.groups.map((g, i) =>
    `        <button class="tab${i === 0 ? " on" : ""}" role="tab" aria-selected="${i === 0}" data-panel="p-c${i}">${esc(g.name)}</button>`
  ).join("\n");

  const panels = d.groups.map((g, i) => {
    const rows = g.items.map((it) =>
      `        <a class="prow" data-book href="${esc(it.href || BOOKING)}" target="_blank" rel="noopener">` +
      `<span class="prow-line"><span class="t">${esc(it.name)}</span><span class="lead"></span>` +
      `<span class="p">${esc(it.price)}</span></span>` +
      `<span class="d">${esc(it.desc)}</span></a>`
    ).join("\n");
    return `      <div class="panel${i === 0 ? " on" : ""}" id="p-c${i}" role="tabpanel">\n` +
           (g.note ? `        <p class="panel-note">${esc(g.note)}</p>\n` : "") +
           rows + `\n      </div>`;
  }).join("\n\n");

  return `      <div class="tabs" role="tablist" aria-label="Service categories">\n${tabs}\n` +
         `        <span class="tab-ind" aria-hidden="true"></span>\n      </div>\n\n${panels}`;
}

function renderReviews(d) {
  const lead = d.items.find((r) => r.lead) || d.items[0];
  const rest = d.items.filter((r) => r !== lead);
  const scores = String(d.scores || "").split("|").map((s) => s.trim()).filter(Boolean)
    .map((s) => `<span>${esc(s)}</span>`).join("");

  return [
    `          <p class="mono rv">${esc(d.eyebrow)}</p>`,
    `          <blockquote class="trust-quote rv">${emphasise(lead.quote)}</blockquote>`,
    `          <p class="mono trust-attr rv">${esc(lead.who)}</p>`,
    `          <div class="trust-grid">`,
    rest.map((r) =>
      `            <div class="rv">\n` +
      `              <blockquote>${esc(r.quote)}</blockquote>\n` +
      `              <p class="mono who">${esc(r.who)}</p>\n` +
      `            </div>`
    ).join("\n"),
    `          </div>`,
    scores ? `          <p class="mono trust-scores rv mono-num">${scores}</p>` : "",
  ].filter(Boolean).join("\n");
}

function renderMembership(d) {
  return d.items.map((p) => {
    const bullets = String(p.bullets || "").split("\n").map((b) => b.trim()).filter(Boolean)
      .map((b) => `            <li>${bold(b)}</li>`).join("\n");
    const inner = [
      `          <span class="mono tag">${esc(p.tag)}</span>`,
      `          <h3>${esc(p.title)}</h3>`,
      `          <p class="price">${esc(p.price)}${p.priceNote ? `<small> ${esc(p.priceNote)}</small>` : ""}</p>`,
      bullets ? `          <ul>\n${bullets}\n          </ul>` : "",
      p.cta && p.href
        ? `          <a class="btn${p.feature ? "" : " btn-ink"}"${p.feature ? " data-book" : ""} href="${esc(p.href)}" target="_blank" rel="noopener">${esc(p.cta)}</a>`
        : "",
    ].filter(Boolean).join("\n");

    return p.feature
      ? `      <div class="plan-glow rv">\n        <div class="plan feature">\n${inner}\n        </div>\n      </div>`
      : `      <div class="plan rv">\n${inner.replace(/^ {10}/gm, "        ")}\n      </div>`;
  }).join("\n");
}

function renderProtocol(d) {
  return d.groups.map((g) =>
    `      <div class="proto-col">\n` +
    `        <span class="mono" style="color:var(--rose-deep)">${esc(g.name)}</span>\n` +
    `        <ol>\n` +
    g.items.map((it) => `          <li>${esc(it.text)}</li>`).join("\n") +
    `\n        </ol>\n      </div>`
  ).join("\n");
}

function renderHours(d) {
  return d.items.map((r) =>
    `          <tr><td>${esc(r.days)}</td><td>${esc(r.time)}</td></tr>`
  ).join("\n");
}

function renderNumbers(d) {
  return d.items.map((n) => {
    const num = String(n.value).replace(/[^0-9.]/g, "");
    const prefix = /^\$/.test(n.value) ? ' data-prefix="$"' : "";
    const decimals = num.includes(".") ? ` data-decimals="${num.split(".")[1].length}"` : "";
    return `      <div class="num rv"><div class="n mono-num">` +
           `<span class="cnt" data-target="${esc(num)}"${decimals}${prefix}>${esc(n.value)}</span>` +
           (n.suffix ? `<sup>${esc(n.suffix)}</sup>` : "") +
           `</div><p class="mono l">${esc(n.label)}</p></div>`;
  }).join("\n");
}

/* ─────────────────────────────────────────────
   helpers
   ───────────────────────────────────────────── */

function json(statusCode, obj) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify(obj),
  };
}

const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// **text** is the only markup the client can use — everything else is escaped, so a
// stray angle bracket in a review can never become live HTML.
const bold = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>");
const emphasise = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<em class="shimmer">$1</em>');

// Exposed so scripts/rebuild-page.js can regenerate index.html from content/site.json
// using these exact renderers — one definition of the markup, not two.
exports.SECTIONS = SECTIONS;
exports.applySections = (page, content) => {
  for (const [name, spec] of Object.entries(SECTIONS)) {
    if (!content[name]) continue;
    const start = `<!-- cms:${spec.marker}:start -->`;
    const end = `<!-- cms:${spec.marker}:end -->`;
    if (!page.includes(start) || !page.includes(end)) throw new Error(`missing ${start} markers`);
    page = page.replace(
      new RegExp(`${escapeRe(start)}[\\s\\S]*?${escapeRe(end)}`),
      () => start + "\n" + spec.render(content[name]) + "\n      " + end
    );
  }
  return page;
};

// The editor builds its forms from this, so the two can't drift apart.
function publicSchema() {
  const out = {};
  for (const [name, s] of Object.entries(SECTIONS)) {
    out[name] = {
      // internal fields are machine-managed (e.g. the per-row Vagaro link) — the
      // editor never renders them, and they survive a save because the client
      // returns the whole stored object rather than only what it drew.
      label: s.label, kind: s.kind, fields: s.fields.filter((f) => !f.internal),
      groupLabel: s.groupLabel, groupFields: s.groupFields,
      extras: s.extras || [], maxItems: s.maxItems, maxGroups: s.maxGroups,
    };
  }
  return out;
}
