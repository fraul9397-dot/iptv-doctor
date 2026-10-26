import { useEffect, useMemo, useRef, useState } from "react";
import { parseM3U } from "iptv-doctor-core";

type CatalogChannel = { name: string; url: string; country?: string; category?: string };
type SavedCatalog = { id: string; name: string; savedAt: string; channels: CatalogChannel[] };
type WebSource = { name: string; country?: string; category?: string; status?: string; latencyMs?: number; url: string };
type OfficialPortal = { name: string; country: string; category: string; url: string; note: string };
type DiscoveredItem = { title: string; url: string; kind: string; description?: string; date?: string; source?: string };
const OFFICIAL_SPORTS_PORTALS: OfficialPortal[] = [
  { name: "Movistar Plus+ · Fútbol", country: "ES", category: "Fútbol de pago", url: "https://www.movistarplus.es/deportes/futbol", note: "Partidos y competiciones según suscripción y derechos vigentes." },
  { name: "Movistar Plus+ · Deportes", country: "ES", category: "Deportes", url: "https://www.movistarplus.es/deportes", note: "Programación deportiva oficial y próximos eventos." },
  { name: "Movistar Plus+ · Partidos de hoy", country: "ES", category: "Agenda deportiva", url: "https://www.movistarplus.es/deportes/futbol", note: "Consulta la programación oficial; la disponibilidad depende del plan." },
  { name: "DAZN España", country: "ES", category: "Fútbol y deportes", url: "https://www.dazn.com/es-ES/home", note: "Directos y eventos según plan y derechos en España." },
  { name: "Orange TV", country: "ES", category: "Televisión y fútbol", url: "https://www.orange.es/tv", note: "Paquetes de televisión sujetos a contratación." },
  { name: "RTVE Play", country: "ES", category: "En abierto", url: "https://www.rtve.es/play/", note: "Canales y eventos disponibles en abierto, con restricciones según contenido." },
  { name: "Teledeporte · RTVE Play", country: "ES", category: "Deporte en abierto", url: "https://www.rtve.es/play/deportes/", note: "Directos y eventos deportivos que RTVE tenga autorizados." },
  { name: "3Cat · TV3", country: "ES / Catalunya", category: "Televisión pública", url: "https://www.3cat.cat/", note: "Canales y contenidos oficiales en catalán." },
  { name: "Esport3 · 3Cat", country: "ES / Catalunya", category: "Deporte catalán", url: "https://www.3cat.cat/esport3/", note: "Programación y retransmisiones deportivas disponibles en 3Cat." },
  { name: "Atresplayer · Directos", country: "ES", category: "Canales en directo", url: "https://www.atresplayer.com/directos/", note: "Canales del grupo Atresmedia; algunas funciones requieren cuenta." },
  { name: "Mediaset Infinity", country: "ES", category: "Canales y programas", url: "https://www.mediasetinfinity.es/", note: "Canales y contenidos oficiales; disponibilidad según título." },
  { name: "LALIGA · Web oficial", country: "ES", category: "Calendario y vídeo", url: "https://www.laliga.com/", note: "Calendario, resultados y vídeos oficiales; no implica que todos los partidos sean gratuitos." },
  { name: "UEFA.tv", country: "GLOBAL", category: "Fútbol oficial", url: "https://www.uefa.tv/", note: "Resúmenes y eventos seleccionados según territorio y derechos." },
  { name: "Barça One", country: "ES / Catalunya", category: "Canal de club", url: "https://barcaone.fcbarcelona.com/", note: "Contenido oficial del FC Barcelona; directos sujetos a programación." },
  { name: "Real Madrid TV", country: "ES", category: "Canal de club", url: "https://www.realmadrid.com/en-US/real-madrid-tv", note: "Canal y contenido oficial del club." },
  { name: "FIFA+", country: "GLOBAL", category: "Fútbol oficial", url: "https://www.plus.fifa.com/", note: "Partidos archivados, resúmenes y algunos directos según región." },
  { name: "RTVE Deportes", country: "ES", category: "Noticias y eventos", url: "https://www.rtve.es/deportes/", note: "Noticias, calendario y enlaces oficiales a eventos." },
];
const ABEMA_CATEGORIES: DiscoveredItem[] = [
  { title: "En directo / canales", url: "https://abema.tv/now-on-air", kind: "categoría", description: "Canales lineales y emisiones disponibles en ABEMA" },
  { title: "Deportes", url: "https://abema.tv/video/genre/sports", kind: "categoría", description: "Deportes, partidos y programas deportivos" },
  { title: "Anime", url: "https://abema.tv/video/genre/anime", kind: "categoría", description: "Catálogo de anime" },
  { title: "Noticias", url: "https://abema.tv/video/genre/news", kind: "categoría", description: "Noticias y actualidad" },
  { title: "Drama", url: "https://abema.tv/video/genre/drama", kind: "categoría", description: "Series y dramas" },
  { title: "Variedades", url: "https://abema.tv/video/genre/variety", kind: "categoría", description: "Entretenimiento y variedades" },
  { title: "Películas", url: "https://abema.tv/video/genre/movie", kind: "categoría", description: "Películas y cine" },
  { title: "Documentales", url: "https://abema.tv/video/genre/documentary", kind: "categoría", description: "Documentales" },
  { title: "Programación", url: "https://abema.tv/timetable", kind: "categoría", description: "Consulta la parrilla oficial" }
];

