// CMS API for the "This month at Ameze" promotions (/admin).
//
// Everything happens in ONE commit to the live branch, so Netlify runs one
// deploy per publish: the JSON the page renders from, the no-JS fallback cards
// inside index.html, and any newly uploaded flyer images all land together.
//
// Auth: caller sends x-cms-key matching the CMS_KEY env var. If CMS_KEY is not
// set it falls back to ADMIN_KEY, so the CMS works before you add a second key —
// but give the client her own CMS_KEY so her login can't merge or close PRs.
//
// GET  ?op=load                    -> { specials, history }
// POST {op:"save", specials:[...]} -> publish (returns { sha, published })
// POST {op:"restore", sha}         -> republish the specials from an older commit
//
// Env vars: GH_TOKEN, REPO (e.g. "faisetaj/ameze"), CMS_KEY (or ADMIN_KEY),
//           BRANCH (optional, defaults to "main")

const GH_API = "https://api.github.com";
const JSON_PATH = "content/specials.json";
const PAGE_PATH = "index.html";
const START = "<!-- specials:start -->";
const END = "<!-- specials:end -->";
const MAX_SPECIALS = 8;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const OK_EXT = ["jpg", "jpeg", "png", "webp"];

exports.handler = async (event) => {
  // Unauthenticated config probe: answers "is this variable set?" and nothing else.
  // Booleans only — never a value — so a misconfigured site can be diagnosed without
  // anyone having to share a key or a token.
  const set = (v) => !!(process.env[v] || "").trim();
  if (event.httpMethod === "GET" && (event.queryStringParameters || {}).op === "health") {
    return json(200, {
      CMS_KEY: set("CMS_KEY"),
      ADMIN_KEY: set("ADMIN_KEY"),
      REPO: set("REPO"),
      GH_TOKEN: set("GH_TOKEN"),
      branch: process.env.BRANCH || "main",
    });
  }

  // Distinguish "no key configured on the site" from "wrong key typed" — otherwise a
  // missing or mis-scoped env var looks identical to a typo, which is impossible to debug.
  // Name the variable actually in play (never its value). Falling back to ADMIN_KEY
  // silently is what makes a mis-scoped CMS_KEY look like a typo.
  const keySource = process.env.CMS_KEY ? "CMS_KEY" : process.env.ADMIN_KEY ? "ADMIN_KEY" : null;
  const expected = (process.env.CMS_KEY || process.env.ADMIN_KEY || "").trim();
  if (!expected) {
    return json(503, {
      error: "This site has no CMS_KEY set. Add it in Netlify → Site configuration → " +
             "Environment variables (scope: Functions, or All), then redeploy.",
    });
  }
  if ((event.headers["x-cms-key"] || "").trim() !== expected) {
    return json(401, { error: "unauthorized", expecting: keySource });
  }

  const repo = process.env.REPO;
  const token = process.env.GH_TOKEN;
  const branch = process.env.BRANCH || "main";
  const missing = ["REPO", "GH_TOKEN"].filter((v) => !process.env[v]);
  if (missing.length) {
    return json(500, {
      error:
        `This site is missing ${missing.join(" and ")} in its Netlify environment variables. ` +
        `REPO is the GitHub repo as "owner/name"; GH_TOKEN is the fine-grained token with ` +
        `Contents: Read & write on it. Add ${missing.length > 1 ? "them" : "it"} under Site ` +
        `configuration → Environment variables with Scopes including Functions, then redeploy.`,
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
    if (!r.ok) {
      const detail = data.message || r.statusText;
      throw new Error(`GitHub ${r.status} on ${path}: ${detail}`);
    }
    return data;
  };

  /* ── read a file at a given ref ── */
  const readFile = async (path, ref) => {
    const data = await ghJson(`/repos/${repo}/contents/${path}?ref=${ref || branch}`);
    return Buffer.from(data.content, "base64").toString("utf8");
  };

  /* ── commit several files at once (git data API, one commit = one deploy) ── */
  const commitFiles = async (files, message) => {
    const ref = await ghJson(`/repos/${repo}/git/ref/heads/${branch}`);
    const parent = ref.object.sha;
    const baseCommit = await ghJson(`/repos/${repo}/git/commits/${parent}`);

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
      body: JSON.stringify({ base_tree: baseCommit.tree.sha, tree }),
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

  /* ── build the commit for a set of specials and push it ── */
  const publish = async (incoming, message) => {
    const { specials, images } = normalise(incoming);
    const page = await readFile(PAGE_PATH);
    if (!page.includes(START) || !page.includes(END)) {
      throw new Error(`index.html is missing the ${START} / ${END} markers`);
    }
    const patched = page.replace(
      new RegExp(`${escapeRe(START)}[\\s\\S]*?${escapeRe(END)}`),
      START + "\n" + fallbackCards(specials) + "\n      " + END
    );

    const files = [
      { path: JSON_PATH, base64: b64(JSON.stringify(specials, null, 2) + "\n") },
      { path: PAGE_PATH, base64: b64(patched) },
      ...images,
    ];
    const sha = await commitFiles(files, message);
    return { sha, specials, published: specials.length, images: images.length };
  };

  try {
    if (event.httpMethod === "GET") {
      const [raw, commits] = await Promise.all([
        readFile(JSON_PATH).catch(() => "[]"),
        ghJson(`/repos/${repo}/commits?path=${JSON_PATH}&sha=${branch}&per_page=8`).catch(() => []),
      ]);
      return json(200, {
        specials: JSON.parse(raw),
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
        const result = await publish(body.specials, "Update this-month specials (via /admin)");
        return json(200, result);
      }

      if (body.op === "restore") {
        if (!/^[0-9a-f]{7,40}$/i.test(body.sha || "")) return json(400, { error: "bad sha" });
        const old = JSON.parse(await readFile(JSON_PATH, body.sha));
        const result = await publish(old, `Restore specials from ${body.sha.slice(0, 7)} (via /admin)`);
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
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function trim(s, max) {
  return String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, max);
}

function slug(s) {
  return trim(s, 60).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "special";
}

// Validate what the browser sent, and pull any newly uploaded images out into
// their own tree entries. Prices are business data — they're copied verbatim,
// never reformatted.
function normalise(list) {
  if (!Array.isArray(list) || !list.length) throw new Error("Add at least one special before publishing.");
  if (list.length > MAX_SPECIALS) throw new Error(`That's more than ${MAX_SPECIALS} specials — the grid only fits ${MAX_SPECIALS}.`);

  const images = [];
  const seen = new Set();

  const specials = list.map((s, i) => {
    const title = trim(s.title, 80);
    const price = trim(s.price, 24);
    if (!title) throw new Error(`Special ${i + 1} needs a name.`);
    if (!price) throw new Error(`"${title}" needs a price.`);

    let img = trim(s.img, 200);
    if (s.upload && s.upload.data) {
      const ext = String(s.upload.name || "").split(".").pop().toLowerCase();
      if (!OK_EXT.includes(ext)) throw new Error(`"${title}": image must be a ${OK_EXT.join(", ")} file.`);
      const bytes = Buffer.from(s.upload.data, "base64");
      if (!bytes.length) throw new Error(`"${title}": that image came through empty — try again.`);
      if (bytes.length > MAX_IMAGE_BYTES) throw new Error(`"${title}": image is over 4 MB, even after resizing.`);

      let path = `img/uploads/${slug(title)}.${ext}`;
      let n = 2;
      while (seen.has(path)) path = `img/uploads/${slug(title)}-${n++}.${ext}`;
      seen.add(path);

      images.push({ path, base64: s.upload.data });
      img = path;
    }
    if (!img) throw new Error(`"${title}" needs an image.`);
    if (!/^(img\/|https:\/\/)/.test(img)) throw new Error(`"${title}": image path looks wrong.`);

    const href = trim(s.href, 300) || "https://www.vagaro.com/amezeskinelements/services";
    if (!/^https:\/\//.test(href)) throw new Error(`"${title}": the booking link must start with https://`);

    const out = {
      title,
      price,
      note: trim(s.note, 140),
      img,
      alt: trim(s.alt, 160) || `${title} special flyer`,
      href,
    };
    if (s.hidden) out.hidden = true;
    return out;
  });

  if (!specials.some((s) => !s.hidden)) throw new Error("At least one special has to stay visible.");
  return { specials, images };
}

// The static cards inside index.html, for visitors without JavaScript and for
// search engines. Markup mirrors the client-side renderer exactly.
function fallbackCards(specials) {
  return specials
    .filter((s) => !s.hidden)
    .map((s) =>
      [
        `      <a class="offer rv" data-book href="${esc(s.href)}" target="_blank" rel="noopener">`,
        `        <span class="imgw"><img src="${esc(s.img)}" alt="${esc(s.alt)}"></span>`,
        `        <span class="c"><b>${esc(s.title)}</b><span>${esc(s.price)}</span></span>`,
        `        <span class="mono">${esc(s.note)}</span>`,
        `      </a>`,
      ].join("\n")
    )
    .join("\n");
}
