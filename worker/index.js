/**
 * BloxCode Radar API + hourly page refresh.
 * Deploy as a Cloudflare Worker with a D1 database binding named DB
 * and a secret named TAVILY_API_KEY. Set the Cron Trigger to 17 * * * *.
 */
const MAX_MONTHLY_SEARCH_CREDITS = 900; // leave a safety buffer under Tavily's 1,000-credit free tier
const MAX_NEW_SEARCHES_PER_IP_DAY = 5;
const MAX_AUTO_REFRESH_GAMES_PER_HOUR = 12;
const MAX_SOURCES_PER_GAME = 2;
const MAX_HTML_BYTES = 350_000;
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    try {
      if (url.pathname === "/api/status" && request.method === "GET") return json({ ok: true, service: "BloxCode Radar" });
      if (url.pathname === "/api/games" && request.method === "GET") {
        const { results } = await env.DB.prepare(
          "SELECT name, status, checked_at, sources_json, codes_json, error, search_count FROM games ORDER BY search_count DESC, name COLLATE NOCASE LIMIT 200"
        ).all();
        return json({ games: results.map(publicGame) });
      }
      if (url.pathname === "/api/search" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        return await searchGame(request, env, body.game);
      }
      return json({ error: "Not found" }, 404);
    } catch (error) {
      return json({ error: "Something went wrong while checking game sources." }, 500);
    }
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(refreshGames(env));
  },
};

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { ...CORS, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
function publicGame(row) {
  return {
    name: row.name,
    search_count: Number(row.search_count || 0),
    status: row.status,
    checked_at: row.checked_at,
    sources: safeJson(row.sources_json, []),
    codes: safeJson(row.codes_json, []),
    error: row.error || null,
  };
}
function safeJson(value, fallback) {
  try { return JSON.parse(value || ""); } catch { return fallback; }
}
function isoNow() { return new Date().toISOString(); }
function normalize(name) { return name.toLocaleLowerCase().trim().replace(/\s+/g, " "); }

async function searchGame(request, env, inputName) {
  const name = typeof inputName === "string" ? inputName.trim().replace(/\s+/g, " ") : "";
  if (name.length < 2 || name.length > 70) return json({ error: "Enter a game name from 2 to 70 characters." }, 400);
  const key = normalize(name);
  let existing = await env.DB.prepare(
    "SELECT name_key, name, status, checked_at, sources_json, codes_json, error, search_count FROM games WHERE name_key = ?"
  ).bind(key).first();
  let correctedFrom = null;
  if (!existing) {
    const { results: candidates } = await env.DB.prepare(
      "SELECT name_key, name, status, checked_at, sources_json, codes_json, error, search_count FROM games ORDER BY search_count DESC, name COLLATE NOCASE LIMIT 1000"
    ).all();
    existing = closestGame(name, candidates);
    if (existing) correctedFrom = name;
  }
  if (existing) {
    await env.DB.prepare("UPDATE games SET search_count = search_count + 1 WHERE name_key = ?").bind(existing.name_key).run();
    const updated = await env.DB.prepare(
      "SELECT name, status, checked_at, sources_json, codes_json, error, search_count FROM games WHERE name_key = ?"
    ).bind(existing.name_key).first();
    return json({ game: publicGame(updated), cached: true, correctedFrom });
  }
  if (!env.TAVILY_API_KEY) return json({ error: "Search is not connected yet. The site owner needs to add the private search key." }, 503);

  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const day = new Date().toISOString().slice(0, 10);
  const ipDayKey = await sha256(`${day}:${ip}`);
  const ipRow = await env.DB.prepare("SELECT count FROM ip_daily_searches WHERE ip_day_key = ?").bind(ipDayKey).first();
  if ((ipRow?.count || 0) >= MAX_NEW_SEARCHES_PER_IP_DAY) return json({ error: "This browser has reached today's new-game search limit. Try again tomorrow." }, 429);

  const month = new Date().toISOString().slice(0, 7);
  const monthRow = await env.DB.prepare("SELECT credits FROM quota_usage WHERE month_key = ?").bind(month).first();
  if ((monthRow?.credits || 0) >= MAX_MONTHLY_SEARCH_CREDITS) {
    return json({ error: "The free monthly web-search allowance is used up. It resets at the start of next month." }, 429);
  }

  await env.DB.prepare(
    "INSERT INTO ip_daily_searches (ip_day_key, count) VALUES (?, 1) ON CONFLICT(ip_day_key) DO UPDATE SET count = count + 1"
  ).bind(ipDayKey).run();
  // Reserve one basic-search credit before calling the provider. The free tier itself stops at its quota.
  await env.DB.prepare(
    "INSERT INTO quota_usage (month_key, credits) VALUES (?, 1) ON CONFLICT(month_key) DO UPDATE SET credits = credits + 1"
  ).bind(month).run();

  const discoveredAt = isoNow();
  let sources = [];
  let status = "no_sources_found";
  let errorText = null;
  try {
    const response = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.TAVILY_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        query: `Roblox ${name} game active redeem codes latest`,
        search_depth: "basic",
        max_results: MAX_SOURCES_PER_GAME,
        include_answer: false,
        include_raw_content: false,
        include_usage: true,
        topic: "general",
      }),
    });
    if (!response.ok) throw new Error(`Search provider returned ${response.status}`);
    const result = await response.json();
    const used = Number(result.usage?.credits || 1);
    if (used > 1) {
      await env.DB.prepare("UPDATE quota_usage SET credits = credits + ? WHERE month_key = ?").bind(used - 1, month).run();
    }
    sources = (result.results || []).slice(0, MAX_SOURCES_PER_GAME).map(item => ({
      title: String(item.title || "Code source").slice(0, 150),
      url: safeHttpsUrl(item.url),
      snippet: String(item.content || "").slice(0, 600),
      checked_at: discoveredAt,
    })).filter(source => source.url);
    const candidates = new Map();
    for (const source of sources) {
      for (const code of extractCandidates(source.snippet)) {
        const codeKey = code.toLowerCase();
        if (!candidates.has(codeKey)) candidates.set(codeKey, { code, source: source.url, status: "unverified" });
      }
    }
    status = candidates.size ? "codes_found_unverified" : (sources.length ? "sources_found" : "no_sources_found");
    var foundCodes = [...candidates.values()].slice(0, 50);
  } catch (error) {
    status = "search_error";
    errorText = String(error.message || "Search failed").slice(0, 180);
  }

  if (status === "search_error") {
    return json({ error: "Web search is temporarily unavailable. Please try again shortly." }, 502);
  }
  if (!sources.length) {
    return json({ error: "We couldn't find a matching Roblox game. Try searching again with the correct spelling." }, 404);
  }

  await env.DB.prepare(
    "INSERT INTO games (name_key, name, status, created_at, checked_at, searched_at, sources_json, codes_json, error, search_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)"
  ).bind(key, name, status, discoveredAt, discoveredAt, discoveredAt, JSON.stringify(sources), JSON.stringify(foundCodes || []), errorText).run();
  const row = await env.DB.prepare(
    "SELECT name, status, checked_at, sources_json, codes_json, error, search_count FROM games WHERE name_key = ?"
  ).bind(key).first();
  return json({ game: publicGame(row), cached: false });
}