function discoverPageItems(html: string, pageUrl: string): DiscoveredItem[] {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const found: DiscoveredItem[] = [];
  const seen = new Set<string>();
  const add = (item: DiscoveredItem) => {
    if (!item.title || !item.url || seen.has(item.url)) return;
    seen.add(item.url);
    found.push(item);
  };
  const walk = (value: unknown) => {
    if (Array.isArray(value)) { value.forEach(walk); return; }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    const rawType = record["@type"];
    const type = (Array.isArray(rawType) ? rawType.join(" ") : String(rawType ?? "")).toLowerCase();
    const rawUrl = typeof record.url === "string" ? record.url : typeof record["@id"] === "string" ? record["@id"] : "";
    if (rawUrl && typeof record.name === "string" && /(event|broadcast|tvseries|episode|movie|videoobject|creativework)/.test(type)) {
      try {
        add({ title: record.name, url: new URL(rawUrl, pageUrl).toString(), kind: type.includes("event") ? "evento" : /video|episode/.test(type) ? "vídeo" : "programa", description: typeof record.description === "string" ? record.description : undefined, date: typeof record.startDate === "string" ? record.startDate : undefined });
      } catch { /* Ignore invalid metadata URLs. */ }
    }
    Object.values(record).forEach(walk);
  };
  for (const script of Array.from(doc.querySelectorAll('script[type="application/ld+json"]'))) {
    try { walk(JSON.parse(script.textContent || "")); } catch { /* Ignore malformed JSON-LD. */ }
  }
  for (const anchor of Array.from(doc.querySelectorAll("a[href]"))) {
    const title = (anchor.textContent || anchor.getAttribute("aria-label") || anchor.getAttribute("title") || "").replace(/\s+/g, " ").trim();
    if (title.length < 3 || title.length > 160) continue;
    try {
      const url = new URL(anchor.getAttribute("href") || "", pageUrl);
      if (!/^https?:$/.test(url.protocol) || url.hostname !== new URL(pageUrl).hostname) continue;
      const path = url.pathname.toLowerCase();
      const kind: DiscoveredItem["kind"] = /slot|event|schedule|timetable/.test(path) ? "evento" : /video|title|episode|program/.test(path) ? "programa" : "categoría";
      add({ title, url: url.toString(), kind });
    } catch { /* Ignore invalid links. */ }
  }
  return found;
}

type DashPlayer = {
  initialize: (element: HTMLMediaElement, source: string, autoplay?: boolean) => void;
  on: (event: string, callback: (event: { error?: { message?: string; code?: number } }) => void) => void;
  reset: () => void;
};
declare global {
  interface Window { dashjs?: { MediaPlayer: () => { create: () => DashPlayer }; }; }
}

type HlsConstructor = new (config?: Record<string, unknown>) => {
  loadSource: (url: string) => void;
  attachMedia: (media: HTMLMediaElement) => void;
  destroy: () => void;
  on: (event: string, callback: (_event: unknown, data: { fatal?: boolean; type?: string; details?: string }) => void) => void;
  recoverMediaError: () => void;
  startLoad: () => void;
  levels?: Array<{ height?: number; bitrate?: number }>;
  currentLevel?: number;
};
declare global {
  interface Window { Hls?: HlsConstructor & { isSupported: () => boolean; Events: { ERROR: string } }; }
}

function csvCells(line: string): string[] {
  const result: string[] = [];
  let value = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && quoted && line[i + 1] === '"') { value += '"'; i++; }
    else if (ch === '"') quoted = !quoted;
    else if (ch === "," && !quoted) { result.push(value.trim()); value = ""; }
    else value += ch;
  }
  result.push(value.trim());
  return result;
}

function mediaKind(value: string): "hls" | "dash" | "file" | undefined {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined;
    const path = parsed.pathname.toLowerCase();
    if (/\.m3u8$/i.test(path) || /\.m3u8\//i.test(path)) return "hls";
    if (/\.mpd$/i.test(path) || /\.mpd\//i.test(path)) return "dash";
    if (/\.(mp4|m4v|webm|ogv|ogg|mp3|m4a|aac|wav)$/i.test(path)) return "file";
    return undefined;
  } catch { return undefined; }
}

function isPlayableMedia(value: string): boolean {
  return mediaKind(value) !== undefined;
}

function extractMediaUrls(value: string): string[] {
  const pattern = /https?:\/\/[^\s"'<>\\]+/gi;
  return (value.match(pattern) ?? []).map((url) => url.replace(/[),.;\]}]+$/, "")).filter(isPlayableMedia);
}

function fromJson(data: unknown): CatalogChannel[] {
  const found: CatalogChannel[] = [];
  const seen = new Set<object>();
  const urlPattern = /https?:\/\/[^\s"'<>\\]+/gi;
  function walk(value: unknown, context: { name?: string; country?: string; category?: string } = {}): void {
    if (typeof value === "string") {
      if (!/url|stream|source|manifest|hls|m3u8|link/i.test(context.name ?? "")) {
        for (const match of value.match(urlPattern) ?? []) {
          const url = match.replace(/[),.;\]}]+$/, "");
          if (isPlayableMedia(url)) found.push({ name: context.name || "Canal", url, country: context.country, category: context.category });
        }
      }
      return;
    }
    if (!value || typeof value !== "object" || seen.has(value as object)) return;
    seen.add(value as object);
    if (Array.isArray(value)) { value.forEach((item) => walk(item, context)); return; }
    const record = value as Record<string, unknown>;
    const next = {
      name: typeof record.name === "string" ? record.name : typeof record.channel === "string" ? record.channel : context.name,
      country: typeof record.country === "string" ? record.country : context.country,
      category: typeof record.category === "string" ? record.category : context.category
    };
    for (const [key, child] of Object.entries(record)) {
      if (typeof child === "string" && /url|stream|source|manifest|hls|m3u8|link/i.test(key)) {
        for (const match of child.match(urlPattern) ?? []) {
          const url = match.replace(/[),.;\]}]+$/, "");
          if (isPlayableMedia(url)) found.push({ name: next.name || "Canal", url, country: next.country, category: next.category });
        }
      } else if (child && typeof child === "object") walk(child, next);
    }
  }
  walk(data);
  return found;
}

