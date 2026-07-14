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
| `SITE_NAME` | your Netlify site name, e.g. `ameze` if the site is `ameze.netlify.app` |
| `NETLIFY_TOKEN` | *(optional)* a Netlify personal access token (User settings → Applications) — lets client image uploads get committed straight into the repo |

Then **redeploy once** (Deploys → Trigger deploy) so the functions pick up the env vars.
Netlify auto-detects the form on `updates.html` during that deploy.

Also check: Site configuration → **Deploy previews** is set to "Any pull request"
(default) — that's what powers the 👁 Preview button on the dashboard.

## 3. Daily workflow

- Client submits at `https://<site>.netlify.app/updates` (bookmark it for her; it's
  unlinked from the main site).
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
`netlify/`, `.github/workflows/claude.yml`, `netlify.toml`, and `CLAUDE.md` into each
new client repo, set the same five env vars on that site, install the GitHub App on the
repo, done. Each client gets their own portal on their own domain; all requests land in
your GitHub notifications.
