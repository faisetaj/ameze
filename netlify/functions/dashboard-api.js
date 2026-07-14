// API for the private approvals dashboard (/dashboard).
// Auth: caller must send x-admin-key matching the ADMIN_KEY env var.
//
// GET  ?op=list                     -> open site-update issues + open claude/* PRs
// POST {op:"merge",  number:N}      -> squash-merge PR N
// POST {op:"close",  number:N, kind:"pr"|"issue", note?} -> close with optional comment
//
// Env vars: GH_TOKEN, REPO (e.g. "faisetaj/ameze"), ADMIN_KEY, SITE_NAME (netlify subdomain)

const GH_API = "https://api.github.com";

exports.handler = async (event) => {
  if ((event.headers["x-admin-key"] || "") !== process.env.ADMIN_KEY || !process.env.ADMIN_KEY) {
    return { statusCode: 401, body: JSON.stringify({ error: "unauthorized" }) };
  }
  const repo = process.env.REPO;
  const gh = (path, opts = {}) =>
    fetch(`${GH_API}${path}`, {
      ...opts,
      headers: {
        Authorization: `Bearer ${process.env.GH_TOKEN}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
      },
    });
  const json = (code, obj) => ({
    statusCode: code,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(obj),
  });

  try {
    if (event.httpMethod === "GET") {
      const [issuesRes, prsRes] = await Promise.all([
        gh(`/repos/${repo}/issues?labels=site-update&state=open&per_page=50`),
        gh(`/repos/${repo}/pulls?state=open&per_page=50`),
      ]);
      const issuesRaw = await issuesRes.json();
      const prsRaw = await prsRes.json();
      const site = process.env.SITE_NAME || "";

      const prs = prsRaw
        .filter((p) => p.head.ref.startsWith("claude/"))
        .map((p) => ({
          number: p.number,
          title: p.title,
          body: p.body || "",
          branch: p.head.ref,
          url: p.html_url,
          diff_url: `${p.html_url}/files`,
          preview: site ? `https://deploy-preview-${p.number}--${site}.netlify.app` : null,
          created_at: p.created_at,
        }));

      const issues = issuesRaw
        .filter((i) => !i.pull_request)
        .map((i) => ({
          number: i.number,
          title: i.title,
          body: i.body || "",
          url: i.html_url,
          created_at: i.created_at,
        }));

      return json(200, { issues, prs });
    }

    if (event.httpMethod === "POST") {
      const { op, number, kind, note } = JSON.parse(event.body || "{}");

      if (op === "merge") {
        const r = await gh(`/repos/${repo}/pulls/${number}/merge`, {
          method: "PUT",
          body: JSON.stringify({ merge_method: "squash" }),
        });
        const data = await r.json();
        return json(r.ok ? 200 : 502, data);
      }

      if (op === "close") {
        if (note) {
          await gh(`/repos/${repo}/issues/${number}/comments`, {
            method: "POST",
            body: JSON.stringify({ body: note }),
          });
        }
        const path = kind === "pr" ? `/repos/${repo}/pulls/${number}` : `/repos/${repo}/issues/${number}`;
        const r = await gh(path, { method: "PATCH", body: JSON.stringify({ state: "closed" }) });
        return json(r.ok ? 200 : 502, await r.json());
      }

      return json(400, { error: "unknown op" });
    }

    return json(405, { error: "method not allowed" });
  } catch (e) {
    console.error(e);
    return json(500, { error: e.message });
  }
};
