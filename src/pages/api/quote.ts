import type { APIRoute } from "astro";
import { validateLead, storeLead } from "../../lib/leads";

export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

export const POST: APIRoute = async ({ request }) => {
  let input: Record<string, unknown> = {};
  try {
    input = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid request." }, 400);
  }

  const { lead, error } = validateLead(input);
  if (!lead) {
    // Honeypot trips return a fake success so bots can't probe validation.
    if (error === "spam") return json({ ok: true });
    return json({ ok: false, error }, 400);
  }

  try {
    await storeLead(lead);
  } catch (e) {
    console.error("[quote-lead] store failed", e);
    return json({ ok: false, error: "Couldn't save your request. Please call us instead." }, 500);
  }

  return json({ ok: true });
};
