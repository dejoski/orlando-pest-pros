// Lead-only counters: no public browser collector or pageview function.
const TTL_SECONDS = 35 * 24 * 60 * 60;


function kvConfig() {
  const url =
    process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
  const token =
    process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
  if (!url || !token) return null;
  return { base: url.replace(/\/+$/, ''), token };
}

// One HTTP round-trip for N Redis commands. Returns the Upstash result array
// ([{result: ...}, ...]) or null when KV isn't configured.
// NOTE: each command in a pipeline still counts toward the free-tier quota.
async function pipeline(commands) {
  const cfg = kvConfig();
  if (!cfg) return null;
  const res = await fetch(cfg.base + '/pipeline', {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + cfg.token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(commands),
    signal: AbortSignal.timeout(5000)
  });
  if (!res.ok) throw new Error('kv pipeline failed: ' + res.status);
  const results = await res.json();
  if (!Array.isArray(results) || results.length !== commands.length || results.some(r => !r || r.error)) throw new Error('kv command failed');
  return results;
}

// Allowlist-style cleanup of the reported page path.
function cleanPage(p) {
  var s = String(p || '/').split(/[?#]/)[0].slice(0, 120).toLowerCase();
  s = s.replace(/[^a-z0-9/_-]/g, '').replace(/\/+$/, '');
  return s || '/';
}

// Called only by the quote route after durable lead acceptance. Analytics
// failure must never change the outcome of an already persisted lead.
export async function trackAcceptedLead(lead) {
  try {
    if (!kvConfig()) return;
    const day = 'opp:day:' + new Date().toISOString().slice(0, 10);
    const channel = ['organic', 'paid', 'referral', 'direct'].includes(lead.attribution?.channel) ? lead.attribution.channel : 'unknown';
    await pipeline([
      ['HINCRBY', day, cleanPage(lead.source) + '|form_success', 1],
      ['HINCRBY', day, '@' + channel + '|form_success', 1],
      ['EXPIRE', day, TTL_SECONDS]
    ]);
  } catch (err) {
    console.error('[analytics/accepted-lead] Counter unavailable');
  }
}
