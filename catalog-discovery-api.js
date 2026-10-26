import { createServer } from "node:http";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const PORT = Number(process.env.PORT || 10000);
const MAX_PAGES = 50;
const MAX_BYTES = 2_000_000;
const TIMEOUT_MS = 7000;
const scans = new Map();

function privateIp(ip) {
  if (isIP(ip) === 4) {
    const p = ip.split(".").map(Number);
    return p[0] === 0 || p[0] === 10 || p[0] === 127 || p[0] >= 224 ||
      (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
      (p[0] === 192 && p[1] === 168) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127);
  }
  const value = ip.toLowerCase();
  return value === "::" || value === "::1" || value.startsWith("fc") || value.startsWith("fd") ||
    value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea") || value.startsWith("feb") ||
    value.startsWith("::ffff:127.") || value.startsWith("::ffff:10.") || value.startsWith("::ffff:192.168.");
}

async function assertPublicHost(url) {
  if (!["http:", "https:"].includes(url.protocol) || !url.hostname) throw new Error("Solo se admiten URLs HTTP/HTTPS públicas.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || isIP(host) && privateIp(host)) {
    throw new Error("No se permiten direcciones locales o privadas.");
  }
  if (!isIP(host)) {
    const answers = await lookup(host, { all: true, verbatim: true });
    if (!answers.length || answers.some((answer) => privateIp(answer.address))) throw new Error("El dominio no resuelve exclusivamente a direcciones públicas.");
  }
}

function decode(value) {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function pageTitle(html, url) {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return decode(title || url.hostname);
}

function robotsAllows(robots, pathname) {
  let active = false;
  const rules = [];
  for (const raw of robots.split(/\r?\n/)) {
    const line = raw.split("#")[0].trim();
    const colon = line.indexOf(":");
    if (colon < 0) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();
    if (key === "user-agent") active = value === "*" || value.toLowerCase() === "iptv-doctor-discovery";
    else if (active && key === "disallow" && value) rules.push(value);
  }
  return !rules.some((rule) => pathname.startsWith(rule));
}

async function safeFetch(url, robotsText) {
  await assertPublicHost(url);
  if (!robotsAllows(robotsText, url.pathname || "/")) throw new Error("La página está excluida por robots.txt.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: "manual",
      signal: controller.signal,
      headers: { "User-Agent": "IPTV-Doctor-PublicCatalogBot/1.0 (+public metadata discovery)", Accept: "text/html,application/xhtml+xml,application/ld+json;q=0.9,*/*;q=0.1" }
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Redirección sin destino.");
      const target = new URL(location, url);
      if (target.hostname !== url.hostname) throw new Error("Se detuvo una redirección a otro dominio por seguridad.");
      await assertPublicHost(target);
      const next = await fetch(target, { redirect: "error", signal: controller.signal, headers: { "User-Agent": "IPTV-Doctor-PublicCatalogBot/1.0", Accept: "text/html,application/xhtml+xml" } });
      if (!next.ok) throw new Error("HTTP " + next.status);
      return { response: next, finalUrl: target };
    }
    if (!response.ok) throw new Error("HTTP " + response.status);
    return { response, finalUrl: url };
  } finally {
    clearTimeout(timer);
  }
}

async function readLimitedText(response, maxBytes) {
  if (!response.body) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) throw new Error("El catálogo supera el límite de 2 MB.");
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: false });
  let total = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error("El catálogo supera el límite de 2 MB.");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    try { reader.releaseLock(); } catch {}
  }
}

function extractSitemapUrls(xml, baseUrl) {
  const urls = [];
  const re = /<loc>\s*([\s\S]*?)\s*<[/]loc>/gi;
  let match;
  while ((match = re.exec(xml)) !== null && urls.length < 500) {
    const raw = decode(match[1]).trim();
    try {
      const url = new URL(raw, baseUrl);
      if (url.hostname === baseUrl.hostname && ["http:", "https:"].includes(url.protocol)) {
        url.hash = "";
        urls.push(url);
      }
    } catch {}
  }
  return urls;
}

