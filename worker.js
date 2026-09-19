// Brainy – hidden-key proxy for Cloudflare Workers (free plan)
// Your Gemini key lives ONLY here, as a secret called GEMINI_API_KEY.
// The website sends questions to this Worker, the Worker adds the key and asks Gemini.

const GEMINI = "https://generativelanguage.googleapis.com/v1beta/models/";
const MODELS = ["gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-2.0-flash"]; // models students may use
const MAX_BODY = 18 * 1024 * 1024; // 18 MB (uploads)
const PER_MINUTE = 20;             // requests per visitor per minute (best effort)
const hits = new Map();

export default {
  async fetch(request, env) {
    // ALLOWED_ORIGINS: comma-separated list of your site addresses, e.g. https://brainy.pages.dev
    // If you do not set it, any website may use your proxy.
    const origin = request.headers.get("Origin") || "";
    const allowed = (env.ALLOWED_ORIGINS || "*").split(",").map(s => s.trim().replace(/\/$/, "")).filter(Boolean);
    const any = allowed.includes("*");
    const originOk = any || allowed.includes(origin);
    const cors = {
      "Access-Control-Allow-Origin": any ? "*" : (originOk ? origin : "null"),
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin"
    };
    const fail = (status, message) =>
      new Response(JSON.stringify({ error: { message } }), { status, headers: { ...cors, "Content-Type": "application/json" } });

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST") return fail(405, "POST only.");
    if (!originOk) return fail(403, "This website is not allowed to use Brainy.");
    if (!env.GEMINI_API_KEY) return fail(500, "The server key is not set up yet.");

    // simple per-visitor limit
    const ip = request.headers.get("CF-Connecting-IP") || "unknown", now = Date.now();
    const recent = (hits.get(ip) || []).filter(t => now - t < 60000);
    if (recent.length >= PER_MINUTE) return fail(429, "Too many requests. Wait a minute.");
    recent.push(now); hits.set(ip, recent); if (hits.size > 5000) hits.clear();

    const model = new URL(request.url).searchParams.get("model") || MODELS[0];
    if (!MODELS.includes(model)) return fail(400, "That model is not allowed.");
    if ((+request.headers.get("Content-Length") || 0) > MAX_BODY) return fail(413, "That file is too large.");

    let upstream;
    try {
      upstream = await fetch(GEMINI + encodeURIComponent(model) + ":generateContent", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
        body: request.body
      });
    } catch (e) {
      return fail(502, "Could not reach the AI service.");
    }
    return new Response(upstream.body, { status: upstream.status, headers: { ...cors, "Content-Type": "application/json" } });
  }
};
