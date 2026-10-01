// DEBUG ONLY — remove this function (and its callers) before public release.
// Commits a recorded session log to the project repo via the GitHub connector.

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';

const REPO = 'alon3141592653589793/phonecluster2';
const BRANCH = 'main';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const content = String(body?.content || '');
    if (!content.trim()) return Response.json({ error: 'empty_content' }, { status: 400 });

    const filename = body?.filename ||
      `debug-sessions/session-${new Date().toISOString().replace(/[:.]/g, '-')}.log`;

    const { accessToken } = await base44.asServiceRole.connectors.getConnection('github');
    if (!accessToken) return Response.json({ error: 'github_not_connected' }, { status: 500 });

    const api = `https://api.github.com/repos/${REPO}/contents/${encodeURIComponent(filename)}`;
    const res = await fetch(api, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'phonecluster-debug-recorder',
      },
      body: JSON.stringify({
        branch: BRANCH,
        message: 'debug: session log (DEBUG ONLY — remove before public release)',
        content: btoa(unescape(encodeURIComponent(content))),
      }),
    });
    const raw = await res.text();
    let data = {};
    try { data = JSON.parse(raw); } catch (_) { data = { raw: raw.slice(0, 500) }; }
    if (!res.ok) return Response.json({ error: data.message || 'github_error', ghStatus: res.status, detail: data }, { status: 502 });

    return Response.json({
      ok: true,
      url: data.content?.html_url || null,
      commit: data.commit?.sha || null,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}