function extractScriptUrls(html, pageUrl) {
  const urls = [];
  const seen = new Set();
  const patterns = [
    /["']((?:https?:)?[/][/][^"'\s<>]+|[/](?:video|genre|now-on-air|timetable|program|channel|sports|anime|news|drama|movie|event)[^"'\s<>]*)["']/gi,
    /(?:href|url|canonical|permalink)\s*[:=]\s*["']([^"'<>]{3,500})["']/gi
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) !== null && urls.length < 500) {
      try {
        const raw = match[1].replace(/\\u002F/g, "/").replace(/\\\//g, "/").replace(/\\u0026/g, "&");
        const url = new URL(raw.startsWith("//") ? pageUrl.protocol + raw : raw, pageUrl);
        if (url.hostname !== pageUrl.hostname || !["http:", "https:"].includes(url.protocol)) continue;
        url.hash = "";
        if (!seen.has(url.href)) { seen.add(url.href); urls.push(url); }
      } catch {}
    }
  }
  return urls;
}

function extractPage(html, pageUrl) {
  const items = [];
  const seen = new Set();
  const add = (item) => {
    if (!item.title || !item.url || seen.has(item.url)) return;
    seen.add(item.url);
    items.push(item);
  };
  const jsonLd = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi) || [];
  function walk(value) {
    if (Array.isArray(value)) return value.forEach(walk);
    if (!value || typeof value !== "object") return;
    const typeRaw = value["@type"];
    const type = (Array.isArray(typeRaw) ? typeRaw.join(" ") : String(typeRaw || "")).toLowerCase();
    const rawUrl = typeof value.url === "string" ? value.url : typeof value["@id"] === "string" ? value["@id"] : "";
    if (rawUrl && typeof value.name === "string" && /(event|broadcast|tvseries|episode|movie|videoobject|creativework|tvchannel)/.test(type)) {
      try {
        const itemUrl = new URL(rawUrl, pageUrl);
        if (itemUrl.hostname === pageUrl.hostname) add({
          title: value.name, url: itemUrl.href,
          kind: type.includes("event") ? "evento" : /video|episode|movie/.test(type) ? "vídeo/programa" : "programa",
          description: typeof value.description === "string" ? value.description.slice(0, 500) : undefined,
          date: typeof value.startDate === "string" ? value.startDate : typeof value.datePublished === "string" ? value.datePublished : undefined,
          source: pageUrl.href
        });
      } catch {}
    }
    Object.values(value).forEach(walk);
  }
  for (const script of jsonLd) {
    const raw = script.replace(/^<script[^>]*>/i, "").replace(/<\/script>$/i, "");
    try { walk(JSON.parse(raw)); } catch {}
  }
  const links = [];
  const anchorRe = /<a\b([^>]*?)href\s*=\s*(["'])(.*?)\2([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchorRe.exec(html)) !== null) {
    const title = decode(match[5]).slice(0, 180);
    if (title.length < 3) continue;
    try {
      const link = new URL(match[3].replace(/&amp;/g, "&"), pageUrl);
      if (link.hostname !== pageUrl.hostname || !["http:", "https:"].includes(link.protocol)) continue;
      link.hash = "";
      const path = link.pathname.toLowerCase();
      if (/\.(css|js|png|jpe?g|gif|svg|webp|woff2?|ico|pdf|zip)$/i.test(path)) continue;
      const kind = /slot|event|schedule|timetable|calendar|match/.test(path + " " + title.toLowerCase()) ? "evento"
        : /video|title|episode|program|show|movie|series|watch|channel|genre|category/.test(path + " " + title.toLowerCase()) ? "programa/categoría" : "enlace";
      add({ title, url: link.href, kind, source: pageUrl.href });
      if (link.pathname !== pageUrl.pathname && !link.search && !link.hash) links.push(link);
    } catch {}
  }
  return { items, links };
}

