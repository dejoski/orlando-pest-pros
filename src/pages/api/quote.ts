import type { APIRoute } from "astro";
import { validateLead, storeLead } from "../../lib/leads";
import { trackAcceptedLead } from "./track.js";
export const prerender = false;
const MAX_BYTES = 8192;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
});

export const POST: APIRoute = async ({ request }) => {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return json({ ok: false, error: "Invalid request origin." }, 403);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return json({ ok: false, error: "Please send JSON." }, 415);
  if (Number(request.headers.get("content-length")) > MAX_BYTES) return json({ ok: false, error: "Request too large." }, 413);
  let input: unknown;
  // Bound bytes while streaming, including requests without Content-Length.
  const reader = request.body?.getReader();
  if (!reader) return json({ ok: false, error: "Invalid request." }, 400);
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); return json({ ok: false, error: "Request too large." }, 413); }
      chunks.push(value);
    }
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
    input = JSON.parse(new TextDecoder().decode(body));
  } catch { return json({ ok: false, error: "Invalid request." }, 400); }
  const { lead, error } = validateLead(input);
  if (!lead) {
    if (error === "spam") return json({ ok: false, error: "Request could not be accepted." }, 400);
    return json({ ok: false, error }, 400);
  }
  try { await storeLead(lead); }
  catch {
    console.error("[quote-lead] durable storage unavailable");
    return json({ ok: false, error: "Couldn't save your request. Please try again shortly." }, 503);
  }
  // Analytics must never turn a saved lead into a failed submission.
  try { await trackAcceptedLead(lead); } catch { console.error("[quote-lead] analytics unavailable"); }
  return json({ ok: true });
};