function parseWebSources(text: string, filename: string): WebSource[] {
  const ext = filename.toLowerCase().split(".").pop();
  const safeUrl = (value: unknown): string | undefined => {
    if (typeof value !== "string" || !value.trim()) return undefined;
    const candidate = /^https?:\/\//i.test(value) ? value : "https://" + value;
    try {
      const parsed = new URL(candidate);
      return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : undefined;
    } catch { return undefined; }
  };
  try {
    if (ext === "csv") {
      const rows = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
      if (rows.length < 2) return [];
      const headers = csvCells(rows[0]).map((item) => item.toLowerCase());
      const hostIndex = headers.findIndex((h) => /^(urlhost|host|domain|website|site)$/i.test(h));
      const nameIndex = headers.findIndex((h) => /^(name|channel|title)$/i.test(h));
      const countryIndex = headers.findIndex((h) => /^(country|countrycode)$/i.test(h));
      const categoryIndex = headers.findIndex((h) => /^(category|group)$/i.test(h));
      const statusIndex = headers.findIndex((h) => /^(status|state)$/i.test(h));
      const latencyIndex = headers.findIndex((h) => /^(latencyms|latency|ms)$/i.test(h));
      if (hostIndex < 0) return [];
      return rows.slice(1).flatMap((row): WebSource[] => {
        const cells = csvCells(row); const url = safeUrl(cells[hostIndex]);
        if (!url) return [];
        const latency = latencyIndex >= 0 ? Number(cells[latencyIndex]) : NaN;
        return [{ name: cells[nameIndex] || new URL(url).hostname, url, country: countryIndex >= 0 ? cells[countryIndex] : undefined, category: categoryIndex >= 0 ? cells[categoryIndex] : undefined, status: statusIndex >= 0 ? cells[statusIndex] : undefined, latencyMs: Number.isFinite(latency) ? latency : undefined }];
      });
    }
    const data: unknown = JSON.parse(text);
    if (!data || typeof data !== "object") return [];
    const root = data as Record<string, unknown>;
    const records = Array.isArray(root.records) ? root.records : Array.isArray(data) ? data : [];
    return records.flatMap((raw) => {
      if (!raw || typeof raw !== "object") return [];
      const row = raw as Record<string, unknown>;
      const url = safeUrl(row.urlHost ?? row.website ?? row.site ?? row.domain);
      if (!url) return [];
      return [{ name: typeof row.name === "string" ? row.name : new URL(url).hostname, url, country: typeof row.country === "string" ? row.country : undefined, category: typeof row.category === "string" ? row.category : undefined, status: typeof row.status === "string" ? row.status : undefined, latencyMs: typeof row.latencyMs === "number" ? row.latencyMs : undefined }];
    });
  } catch { return []; }
}

function parseCatalog(text: string, filename: string): CatalogChannel[] {
  const ext = filename.toLowerCase().split(".").pop();
  if (ext === "m3u" || ext === "m3u8" || text.trimStart().startsWith("#EXTM3U")) {
    return parseM3U(text).filter((channel) => isPlayableMedia(channel.url)).map((channel) => ({ name: channel.name, url: channel.url, category: channel.groupTitle }));
  }
  if (ext === "csv") {
    const rows = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
    if (rows.length < 2) return [];
    const headers = csvCells(rows[0]).map((item) => item.toLowerCase());
    const urlIndexes = headers.map((header, i) => /url|stream|source|manifest|hls|m3u8|link/i.test(header) ? i : -1).filter((i) => i >= 0);
    const nameIndex = headers.findIndex((header) => /^(name|channel|title|canal)$/i.test(header));
    const countryIndex = headers.findIndex((header) => /^(country|countrycode|pa[ií]s)$/i.test(header));
    const categoryIndex = headers.findIndex((header) => /^(category|group|categor[ií]a)$/i.test(header));
    const found: CatalogChannel[] = [];
    for (const row of rows.slice(1)) {
      const cells = csvCells(row);
      for (const index of urlIndexes) {
        const raw = cells[index] ?? "";
        const matches = extractMediaUrls(raw);
        for (const match of matches) {
          const url = match.replace(/[),.;\]}]+$/, "");
          if (isPlayableMedia(url)) found.push({ name: cells[nameIndex] || "Canal", url, country: countryIndex >= 0 ? cells[countryIndex] : undefined, category: categoryIndex >= 0 ? cells[categoryIndex] : undefined });
        }
      }
    }
    return found;
  }
  try { return fromJson(JSON.parse(text)); }
  catch { throw new Error("No se reconoce el archivo. Usa una lista M3U/M3U8, JSON o CSV válido."); }
}

let dashLoader: Promise<void> | undefined;
function loadDashJs(): Promise<void> {
  if (window.dashjs) return Promise.resolve();
  if (!dashLoader) dashLoader = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/dashjs@4.7.4/dist/dash.all.min.js";
    script.async = true;
    script.onload = () => window.dashjs ? resolve() : reject(new Error("No se pudo inicializar el reproductor DASH."));
    script.onerror = () => reject(new Error("No se pudo descargar el componente DASH."));
    document.head.appendChild(script);
  });
  return dashLoader;
}

