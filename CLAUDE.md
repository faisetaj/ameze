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

## What you may edit

- Content inside `index.html`: prices, service names/descriptions, specials, hours,
  membership copy, protocol lists, review quotes (only if the issue provides new ones).
- The "This month at Ameze" offers section, including swapping in images the client
  uploaded (they land in `img/uploads/`). Copy them to `img/` with a sensible name if used.
- Blog-style announcements: if asked for a "blog post", add it as a new section or a new
  HTML page matching the site's design tokens, and link it from the footer nav.

## What you must NEVER change without an explicit, unambiguous instruction

- Booking links (vagaro.com/amezeskinelements), phone numbers, addresses.
- Legal/trademark text in the footer colophon.
- The overall design system: fonts, color tokens, animations, layout structure.
- Anything in `netlify/`, `.github/`, `netlify.toml`, `dashboard.html`, `updates.html`,
  or this file. If an issue asks for that, comment that it needs the developer (Faisel).

## Style rules for content edits

- Prices are real business data. Copy them exactly as given in the issue — never invent,
  round, or "improve" a price. If a price seems wrong (e.g. $0), ask on the issue.
- Match the surrounding writing voice: confident, warm, no exclamation-mark spam, no
  "revolutionary/cutting-edge" filler.
- Keep the design tokens: mono for prices/labels (`--mono`), serif for headings.
- Preserve the reveal/animation classes (`rv`, `prow`, etc.) when editing rows.

## Verify before opening the PR

- The edited HTML is valid (no unclosed tags — check your diff).
- Any image you referenced actually exists at that path in the repo.
- Prices in the diff exactly match the issue text.
