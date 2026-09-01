// Runs automatically on every verified Netlify Forms submission.
// - site-update form: opens a GitHub issue labeled site-update + needs-triage. It
//   deliberately does NOT mention @claude: the agent only runs once a human approves in
//   the ops panel, so junk and ambiguous requests never cost tokens and a vague request
//   can be sharpened first.
// - newsletter form: sends the subscriber a welcome email via Resend, when configured.
//   (Netlify's own form notification separately tells the studio someone signed up.)
//
// Required env vars (Netlify site settings → Environment variables):
//   GH_TOKEN   – fine-grained PAT with Issues:write + Contents:write on the repo
//   REPO       – e.g. "faisetaj/ameze"
// Optional:
//   NETLIFY_TOKEN – personal access token; lets us copy uploaded images into the repo
//   RESEND_API_KEY      – api key from resend.com; without it, no welcome email is sent
//   NEWSLETTER_FROM     – verified sender, e.g. "Ameze Skin Elements <specials@amezeskinelements.com>"
//   NEWSLETTER_REPLY_TO – where replies (and unsubscribes) land, e.g. amezeskinelements@yahoo.com

const GH_API = "https://api.github.com";
const BOOK_URL = "https://www.vagaro.com/amezeskinelements";

// The welcome email a subscriber gets right after joining from the pop-up.
async function sendWelcome(email) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.NEWSLETTER_FROM;
  if (!key || !from) {
    console.log("Welcome email skipped — RESEND_API_KEY / NEWSLETTER_FROM not configured");
    return { statusCode: 200, body: "Stored; welcome email not configured" };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || ""))) {
    console.log("Welcome email skipped — no valid subscriber address");
    return { statusCode: 200, body: "Stored; no valid address" };
  }

  const text = [
    "You're on the list.",
    "",
    "Thanks for joining Ameze Skin Elements — you'll hear from us when there's",
    "something worth sending: monthly specials, new treatments and member pricing.",
    "No spam, ever.",
    "",
    `Book any time: ${BOOK_URL}`,
    "Ameze Skin Elements · 919 West Gray St, Houston TX · (832) 775-6965",
    "",
    "Didn't sign up, or changed your mind? Just reply to this email with",
    "\"unsubscribe\" and we'll take you off the list.",
  ].join("\n");

  const html = `
  <div style="font-family:-apple-system,'Segoe UI',Helvetica,Arial,sans-serif;max-width:34rem;margin:0 auto;padding:24px;color:#1A1315">
    <p style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#9E4F5D;margin:0 0 14px">Ameze Skin Elements</p>
    <h1 style="font-weight:500;font-size:26px;margin:0 0 14px">You're on the list.</h1>
    <p style="line-height:1.6;color:#4a3d40;margin:0 0 14px">
      Thanks for joining — you'll hear from us when there's something worth sending:
      monthly specials, new treatments and member pricing. No spam, ever.</p>
    <p style="margin:22px 0">
      <a href="${BOOK_URL}" style="background:#C4707E;color:#fff;text-decoration:none;padding:11px 22px;border-radius:2px">Book an appointment</a></p>
    <p style="font-size:13px;color:#77595E;line-height:1.6;margin:26px 0 0">
      Ameze Skin Elements · 919 West Gray St, Houston TX · (832) 775-6965<br>
      Didn't sign up, or changed your mind? Just reply with “unsubscribe” and we'll take you off the list.</p>
  </div>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [email],
      reply_to: process.env.NEWSLETTER_REPLY_TO || undefined,
      subject: "You're on the list — Ameze Skin Elements",
      text,
      html,
    }),
  });
  if (!res.ok) {
    console.error("Welcome email failed:", res.status, await res.text());
    return { statusCode: 200, body: "Stored; welcome email failed (see logs)" };
  }
  console.log(`Welcome email sent to ${email}`);
  return { statusCode: 200, body: "Stored; welcome email sent" };
}

exports.handler = async (event) => {
  const { payload } = JSON.parse(event.body);

  // This event fires for EVERY form on the site. Newsletter signups get a welcome
  // email; only the /updates change-request form opens an issue.
  if (payload.form_name === "newsletter") {
    return sendWelcome((payload.data || {}).email);
  }
  if (payload.form_name && payload.form_name !== "site-update") {
    console.log(`Ignoring submission from form "${payload.form_name}"`);
    return { statusCode: 200, body: "Not a change-request form; nothing to do" };
  }

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
