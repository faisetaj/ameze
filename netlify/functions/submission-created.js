// Runs automatically on every verified Netlify Forms submission.
// Opens a GitHub issue on the site repo labeled site-update + needs-triage. It deliberately
// does NOT mention @claude: the agent only runs once a human approves in the ops panel, so
// junk and ambiguous requests never cost tokens and a vague request can be sharpened first.
//
// Required env vars (Netlify site settings → Environment variables):
//   GH_TOKEN   – fine-grained PAT with Issues:write + Contents:write on the repo
//   REPO       – e.g. "faisetaj/ameze"
// Optional:
//   NETLIFY_TOKEN – personal access token; lets us copy uploaded images into the repo

const GH_API = "https://api.github.com";

exports.handler = async (event) => {
  const { payload } = JSON.parse(event.body);
  const d = payload.data || {};
  const repo = process.env.REPO;
  const ghToken = process.env.GH_TOKEN;
  if (!repo || !ghToken) {
    console.error("Missing REPO or GH_TOKEN env var");
    return { statusCode: 500, body: "Not configured" };
  }

  const gh = (path, opts = {}) =>
    fetch(`${GH_API}${path}`, {
      ...opts,
      headers: {
        Authorization: `Bearer ${ghToken}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        ...(opts.headers || {}),
      },
    });

  // If the client attached an image, try to copy it into the repo so the
  // agent can reference it. Netlify stores uploads behind an authed URL.
  let attachmentNote = "";
  const fileUrl = typeof d.attachment === "string" ? d.attachment : d.attachment?.url;
  if (fileUrl) {
    attachmentNote = `\n**Attachment (Netlify-hosted):** ${fileUrl}`;
    const nlToken = process.env.NETLIFY_TOKEN;
    if (nlToken) {
      try {
        const res = await fetch(fileUrl, { headers: { Authorization: `Bearer ${nlToken}` } });
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          if (buf.length <= 8 * 1024 * 1024) {
            const stamp = new Date().toISOString().slice(0, 10);
            const clean = (fileUrl.split("/").pop() || "upload").replace(/[^\w.\-]/g, "_");
            const path = `img/uploads/${stamp}-${clean}`;
            const put = await gh(`/repos/${repo}/contents/${path}`, {
              method: "PUT",
              body: JSON.stringify({
                message: `Add client-uploaded asset ${path}`,
                content: buf.toString("base64"),
              }),
            });
            if (put.ok) attachmentNote = `\n**Attachment committed to repo:** \`${path}\``;
          }
        }
      } catch (e) {
        console.error("Attachment copy failed:", e.message);
      }
    }
  }

  const title = `[site-update] ${d.category || "Change request"} — ${d.section || "general"}`;
  const body = [
    `## Website change request (via /updates form)`,
    ``,
    `| Field | Value |`,
    `| --- | --- |`,
    `| Site | ${d.site || "ameze"} |`,
    `| From | ${d.name || "?"} (${d.email || "no email"}) |`,
    `| Category | ${d.category || "?"} |`,
    `| Section | ${d.section || "?"} |`,
    `| Deadline | ${d.deadline || "not specified"} |`,
    ``,
    `### Requested change`,
    ``,
    d.details || "(empty)",
    attachmentNote,
    ``,
    `---`,
    ``,
    `⏸ **Awaiting triage.** The agent has not run. Approve this in the ops panel to dispatch it —`,
    `approving posts the final instruction as a comment that dispatches the agent.`,
  ].join("\n");

  const issue = await gh(`/repos/${repo}/issues`, {
    method: "POST",
    body: JSON.stringify({ title, body, labels: ["site-update", "needs-triage"] }),
  });

  if (!issue.ok) {
    console.error("Issue creation failed:", issue.status, await issue.text());
    return { statusCode: 502, body: "Issue creation failed" };
  }
  const created = await issue.json();
  console.log(`Opened issue #${created.number}: ${created.html_url}`);
  return { statusCode: 200, body: `Issue #${created.number} created` };
};
