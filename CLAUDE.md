# Ameze Skin Elements — site update agent rules

This repo is a static single-page site (index.html + img/) deployed to Netlify from `main`.
Change requests arrive as GitHub issues labeled `site-update`, filed from the /updates form.

## Workflow (always)

1. Work on a branch named `claude/<short-description>`. NEVER commit or push to `main`.
2. Open a pull request that includes `Closes #<issue number>` and a plain-English summary
   of exactly what changed, written for a non-technical reviewer.
3. Netlify builds a preview for every PR. The human reviewer approves and merges — you don't.
4. If a request is ambiguous, contradictory, or out of scope, do NOT guess. Comment on the
   issue asking a specific clarifying question, and stop.

## Weekly specials — the client edits these herself

The "This month at Ameze" section is CMS-managed. The client publishes it from **`/admin`**,
which commits `content/specials.json` and regenerates the static fallback cards in
`index.html` in one commit. **Prefer to let her do it** — if an issue asks for a specials
change, reply on the issue pointing her to `/admin` rather than opening a PR, unless she's
explicitly asked you to do it for her.

If you do edit specials by hand:

- Edit `content/specials.json` (title, price, note, img, alt, href, optional `hidden: true`).
- Mirror the change into the static fallback cards between the
  `<!-- specials:start -->` / `<!-- specials:end -->` markers in `index.html` (`#offers-grid`)
  so no-JS visitors see the same specials. **Never remove those marker comments** — `/admin`
  needs them to find the block, and publishing breaks without them.
- Client-uploaded flyer images land in `img/uploads/` — reference them there, or copy to
  `img/` with a sensible name.

## What you may edit

- `content/specials.json` (see above).
- Content inside `index.html`: prices, service names/descriptions, hours,
  membership copy, protocol lists, review quotes (only if the issue provides new ones).
- Blog-style announcements: if asked for a "blog post", add it as a new section or a new
  HTML page matching the site's design tokens, and link it from the footer nav.

## What you must NEVER change without an explicit, unambiguous instruction

- Booking links (vagaro.com/amezeskinelements), phone numbers, addresses.
- Legal/trademark text in the footer colophon.
- The overall design system: fonts, color tokens, animations, layout structure.
  Brenda chose **Porcelain** (2026-08-05) — it is set on `<html data-theme="porcelain">`
  and the old A/B/C theme picker is gone. The Blush and Noir token blocks are kept
  only so a future switch is a one-attribute change; don't revert to them.
  Headings are **Jost** (`--display`), body **Inter** (`--sans`) — she found the old
  Fraunces serif "newspaper"-ish. Prices stay mono.
- Anything in `netlify/`, `.github/`, `netlify.toml`, `dashboard.html`, `updates.html`,
  `admin.html`, or this file. If an issue asks for that, comment that it needs the
  developer (Faisel).
- The credential line. She is a **medical esthetician and cosmetic injector** — not an RN,
  not a nurse, not a physician. Never upgrade or invent a credential.

## File encoding — read this before any bulk edit

`index.html` is UTF-8 and full of ®, ™, — and · characters. Edit it with a normal
text edit, never with a shell command that reads and rewrites the whole file
(PowerShell `Get-Content`/`Set-Content` in particular defaults to the system
codepage on read and UTF-8 on write, which silently double-encodes every one of
those characters into `Â®`, `â€"` and friends across the entire page).

If it does happen, the damage is reversible: decode the file as UTF-8, re-encode
those characters as cp1252, and write the bytes back.

## Style rules for content edits

- Prices are real business data. Copy them exactly as given in the issue — never invent,
  round, or "improve" a price. If a price seems wrong (e.g. $0), ask on the issue.
- Match the surrounding writing voice: confident, warm, no exclamation-mark spam, no
  "revolutionary/cutting-edge" filler.
- Keep the design tokens: mono for prices/labels (`--mono`), `--display` for headings.
- Preserve the reveal/animation classes (`rv`, `prow`, etc.) when editing rows.

## Verify before opening the PR

- The edited HTML is valid (no unclosed tags — check your diff).
- Any image you referenced actually exists at that path in the repo.
- Prices in the diff exactly match the issue text.