const server = createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (req.method === "OPTIONS") { res.writeHead(204); return res.end(); }
  const ip = req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const history = (scans.get(ip) || []).filter((time) => now - time < 300000);
  if (history.length >= 8) { res.writeHead(429); return res.end(JSON.stringify({ error: "Límite temporal alcanzado. Prueba dentro de unos minutos." })); }
  if (req.method !== "GET") { res.writeHead(405); return res.end(JSON.stringify({ error: "Método no permitido." })); }
  const requestUrl = new URL(req.url || "/", "http://localhost");
  if (requestUrl.pathname === "/health") { res.writeHead(200); return res.end(JSON.stringify({ ok: true, service: "iptv-doctor-public-discovery" })); }
  if (requestUrl.pathname !== "/api/discover" && requestUrl.pathname !== "/api/catalog") { res.writeHead(404); return res.end(JSON.stringify({ error: "Ruta no encontrada." })); }
  let start;
  try { start = new URL(requestUrl.searchParams.get("url") || ""); await assertPublicHost(start); }
  catch (error) { res.writeHead(400); return res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) })); }
  history.push(now); scans.set(ip, history);
  try {
    const robotsUrl = new URL("/robots.txt", start);
    let robots = "";
    try {
      await assertPublicHost(robotsUrl);
      const robotsResponse = await fetch(robotsUrl, { signal: AbortSignal.timeout(3000), headers: { "User-Agent": "IPTV-Doctor-PublicCatalogBot/1.0" } });
      if (robotsResponse.ok) robots = (await robotsResponse.text()).slice(0, 100000);
    } catch {}
    if (requestUrl.pathname === "/api/catalog") {
      if (!robotsAllows(robots, start.pathname || "/")) {
        res.writeHead(403);
        return res.end(JSON.stringify({ error: "La URL del catálogo está excluida por robots.txt." }));
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      try {
        const response = await fetch(start, {
          redirect: "manual",
          signal: controller.signal,
          headers: { "User-Agent": "IPTV-Doctor-PublicCatalogBot/1.0 (+public catalog reader)", Accept: "application/json,text/csv,audio/x-mpegurl,application/x-mpegURL,text/plain,application/octet-stream,*/*" }
        });
        if (response.status >= 300 && response.status < 400) {
          const location = response.headers.get("location");
          if (!location) throw new Error("Redirección del catálogo sin destino.");
          const target = new URL(location, start);
          if (target.hostname !== start.hostname) throw new Error("Redirección a otro dominio bloqueada por seguridad; usa la URL final del catálogo.");
          await assertPublicHost(target);
          if (!robotsAllows(robots, target.pathname || "/")) throw new Error("El destino está excluido por robots.txt.");
          const redirected = await fetch(target, { redirect: "error", signal: controller.signal, headers: { "User-Agent": "IPTV-Doctor-PublicCatalogBot/1.0", Accept: "application/json,text/csv,audio/x-mpegurl,text/plain,*/*" } });
          if (!redirected.ok) throw new Error("HTTP " + redirected.status);
          const body = await readLimitedText(redirected, MAX_BYTES);
          res.writeHead(200);
          return res.end(JSON.stringify({ content: body, contentType: redirected.headers.get("content-type") || "", filename: target.pathname.split("/").pop() || "catalog.txt" }));
        }
        if (!response.ok) throw new Error("HTTP " + response.status);
        const body = await readLimitedText(response, MAX_BYTES);
        res.writeHead(200);
        return res.end(JSON.stringify({ content: body, contentType: response.headers.get("content-type") || "", filename: start.pathname.split("/").pop() || "catalog.txt" }));
      } catch (error) {
        res.writeHead(502);
        return res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
      } finally {
        clearTimeout(timer);
      }
    }
    const queue = [start];
    // ABEMA is a JavaScript-heavy SPA, so seed known public category pages instead of relying on homepage anchors.
    if (start.hostname === "abema.tv" || start.hostname.endsWith(".abema.tv")) {
      const publicPaths = [
        "/now-on-air", "/timetable", "/video/genre/sports", "/video/genre/anime",
        "/video/genre/news", "/video/genre/drama", "/video/genre/variety",
        "/video/genre/movie", "/video/genre/documentary", "/video/genre/music",
        "/video/genre/romance", "/video/genre/kyoyo", "/video/genre/mahjong",
        "/video/genre/entertainment", "/video/genre/asia", "/video/genre/fighting",
        "/video/genre/hiphop", "/video/genre/keiba", "/video/genre/voice-actor"
      ];
      for (const path of publicPaths) {
        const categoryUrl = new URL(path, start);
        if (robotsAllows(robots, categoryUrl.pathname)) queue.push(categoryUrl);
      }
    }
    // Use public sitemaps as discovery hints; only same-host URLs are queued.
    for (const sitemapPath of ["/sitemap.xml", "/sitemap_index.xml", "/sitemap-index.xml"]) {
      try {
        const sitemapUrl = new URL(sitemapPath, start);
        await assertPublicHost(sitemapUrl);
        const sitemapResponse = await fetch(sitemapUrl, { redirect: "error", signal: AbortSignal.timeout(4000), headers: { "User-Agent": "IPTV-Doctor-PublicCatalogBot/1.0", Accept: "application/xml,text/xml,*/*" } });
        if (sitemapResponse.ok) {
          const sitemapText = (await sitemapResponse.text()).slice(0, MAX_BYTES);
          for (const sitemapEntry of extractSitemapUrls(sitemapText, start)) {
            if (sitemapEntry.pathname.toLowerCase().endsWith(".xml")) {
              try {
                const nestedResponse = await fetch(sitemapEntry, { redirect: "error", signal: AbortSignal.timeout(4000), headers: { "User-Agent": "IPTV-Doctor-PublicCatalogBot/1.0", Accept: "application/xml,text/xml,*/*" } });
                if (nestedResponse.ok) {
                  const nestedText = (await nestedResponse.text()).slice(0, MAX_BYTES);
                  for (const nestedUrl of extractSitemapUrls(nestedText, start)) {
                    if (robotsAllows(robots, nestedUrl.pathname) && queue.length < 500) queue.push(nestedUrl);
                  }
                }
              } catch {}
            } else if (robotsAllows(robots, sitemapEntry.pathname) && queue.length < 500) queue.push(sitemapEntry);
          }
          break;
        }
      } catch {}
    }
    const visited = new Set();
    const items = new Map();
    const pages = [];
    while (queue.length && visited.size < MAX_PAGES) {
      const current = queue.shift();
      current.hash = "";
      if (visited.has(current.href) || current.hostname !== start.hostname) continue;
      visited.add(current.href);
      try {
        const { response, finalUrl } = await safeFetch(current, robots);
        const contentType = response.headers.get("content-type") || "";
        if (!/html|xhtml|json/i.test(contentType)) continue;
        const reader = response.body?.getReader();
        if (!reader) continue;
        let total = 0; const chunks = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          if (total > MAX_BYTES) { await reader.cancel(); break; }
          chunks.push(Buffer.from(value));
        }
        const html = Buffer.concat(chunks).toString("utf8");
        const page = extractPage(html, finalUrl);
        pages.push({ url: finalUrl.href, title: pageTitle(html, finalUrl) });
        for (const item of page.items) items.set(item.url, item);
        const discoveredLinks = [...page.links, ...extractScriptUrls(html, finalUrl)];
        for (const link of discoveredLinks) {
          if (queue.length + visited.size >= 500) break;
          if (!visited.has(link.href) && !queue.some((queued) => queued.href === link.href) && link.hostname === start.hostname && robotsAllows(robots, link.pathname)) queue.push(link);
        }
      } catch (error) {
        if (visited.size === 1) pages.push({ url: current.href, error: error instanceof Error ? error.message : String(error) });
      }
    }
    const result = {
      requestedUrl: start.href,
      scannedAt: new Date().toISOString(),
      pagesScanned: pages.length,
      limitedToPublicPages: true,
      note: "Hasta 50 páginas HTML públicas por búsqueda, con sitemaps y enlaces internos permitidos por robots.txt. No se accede a APIs privadas, sesiones, contenido de pago ni DRM.",
      pages,
      items: [...items.values()]
    };
    res.writeHead(200);
    res.end(JSON.stringify(result));
  } catch (error) {
    res.writeHead(502);
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  }
});

server.listen(PORT, "0.0.0.0", () => console.log("IPTV Doctor public discovery listening on " + PORT));
