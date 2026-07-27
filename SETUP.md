# Website Care pipeline — one-time setup

The repo now contains a self-serve change-request system:

```
Client fills /updates form
  → Netlify Function opens a GitHub issue (@claude, label: site-update)
    → GitHub Action runs Claude Code → PR on a claude/* branch
      → Netlify builds a deploy preview for the PR
        → You approve on /dashboard → squash-merge → Netlify deploys main
```

## 1. GitHub side (~5 minutes)

1. **Install the Claude GitHub App** on `faisetaj/ameze`:
   https://github.com/apps/claude → Install → select this repo.
2. **Add the API key secret**: repo → Settings → Secrets and variables → Actions →
   New repository secret → name `ANTHROPIC_API_KEY`, value = a key from
   https://console.anthropic.com (this bills unattended runs; a few dollars/month at
   this volume).
3. **Create a fine-grained personal access token** for the Netlify functions:
   GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token
   - Repository access: only `faisetaj/ameze`
   - Permissions: **Contents: Read & write**, **Issues: Read & write**,
     **Pull requests: Read & write**
   - Copy the token — it goes into Netlify below.

## 2. Netlify side (~5 minutes)

Site settings → **Environment variables** → add:

| Name | Value |
| --- | --- |
| `GH_TOKEN` | the fine-grained PAT from step 1.3 |
| `REPO` | `faisetaj/ameze` |
| `ADMIN_KEY` | a passphrase you invent — this is your /dashboard login |
| `CMS_KEY` | a **different** passphrase — this is the client's /admin login. Give her this one, never `ADMIN_KEY` (if you skip it, /admin falls back to `ADMIN_KEY`) |
| `SITE_NAME` | your Netlify site name, e.g. `ameze` if the site is `ameze.netlify.app` |
| `NETLIFY_TOKEN` | *(optional)* a Netlify personal access token (User settings → Applications) — lets client image uploads get committed straight into the repo |

Then **redeploy once** (Deploys → Trigger deploy) so the functions pick up the env vars.
Netlify auto-detects the form on `updates.html` during that deploy.

Also check: Site configuration → **Deploy previews** is set to "Any pull request"
(default) — that's what powers the 👁 Preview button on the dashboard.

## 3. The promotions editor (/admin)

The "This month at Ameze" cards are a small hybrid CMS: the site stays static HTML, but
those four cards render from `content/specials.json`, and the client edits them herself at
`https://<site>.netlify.app/admin` — no GitHub, no PR, no waiting on you.

```
She opens /admin  →  edits a price / drops in a new flyer / reorders
  →  Publish  →  one commit to main (JSON + the no-JS fallback cards + the image)
    →  Netlify deploys  →  live in ~60 seconds
```

What it does for her:

- **Edit** name, price and small print in place; drag or tap to swap the flyer image.
- **Reorder** with ↑ ↓, remove with ×, or tick *Hide this one for now* to park a special
  without losing it (hidden ones drop out of the live grid but stay in the JSON).
- **Preview** renders the real cards at real proportions before anything is committed.
- **Earlier versions → Restore** puts any previous published set back — the undo button.

Notes for you:

- Uploads are downscaled to 1400px JPEG in the browser, so a phone photo lands as ~200 KB
  and the page stays fast. They're committed to `img/uploads/<special-name>.jpg`.
- Publishing writes `content/specials.json` **and** rewrites the static fallback cards
  between the `<!-- specials:start -->` / `<!-- specials:end -->` markers in `index.html`,
  in a single commit — so JS and no-JS visitors never drift apart. Don't delete those
  markers.
- Prices are copied verbatim, never reformatted. The API rejects empty names/prices,
  non-https booking links, images outside `img/`, and more than 8 cards.
- Bookmark `/admin` on her phone — the editor is built for it.

## 4. Daily workflow

- Specials and promotions: she does those herself at `/admin` (section 3) — they never
  reach you.
- Everything else: she submits at `https://<site>.netlify.app/updates` (bookmark it for
  her; it's unlinked from the main site).
- You get a GitHub notification when the PR opens (or just check the dashboard).
- Open `https://<site>.netlify.app/dashboard`, enter your admin key once:
  - **👁 Preview** — the change on a live preview URL
  - **✓ Approve & publish** — squash-merges; Netlify deploys in ~1 minute
  - **✕ Reject** — closes the PR and posts your note; @claude revises on the same issue
- Agent guardrails live in `CLAUDE.md` (edit to taste per client).

## Costs at this volume

- Netlify free tier: 100 form submissions/mo, 125k function calls/mo — plenty.
- GitHub Actions free tier: 2,000 min/mo — a request uses a few minutes.
- Anthropic API: roughly $0.05–$0.50 per change request depending on complexity.

## Scaling to more clients

Everything here is repo-local boilerplate: copy `updates.html`, `dashboard.html`,
`admin.html`, `netlify/`, `.github/workflows/claude.yml`, `netlify.toml`, and `CLAUDE.md`
into each new client repo, set the same six env vars on that site, install the GitHub App
on the repo, done. Each client gets their own portal on their own domain; all requests land
in your GitHub notifications.

To point the promotions editor at a different section on another site, the only
site-specific pieces in `netlify/functions/specials-api.js` are the `JSON_PATH` /
`PAGE_PATH` constants and the `fallbackCards()` markup — everything else is generic.