function spellingKey(name) {
  return String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function editDistance(a, b) {
  const previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const above = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[b.length];
}

function closestGame(name, candidates) {
  const input = spellingKey(name);
  if (input.length < 4) return null;
  let best = null;
  let bestScore = 0;
  for (const candidate of candidates) {
    const title = spellingKey(candidate.name);
    if (!title) continue;
    const length = Math.max(input.length, title.length);
    const distance = editDistance(input, title);
    const score = 1 - distance / length;
    const allowedDistance = Math.max(1, Math.floor(length * 0.2));
    if (distance <= allowedDistance && score >= 0.8 &&
        (score > bestScore || (score === bestScore && Number(candidate.search_count || 0) > Number(best?.search_count || 0)))) {
      best = candidate;
      bestScore = score;
    }
  }
  return best;
}

async function refreshGames(env) {
  const { results } = await env.DB.prepare(
    "SELECT name_key, name, sources_json FROM games ORDER BY checked_at ASC LIMIT ?"
  ).bind(MAX_AUTO_REFRESH_GAMES_PER_HOUR).all();
  for (const game of results) {
    const sources = safeJson(game.sources_json, []).slice(0, MAX_SOURCES_PER_GAME);
    const found = new Map();
    let anyPageLoaded = false;
    for (const source of sources) {
      if (!source.url) continue;
      try {
        const response = await fetch(source.url, {
          headers: { "User-Agent": "BloxCodeRadar/1.0 (public Roblox code tracker)" },
          redirect: "manual",
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) continue;
        anyPageLoaded = true;
        const buffer = await response.arrayBuffer();
        const limited = buffer.slice(0, MAX_HTML_BYTES);
        const markup = new TextDecoder().decode(limited);
        const text = stripHtml(markup);
        for (const code of extractCandidates(text)) {
          const key = code.toLowerCase();
          if (!found.has(key)) found.set(key, { code, source: source.url, status: "unverified" });
        }
        source.checked_at = isoNow();
        source.fetch_status = "checked";
      } catch {
        source.checked_at = isoNow();
        source.fetch_status = "unavailable";
      }
    }
    const checkedAt = isoNow();
    const codes = [...found.values()].slice(0, 50);
    const status = codes.length ? "codes_found_unverified" : (anyPageLoaded ? "no_codes_found" : (sources.length ? "source_unavailable" : "no_sources_found"));
    await env.DB.prepare(
      "UPDATE games SET status = ?, checked_at = ?, sources_json = ?, codes_json = ?, error = NULL WHERE name_key = ?"
    ).bind(status, checkedAt, JSON.stringify(sources), JSON.stringify(codes), game.name_key).run();
  }
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !url.hostname || url.hostname === "localhost" || url.hostname.endsWith(".local")) return null;
    if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.|::1$)/.test(url.hostname)) return null;
    return url.href.slice(0, 1000);
  } catch { return null; }
}
function stripHtml(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--([\s\S]*?)-->/g, " ")
    .replace(/<\/(?:p|div|li|br|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;|&#34;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .slice(0, MAX_HTML_BYTES);
}
function extractCandidates(text) {
  // Only take short tokens near explicit code labels; results are always marked unverified.
  const output = [];
  const label = /\b(?:active\s+|working\s+|new\s+)?codes?\b\s*(?:are|include|:|=|-)?\s*/gi;
  const stop = new Set(["THE", "AND", "FOR", "WITH", "FROM", "THIS", "THAT", "NEW", "ACTIVE", "WORKING", "CODES", "CODE", "ROBLOX", "GAME", "FREE", "LATEST", "EXPIRED", "REWARDS", "UPDATE", "UPDATES", "REDEEM", "AVAILABLE"]);
  for (const match of text.matchAll(label)) {
    const tail = text.slice(match.index + match[0].length, match.index + match[0].length + 180);
    const tokens = tail.match(/\b[A-Z][A-Z0-9_-]{3,24}\b/g) || [];
    for (const token of tokens) {
      if (!stop.has(token) && !output.some(item => item.toLowerCase() === token.toLowerCase())) output.push(token);
      if (output.length >= 50) return output;
    }
  }
  return output;
}
async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}
