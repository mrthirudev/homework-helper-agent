/**
 * worker.js
 * ---------
 * A tiny backend proxy that runs on Cloudflare Workers.
 *
 * Why this exists: GitHub Pages can only serve static files (HTML/JS/CSS).
 * It cannot hold a secret API key safely. This Worker is the piece that
 * *can* hold the key securely (as a Cloudflare "secret") and talks to
 * an LLM provider on behalf of the static webpage.
 *
 * Supports TWO interchangeable providers, switchable via the PROVIDER
 * environment variable (set in wrangler.toml or the Cloudflare dashboard):
 *   PROVIDER = "gemini"  (default — free tier, no credit card needed)
 *   PROVIDER = "openai"  (once you have OpenAI billing set up)
 *
 * Flow:
 *   Browser (index.html) --POST messages--> This Worker --> Gemini or OpenAI
 *                         <--reply text------              <--
 */

const SYSTEM_PROMPT = `You are "Buddy", a friendly homework helper for students in
Grade 1 through Grade 5 (roughly ages 6-11).

Your job is to help a young student understand their homework — not just
give them the final answer. Follow these rules on every reply:

1. SIMPLE LANGUAGE: Use short sentences and everyday words a 5th grader
   (age ~10-11) or younger can follow. Avoid jargon; if you must use a
   technical word, explain it in one simple phrase.

2. STEP BY STEP: Break every explanation into small, numbered steps.
   Never jump straight to the final answer. Walk through the reasoning
   the way a patient teacher would at a chalkboard.

3. CHECK FOR UNDERSTANDING: After explaining, ask a small follow-up
   question or give a very similar practice problem so the student can
   try it themselves. Encourage them, e.g. "Want to try one on your own?"

4. ENCOURAGING TONE: Be warm, patient, and positive. Celebrate effort,
   normalize mistakes, and never sound impatient or condescending.

5. SUBJECTS IN SCOPE: Math (arithmetic, fractions, basic geometry, word
   problems), English/Reading (grammar, vocabulary, spelling, reading
   comprehension, simple writing), Science (basic life/earth/physical
   science topics), and general elementary-appropriate homework.

6. STAY AGE-APPROPRIATE AND SAFE: Keep all examples appropriate for young
   children. If asked something unrelated to homework or inappropriate
   for a child this age, gently steer back to homework help.

7. DON'T JUST HAND OVER ANSWERS: Guide the student through the steps to
   find an answer themselves rather than stating it outright.

8. FORMAT: Use short paragraphs and numbered/bulleted steps. Avoid walls
   of text.`;

const OPENAI_MODEL = "gpt-4o-mini";
const GEMINI_MODEL = "gemini-2.5-flash";

export default {
  async fetch(request, env) {
    // ALLOWED_ORIGIN should be set to your GitHub Pages URL, e.g.
    // "https://yourusername.github.io" — see DEPLOY.md.
    const allowedOrigin = env.ALLOWED_ORIGIN || "*";

    const corsHeaders = {
      "Access-Control-Allow-Origin": allowedOrigin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    // Browsers send a pre-flight OPTIONS request before the real POST.
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const messages = Array.isArray(body.messages) ? body.messages : [];

    if (messages.length === 0) {
      return new Response(JSON.stringify({ error: "No messages provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Basic guardrail: cap how much history gets forwarded, to control cost.
    const trimmedMessages = messages.slice(-20);

    // PROVIDER defaults to "gemini" (free tier, no credit card).
    // Set PROVIDER = "openai" in wrangler.toml (or Cloudflare dashboard)
    // once you have OpenAI billing set up.
    const provider = (env.PROVIDER || "gemini").toLowerCase();

    try {
      let reply;
      if (provider === "openai") {
        reply = await callOpenAI(trimmedMessages, env.OPENAI_API_KEY);
      } else {
        reply = await callGemini(trimmedMessages, env.GEMINI_API_KEY);
      }

      return new Response(JSON.stringify({ reply }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message || "Unexpected error" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
  },
};

async function callOpenAI(messages, apiKey) {
  if (!apiKey) throw new Error("OPENAI_API_KEY secret is not set on this Worker");

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      max_tokens: 1000,
      messages: [{ role: "system", content: SYSTEM_PROMPT }, ...messages],
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "OpenAI request failed");
  return data.choices?.[0]?.message?.content ?? "Sorry, I didn't get a response.";
}

async function callGemini(messages, apiKey) {
  if (!apiKey) throw new Error("GEMINI_API_KEY secret is not set on this Worker");

  // Gemini uses "model" instead of "assistant" for the AI's turns, and
  // expects each turn's text wrapped in a "parts" array.
  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents,
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        generationConfig: { maxOutputTokens: 1000 },
      }),
    }
  );

  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Gemini request failed");
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "Sorry, I didn't get a response.";
}
