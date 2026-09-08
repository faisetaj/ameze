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

## The treatment menu — Vagaro owns it (since 2026-09)

The menu (categories, services, prices, descriptions, booking links) is a **mirror of her
live Vagaro catalogue**. The daily `vagaro-sync.yml` Action scrapes her booking widget and
publishes `content/site.json` + the `cms:menu` region of `index.html` through `content-api`.
She edits services **in Vagaro only** — never open a PR that hand-edits menu rows, prices
or service descriptions; the next sync would overwrite it. If an issue asks for a menu
change, reply pointing her to Vagaro (or, for how the menu is *presented*, to the
change-request form). Sync configuration lives in `content/vagaro.json`
(`categoryWidgets` maps Vagaro categories to scoped booking widgets; `hide` suppresses
bookkeeping rows like the no-show fee).

## Specials cards — Vagaro owns these too (since 2026-09-08)

The "This month at Ameze" flyer cards (`content/specials.json`) mirror her Vagaro
**"Monthly Promotions and Discounts"** category, art included: the daily
`vagaro-sync.yml` Action reads the title, the promo-aware price, the first sentence
of the description and the service photo she uploaded in Vagaro, then publishes
through `specials-api`. She maintains nothing here — adding, retiring or repricing
a promotion in Vagaro is the whole workflow, and the card count follows (the grid
auto-fits 1–4; `promoCards.max` in `content/vagaro.json` caps it).

They are not editable from `/admin`. **Never hand-edit `content/specials.json` or the
card markup** — the next sync overwrites it. The `<!-- specials:start -->` /
`<!-- specials:end -->` markers must stay in `index.html`.

If a promotion looks wrong on the site, the fix is in Vagaro, not here. If the *cards*
themselves need to behave differently, that is a change to `scripts/vagaro-sync.js`
and goes through Faisel.

## Photos — she edits these herself too

The treatment-menu photo rotator, the "Inside the studio" strip, and the reviews-corner
photo are CMS-managed from **`/admin`** (the three "Photos — …" sections), same contract
as specials: `content/site.json` plus the `cms:photos-menu` / `cms:photos-studio` /
`cms:photos-trust` markers in `index.html`. **Never remove those markers.** If an issue
asks for a photo swap in those spots, reply pointing her to /admin rather than opening a
PR, unless she's explicitly asked you to do it for her. Her uploads land in `img/uploads/`.
The rotator images map to menu categories by order (`data-for="p-c0…"`); captions follow
the active tab's label automatically, and when there are more categories than photos the
rotator holds the previous image, so category churn from the Vagaro sync is safe.

## What you may edit

- Content inside `index.html` **outside the `cms:menu` region**: hours, membership copy,
  protocol lists, review quotes (only if the issue provides new ones). Never hand-edit
  menu rows, service names/descriptions or prices — Vagaro owns those (see above).
- `about.html` and `reviews.html` (same design tokens and voice rules).
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