let hlsLoader: Promise<void> | undefined;
function loadHlsJs(): Promise<void> {
  if (window.Hls) return Promise.resolve();
  if (!hlsLoader) hlsLoader = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/hls.js@1.5.18/dist/hls.min.js";
    script.async = true;
    script.onload = () => window.Hls ? resolve() : reject(new Error("No se pudo cargar el reproductor HLS."));
    script.onerror = () => reject(new Error("No se pudo descargar el componente HLS. Comprueba la conexión."));
    document.head.appendChild(script);
  });
  return hlsLoader;
}

export function StatusCatalogPlayer() {
  const [channels, setChannels] = useState<CatalogChannel[]>([]);
  const [webSources, setWebSources] = useState<WebSource[]>([]);
  const [selectedUrl, setSelectedUrl] = useState("");
  const [search, setSearch] = useState("");
  const [portalSearch, setPortalSearch] = useState("");
  const [message, setMessage] = useState("Importa un catálogo y selecciona una fuente para reproducirla o diagnosticarla.");
  const [probeMessage, setProbeMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [favoriteUrls, setFavoriteUrls] = useState<string[]>(() => {
    try {
      const saved = window.localStorage.getItem("iptv-doctor-favorites-v1");
      const parsed: unknown = saved ? JSON.parse(saved) : [];
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
    } catch { return []; }
  });
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState("Todas");
  const [catalogName, setCatalogName] = useState("");
  const [selectedSavedCatalog, setSelectedSavedCatalog] = useState("");
  const [savedCatalogs, setSavedCatalogs] = useState<SavedCatalog[]>(() => {
    try {
      const saved = window.localStorage.getItem("iptv-doctor-catalog-library-v1");
      const parsed: unknown = saved ? JSON.parse(saved) : [];
      return Array.isArray(parsed) ? parsed.filter((item): item is SavedCatalog =>
        Boolean(item && typeof item.id === "string" && typeof item.name === "string" &&
          typeof item.savedAt === "string" && Array.isArray(item.channels))
      ) : [];
    } catch { return []; }
  });
  const [catalogUrl, setCatalogUrl] = useState("https://www.tdtchannels.com/lists/tv.m3u8");
  const [siteUrl, setSiteUrl] = useState("https://abema.tv");
  const [discoveredItems, setDiscoveredItems] = useState<DiscoveredItem[]>(ABEMA_CATEGORIES);
  const [siteMessage, setSiteMessage] = useState("ABEMA: géneros oficiales precargados. Pulsa «Buscar contenidos públicos» para intentar leer los programas y eventos que la web publique.");
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<InstanceType<HlsConstructor> | undefined>(undefined);
  const dashRef = useRef<DashPlayer | undefined>(undefined);

  const categories = useMemo(() => ["Todas", ...new Set(channels.map((channel) => channel.category?.trim()).filter((value): value is string => Boolean(value)))].sort((a, b) => a === "Todas" ? -1 : b === "Todas" ? 1 : a.localeCompare(b)), [channels]);
  const visible = useMemo(() => channels.filter((channel) =>
    `${channel.name} ${channel.country ?? ""} ${channel.category ?? ""} ${channel.url}`.toLowerCase().includes(search.toLowerCase()) &&
    (categoryFilter === "Todas" || channel.category === categoryFilter) &&
    (!favoriteOnly || favoriteUrls.includes(channel.url))
  ), [channels, search, categoryFilter, favoriteOnly, favoriteUrls]);

  useEffect(() => {
    try { window.localStorage.setItem("iptv-doctor-favorites-v1", JSON.stringify(favoriteUrls)); } catch { /* Storage may be unavailable in private browsing. */ }
  }, [favoriteUrls]);
  useEffect(() => {
    try { window.localStorage.setItem("iptv-doctor-catalog-library-v1", JSON.stringify(savedCatalogs)); } catch { /* Browser storage has a finite quota. */ }
  }, [savedCatalogs]);

  function saveCurrentCatalog(): void {
    const name = catalogName.trim();
    if (!name) { setMessage("Escribe un nombre para guardar este catálogo."); return; }
    if (!channels.length) { setMessage("Carga primero un catálogo con enlaces reproducibles."); return; }
    const id = `${Date.now()}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24)}`;
    const snapshot: SavedCatalog = { id, name, savedAt: new Date().toISOString(), channels: channels.slice(0, 5000) };
    setSavedCatalogs((current) => [snapshot, ...current.filter((item) => item.name.toLowerCase() !== name.toLowerCase())].slice(0, 10));
    setSelectedSavedCatalog(id);
    setMessage(`Catálogo “${name}” guardado en este navegador con ${snapshot.channels.length} enlaces${channels.length > snapshot.channels.length ? " (límite de 5.000 entradas por catálogo guardado)" : ""}.`);
  }

  function loadSavedCatalog(id: string): void {
    const saved = savedCatalogs.find((item) => item.id === id);
    if (!saved) return;
    setChannels(saved.channels);
    setWebSources([]);
    setSelectedUrl(saved.channels[0]?.url ?? "");
    setPlaying(false);
    setMessage(`Catálogo “${saved.name}” cargado: ${saved.channels.length} enlaces.`);
  }

  function deleteSavedCatalog(): void {
    if (!selectedSavedCatalog) return;
    setSavedCatalogs((current) => current.filter((item) => item.id !== selectedSavedCatalog));
    setSelectedSavedCatalog("");
    setMessage("Catálogo guardado eliminado de este navegador.");
  }
  useEffect(() => () => { hlsRef.current?.destroy(); dashRef.current?.reset(); }, []);

  function toggleFavorite(url: string): void {
    setFavoriteUrls((current) => current.includes(url) ? current.filter((item) => item !== url) : [...current, url]);
  }

  async function loadFile(file?: File): Promise<void> {
    if (!file) return;
    setMessage("");
    setPlaying(false);
    try {
      const fileText = await file.text();
      const sources = parseWebSources(fileText, file.name);
      setWebSources(sources);
      const parsed = parseCatalog(fileText, file.name);
      const unique = [...new Map(parsed.map((channel) => [channel.url, channel])).values()];
      setChannels(unique);
      setSelectedUrl(unique[0]?.url ?? "");
      setMessage(unique.length
        ? `Importados ${unique.length} enlaces de vídeo/audio compatibles de “${file.name}”.`
        : sources.length
          ? `Catálogo leído: ${sources.length} webs detectadas. No contiene manifiestos HLS directos; puedes abrir las webs oficiales en la lista inferior.`
          : "El archivo se ha leído, pero no contiene enlaces directos compatibles (.m3u8, .mp4, .webm o audio). Las páginas web no son emisiones reproducibles.");
    } catch (error) {
      setChannels([]);
      setWebSources([]);
      setSelectedUrl("");
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function loadRemoteCatalog(overrideUrl?: string): Promise<void> {
    const raw = (overrideUrl ?? catalogUrl).trim();
    if (overrideUrl) setCatalogUrl(overrideUrl);
    if (!raw) { setMessage("Introduce la URL pública de un catálogo JSON, CSV, M3U o M3U8."); return; }
    let url: URL;
    try { url = new URL(raw); } catch { setMessage("La URL del catálogo no es válida."); return; }
    if (url.protocol !== "https:" && url.protocol !== "http:") { setMessage("Solo se admiten direcciones HTTP o HTTPS."); return; }
    if (mediaKind(url.toString())) {
      const direct = [{ name: url.hostname, url: url.toString() }];
      setChannels(direct);
      setWebSources([]);
      setSelectedUrl(url.toString());
      setMessage("URL directa de vídeo reconocida. Pulsa «Reproducir canal seleccionado».");
      return;
    }
    setBusy(true);
    setPlaying(false);
    setMessage("Leyendo catálogo remoto (con alternativa para servidores sin CORS)…");
    try {
      let text: string;
      let filename = url.pathname.split("/").pop() || "catalog.json";
      try {
        const response = await fetch(url.toString(), { headers: { Accept: "application/json,text/csv,audio/x-mpegurl,text/plain,*/*" } });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        text = await response.text();
      } catch {
        const proxyUrl = new URL("https://iptv-doctor-public-catalog.onrender.com/api/catalog");
        proxyUrl.searchParams.set("url", url.toString());
        const proxyResponse = await fetch(proxyUrl.toString(), { headers: { Accept: "application/json" } });
        const proxyData = await proxyResponse.json() as { error?: string; content?: string; filename?: string };
        if (!proxyResponse.ok || typeof proxyData.content !== "string") throw new Error(proxyData.error || "No se pudo leer el catálogo remoto, ni directamente ni mediante el lector público.");
        text = proxyData.content;
        filename = proxyData.filename || filename;
      }
      const sources = parseWebSources(text, filename);
      setWebSources(sources);
      const parsed = parseCatalog(text, filename);
      const unique = [...new Map(parsed.map((channel) => [channel.url, channel])).values()];
      setChannels(unique);
      setSelectedUrl(unique[0]?.url ?? "");
      setMessage(unique.length
        ? `Catálogo remoto cargado: ${unique.length} enlaces de vídeo/audio compatibles encontrados.`
        : sources.length ? `Catálogo de webs cargado: ${sources.length} sitios detectados. No contiene manifiestos HLS directos; puedes abrir cada web oficial desde la lista inferior.` : "El catálogo remoto se descargó, pero no contiene enlaces directos .m3u8 ni dominios reconocibles. Si el servidor bloquea CORS, descarga el archivo e impórtalo desde tu equipo.");
    } catch (error) {
      setMessage(error instanceof Error ? `No se pudo leer el catálogo remoto: ${error.message}. Prueba a descargar el archivo e importarlo localmente; el servidor puede bloquear CORS.` : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function discoverSite(): Promise<void> {
    let base: URL;
    try { base = new URL(siteUrl.trim()); } catch { setSiteMessage("Introduce una URL completa, por ejemplo https://abema.tv"); return; }
    if (base.protocol !== "https:" && base.protocol !== "http:") { setSiteMessage("Solo se admiten webs HTTP/HTTPS."); return; }
    setBusy(true);
    setSiteMessage("Explorando páginas públicas, categorías, programas y eventos…");
    try {
      const endpoint = new URL("https://iptv-doctor-public-catalog.onrender.com/api/discover");
      endpoint.searchParams.set("url", base.toString());
      const response = await fetch(endpoint.toString(), { headers: { Accept: "application/json" } });
      const result = await response.json() as { error?: string; items?: Array<{ title?: string; url?: string; kind?: string; description?: string; date?: string; source?: string }>; pagesScanned?: number; pages?: Array<{ url?: string; error?: string }> };
      if (!response.ok) throw new Error(result.error || "HTTP " + response.status);
      const items: DiscoveredItem[] = (result.items ?? []).filter((item) => typeof item.title === "string" && typeof item.url === "string").map((item) => ({
        title: item.title as string, url: item.url as string, kind: item.kind || "enlace público",
        description: item.description, date: item.date, source: item.source
      }));
      const isAbema = base.hostname === "abema.tv" || base.hostname.endsWith(".abema.tv");
      const merged = [...items, ...(isAbema ? ABEMA_CATEGORIES : [])];
      const unique = [...new Map(merged.map((item) => [item.url, item])).values()];
      setDiscoveredItems(unique);
      const pageErrors = (result.pages ?? []).filter((page) => page.error);
      setSiteMessage("Exploración completada: " + (result.pagesScanned ?? 0) + " páginas examinadas y " + items.length + " elementos detectados." + (pageErrors.length ? " Algunas páginas no se pudieron leer." : "") + (isAbema ? " Se añaden accesos de géneros oficiales de ABEMA." : ""));
    } catch (error) {
      const isAbema = base.hostname === "abema.tv" || base.hostname.endsWith(".abema.tv");
      setDiscoveredItems(isAbema ? ABEMA_CATEGORIES : []);
      setSiteMessage((error instanceof Error ? error.message : String(error)) + ". Comprueba que el servicio de descubrimiento haya terminado de desplegarse. Solo se leen metadatos públicos; no se accede a APIs privadas ni se evita DRM.");
    } finally { setBusy(false); }
  }

  async function probeSelected(): Promise<void> {
    if (!selectedUrl) return;
    setBusy(true);
    setProbeMessage("Comprobando disponibilidad HTTP y cabeceras de la fuente…");
    try {
      const endpoint = new URL("https://iptv-doctor-public-catalog.onrender.com/api/probe");
      endpoint.searchParams.set("url", selectedUrl);
      const response = await fetch(endpoint.toString(), { headers: { Accept: "application/json" } });
      const result = await response.json() as { error?: string; status?: number; ok?: boolean; contentType?: string; contentLength?: string | null; contentRange?: string | null; acceptsRanges?: string | null; finalUrl?: string; note?: string };
      if (!response.ok) throw new Error(result.error || "HTTP " + response.status);
      const statusLabel = result.ok ? "El servidor respondió" : "El servidor devolvió un error HTTP";
      setProbeMessage(`${statusLabel}: ${result.status ?? "?"} · Tipo: ${result.contentType || "desconocido"} · Tamaño: ${result.contentLength || "no indicado"} · Rango: ${result.contentRange || result.acceptsRanges || "no anunciado"}. ${result.note || ""}${result.finalUrl && result.finalUrl !== selectedUrl ? " URL final: " + result.finalUrl : ""}`);
    } catch (error) {
      setProbeMessage("No se pudo comprobar la fuente: " + (error instanceof Error ? error.message : String(error)) + ". Puede ser un bloqueo de red, CORS, una URL no pública o una restricción del servidor.");
    } finally { setBusy(false); }
  }

  async function playSelected(): Promise<void> {
    const video = videoRef.current;
    if (!video || !selectedUrl) return;
    setBusy(true);
    setPlaying(false);
    setMessage("Preparando reproducción…");
    hlsRef.current?.destroy();
    hlsRef.current = undefined;
    dashRef.current?.reset();
    dashRef.current = undefined;
    video.pause();
    video.removeAttribute("src");
    video.load();
    try {
      const kind = mediaKind(selectedUrl);
      if (kind === "dash") {
        await loadDashJs();
        if (!window.dashjs) throw new Error("El reproductor DASH no está disponible.");
        const dash = window.dashjs.MediaPlayer().create();
        dashRef.current = dash;
        dash.on("error", (event) => {
          setPlaying(false);
          setMessage(`Error DASH${event.error?.code ? " " + event.error.code : ""}: ${event.error?.message || "no se pudo cargar el manifiesto o sus segmentos"}. Comprueba CORS, disponibilidad y permisos de la fuente.`);
        });
        dash.initialize(video, selectedUrl, true);
        video.onplaying = () => { setPlaying(true); setMessage("Reproducción DASH iniciada."); };
        video.onerror = () => { setPlaying(false); setMessage("El navegador no pudo reproducir la fuente DASH. Puede requerir CORS, un códec compatible o permisos."); };
        setMessage("Cargando manifiesto DASH…");
        return;
      }
      if (kind === "file") {
        video.src = selectedUrl;
        await video.play();
        setPlaying(true);
        setMessage("Reproducción iniciada.");
        return;
      }
      if (kind !== "hls") throw new Error("Formato no reconocido. Usa HLS (.m3u8), DASH (.mpd) o un archivo MP4/WebM/audio directo.");
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = selectedUrl;
        await video.play();
        setPlaying(true);
        setMessage("Reproducción HLS iniciada.");
        return;
      }
      await loadHlsJs();
      const Hls = window.Hls;
      if (!Hls?.isSupported()) throw new Error("Este navegador no admite HLS mediante Media Source Extensions.");
      const instance = new Hls({ enableWorker: true, lowLatencyMode: true, backBufferLength: 30 });
      hlsRef.current = instance;
      instance.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) {
          setPlaying(false);
          setMessage(`No se puede reproducir: error HLS ${data.type ?? ""} ${data.details ?? ""}. Puede ser URL caducada, CORS, autenticación, formato o DRM.`);
          instance.destroy();
          hlsRef.current = undefined;
        }
      });
      instance.loadSource(selectedUrl);
      instance.attachMedia(video);
      video.onplaying = () => { setPlaying(true); setMessage("Reproducción iniciada."); };
      video.onerror = () => { setPlaying(false); setMessage("El navegador no pudo reproducir esta fuente. Puede requerir permisos, CORS o un formato compatible."); };
      setMessage("Cargando manifiesto HLS…");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally { setBusy(false); }
  }

  return (
    <section className="panel local-panel player-panel">
      <p className="eyebrow">HLS catalogue player</p>
      <h2>Importar catálogo y reproducir</h2>
      <p>Admite catálogos M3U/M3U8, JSON y CSV; reproduce HLS (.m3u8), DASH (.mpd), MP4, WebM y audio compatible. Busca por canal, filtra categorías y guarda favoritos en este navegador. Las fuentes deben ser públicas o estar autorizadas; no se elude DRM ni autenticación.</p>
      <input aria-label="Importar catálogo JSON CSV M3U" type="file" accept=".json,.csv,.m3u,.m3u8,application/json,text/csv,audio/x-mpegurl" onChange={(event) => void loadFile(event.target.files?.[0])} />
      <div className="playlist-presets">
        <p><strong>Listas públicas para reproducir</strong> · fuentes de TV/radio en abierto de TDTChannels. No incluyen canales de pago como Movistar o DAZN.</p>
        <div className="playlist-preset-actions">
          <button type="button" disabled={busy} onClick={() => void loadRemoteCatalog("https://www.tdtchannels.com/lists/tv.m3u8")}>Cargar TV en abierto (M3U)</button>
          <button type="button" disabled={busy} onClick={() => void loadRemoteCatalog("https://www.tdtchannels.com/lists/radio.m3u8")}>Cargar radio (M3U)</button>
        </div>
      </div>
      <div className="remote-catalog-controls">
        <label>O cargar catálogo desde una URL pública
          <input type="url" value={catalogUrl} onChange={(event) => setCatalogUrl(event.target.value)} placeholder="URL de catálogo M3U, M3U8, JSON o CSV" />
        </label>
        <button disabled={busy || !catalogUrl.trim()} onClick={() => void loadRemoteCatalog()}>{busy ? "Cargando catálogo…" : "Leer catálogo remoto"}</button>
      </div>
      <p className="diagnostic-note">También puedes pegar una URL directa de vídeo/audio o la URL de un catálogo público. Si solo contiene nombres y urlHost (webs), no habrá emisiones que reproducir: necesitas enlaces directos. El lector remoto respeta los límites de seguridad y puede rechazar redirecciones entre dominios.</p>
      {message ? <p role="status" className="player-message">{message}</p> : null}
      <div className="saved-catalogs">
        <div>
          <p className="eyebrow">Biblioteca local</p>
          <h3>Guardar y separar catálogos</h3>
          <p className="diagnostic-note">Los catálogos guardados permanecen en este navegador, no en el servidor. Se guardan hasta 10 catálogos con un máximo de 5.000 enlaces cada uno.</p>
        </div>
        <div className="saved-catalog-controls">
          <label>Nombre del catálogo
            <input type="text" value={catalogName} onChange={(event) => setCatalogName(event.target.value)} placeholder="Ej. Noticias, deportes, mis listas" maxLength={80} />
          </label>
          <button type="button" disabled={!channels.length} onClick={saveCurrentCatalog}>Guardar catálogo actual</button>
        </div>
        {savedCatalogs.length ? <div className="saved-catalog-controls">
          <label>Catálogos guardados ({savedCatalogs.length})
            <select value={selectedSavedCatalog} onChange={(event) => setSelectedSavedCatalog(event.target.value)}>
              <option value="">Selecciona un catálogo guardado</option>
              {savedCatalogs.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.channels.length} enlaces</option>)}
            </select>
          </label>
          <button type="button" disabled={!selectedSavedCatalog} onClick={() => loadSavedCatalog(selectedSavedCatalog)}>Cargar guardado</button>
          <button type="button" className="secondary-action" disabled={!selectedSavedCatalog} onClick={deleteSavedCatalog}>Eliminar guardado</button>
        </div> : null}
      </div>
      <div className="site-discovery">
        <p className="eyebrow">Website & event discovery</p>
        <h3>Explorador de géneros, programas y eventos</h3>
        <p>Detecta enlaces y metadatos públicos en webs compatibles. Para ABEMA se muestran accesos oficiales a canales, deportes, anime, noticias, drama, variedades, películas, documentales y programación.</p>
        <div className="remote-catalog-controls">
          <label>Web que quieres explorar
            <input type="url" value={siteUrl} onChange={(event) => setSiteUrl(event.target.value)} placeholder="https://abema.tv" />
          </label>
          <button disabled={busy || !siteUrl.trim()} onClick={() => void discoverSite()}>{busy ? "Explorando…" : "Buscar contenidos públicos"}</button>
        </div>
        <p role="status" className="player-message">{siteMessage}</p>
        {discoveredItems.length > 0 ? <div className="discovered-grid">
          {discoveredItems.map((item) => <article className="discovered-item" key={item.url}>
            <span className="source-status">{item.kind}</span>
            <strong>{item.title}</strong>
            {item.description ? <p>{item.description}</p> : null}
            {item.date ? <small>{item.date}</small> : null}
            <a href={item.url} target="_blank" rel="noopener noreferrer">Abrir en la web oficial ↗</a>
          </article>)}
        </div> : null}
        <p className="diagnostic-note">La extracción automática depende de CORS y de los metadatos públicos de cada proveedor. No accede a APIs privadas ni elimina DRM. Si se encuentra una URL HLS directa y autorizada, impórtala en el reproductor de arriba.</p>
      </div>

      <div className="web-source-list official-portals">
        <h3>Directorio de webs oficiales para ver deporte ({OFFICIAL_SPORTS_PORTALS.length})</h3>
        <p className="diagnostic-note">Enlaces directos a páginas oficiales de emisión, programación y partidos. Son portales de visionado, no enlaces de vídeo reproducible; algunos requieren suscripción o tienen restricciones territoriales. No se publican enlaces pirata ni se sortean controles de acceso.</p>
        <label>Buscar plataforma, deporte o país
          <input type="search" value={portalSearch} onChange={(event) => setPortalSearch(event.target.value)} placeholder="Movistar, DAZN, partidos, Catalunya…" />
        </label>
        <div className="official-portal-grid">
          {OFFICIAL_SPORTS_PORTALS.filter((portal) => `${portal.name} ${portal.country} ${portal.category} ${portal.note}`.toLowerCase().includes(portalSearch.toLowerCase())).map((portal) => (
            <article className="official-portal-card" key={portal.name}>
              <div className="official-portal-tags"><span>{portal.country}</span><span>{portal.category}</span></div>
              <strong>{portal.name}</strong>
              <p>{portal.note}</p>
              <a href={portal.url} target="_blank" rel="noopener noreferrer">Abrir página oficial ↗</a>
            </article>
          ))}
        </div>
      </div>
      {webSources.length > 0 ? (
        <div className="web-source-list">
          <h3>Webs del catálogo ({webSources.length})</h3>
          <p className="diagnostic-note">Estas son páginas de origen, no enlaces de emisión. Abrir la web permite comprobar las opciones oficiales de visionado; la página puede requerir cuenta, suscripción o disponibilidad regional.</p>
          <label>Buscar web
            <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nombre, país o categoría" />
          </label>
          <div className="web-source-rows">
            {webSources.filter((source) => `${source.name} ${source.country ?? ""} ${source.category ?? ""} ${source.url}`.toLowerCase().includes(search.toLowerCase())).map((source) => (
              <article className="web-source-row" key={source.name + source.url}>
                <div><strong>{source.name}</strong><span>{[source.country, source.category].filter(Boolean).join(" · ")}</span><small>{new URL(source.url).hostname}{typeof source.latencyMs === "number" ? ` · ${source.latencyMs} ms` : ""}</small></div>
                <div className="web-source-meta">{source.status ? <span className={/online|ok/i.test(source.status) ? "source-status online" : "source-status"}>{source.status}</span> : null}<button onClick={() => window.open(source.url, "_blank", "noopener,noreferrer")}>Abrir web oficial ↗</button></div>
              </article>
            ))}
          </div>
        </div>
      ) : null}
      {channels.length > 0 ? (
        <div className="player-layout">
          <div className="player-controls">
            <label>Buscar canal
              <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nombre, país o categoría" />
            </label>
            <label>Categoría
              <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
                {categories.map((category) => <option key={category} value={category}>{category}</option>)}
              </select>
            </label>
            <label className="favorite-filter">
              <input type="checkbox" checked={favoriteOnly} onChange={(event) => setFavoriteOnly(event.target.checked)} />
              Mostrar solo favoritos ({favoriteUrls.length})
            </label>
            <label>Canal ({visible.length} de {channels.length})
              <select value={visible.some((channel) => channel.url === selectedUrl) ? selectedUrl : (visible[0]?.url ?? "")} onChange={(event) => { setSelectedUrl(event.target.value); setPlaying(false); }} size={Math.min(8, Math.max(3, visible.length))}>
                {visible.map((channel) => <option key={channel.url} value={channel.url}>{channel.name}{channel.country ? ` · ${channel.country}` : ""}{channel.category ? ` · ${channel.category}` : ""}</option>)}
              </select>
            </label>
            {selectedUrl ? <button type="button" onClick={() => toggleFavorite(selectedUrl)}>{favoriteUrls.includes(selectedUrl) ? "★ Quitar de favoritos" : "☆ Añadir a favoritos"}</button> : null}
            <button disabled={!visible.some((channel) => channel.url === selectedUrl) || busy} onClick={() => void playSelected()}>{busy ? "Cargando…" : playing ? "Volver a cargar canal" : "▶ Reproducir canal seleccionado"}</button>
            <button type="button" className="secondary-action" disabled={!selectedUrl || busy} onClick={() => void probeSelected()}>⌕ Diagnosticar fuente</button>
            {probeMessage ? <p role="status" className="player-message">{probeMessage}</p> : null}
            {selectedUrl ? <a className="source-open-link" href={selectedUrl} target="_blank" rel="noopener noreferrer">Abrir URL de origen ↗</a> : null}
            <span className="diagnostic-note">Formatos detectados: HLS (.m3u8), DASH (.mpd), archivos MP4/WebM y audio. El diagnóstico comprueba cabeceras HTTP, no garantiza la reproducción. CORS, códecs, permisos y DRM pueden impedirla.</span>
          </div>
          <div className="video-wrap">
            <video ref={videoRef} controls playsInline preload="metadata" />
            <p className="diagnostic-note">Solo reproduce emisiones públicas o para las que tengas autorización. No se incluye ningún canal de pago ni enlace inventado.</p>
          </div>
        </div>
      ) : null}
    </section>
  );
}
