import { useEffect, useMemo, useRef, useState } from "react";
import { parseM3U } from "iptv-doctor-core";

type CatalogChannel = { name: string; url: string; country?: string; category?: string };
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

function isDirectHls(value: string): boolean {
  try {
    const parsed = new URL(value);
    return ["https:", "http:"].includes(parsed.protocol) && /\.m3u8$/i.test(parsed.pathname);
  } catch { return false; }
}

function fromJson(data: unknown): CatalogChannel[] {
  const found: CatalogChannel[] = [];
  const seen = new Set<object>();
  const urlPattern = /https?:\/\/[^\s"'<>\\]+?\.m3u8(?:\?[^\s"'<>\\]*)?/gi;
  function walk(value: unknown, context: { name?: string; country?: string; category?: string } = {}): void {
    if (typeof value === "string") {
      if (!/url|stream|source|manifest|hls|m3u8|link/i.test(context.name ?? "")) {
        for (const match of value.match(urlPattern) ?? []) {
          const url = match.replace(/[),.;\]}]+$/, "");
          if (isDirectHls(url)) found.push({ name: context.name || "Canal HLS", url, country: context.country, category: context.category });
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
          if (isDirectHls(url)) found.push({ name: next.name || "Canal HLS", url, country: next.country, category: next.category });
        }
      } else if (child && typeof child === "object") walk(child, next);
    }
  }
  walk(data);
  return found;
}

function parseCatalog(text: string, filename: string): CatalogChannel[] {
  const ext = filename.toLowerCase().split(".").pop();
  if (ext === "m3u" || ext === "m3u8" || text.trimStart().startsWith("#EXTM3U")) {
    return parseM3U(text).filter((channel) => isDirectHls(channel.url)).map((channel) => ({ name: channel.name, url: channel.url, category: channel.groupTitle }));
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
        const matches = raw.match(/https?:\/\/[^\s"'<>\\]+?\.m3u8(?:\?[^\s"'<>\\]*)?/gi) ?? [];
        for (const match of matches) {
          const url = match.replace(/[),.;\]}]+$/, "");
          if (isDirectHls(url)) found.push({ name: cells[nameIndex] || "Canal HLS", url, country: countryIndex >= 0 ? cells[countryIndex] : undefined, category: categoryIndex >= 0 ? cells[categoryIndex] : undefined });
        }
      }
    }
    return found;
  }
  try { return fromJson(JSON.parse(text)); }
  catch { throw new Error("No se reconoce el archivo. Usa una lista M3U/M3U8, JSON o CSV válido."); }
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
  const [selectedUrl, setSelectedUrl] = useState("");
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("Carga un catálogo que contenga direcciones directas .m3u8 para reproducirlas aquí.");
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<InstanceType<HlsConstructor> | undefined>(undefined);

  const visible = useMemo(() => channels.filter((channel) =>
    `${channel.name} ${channel.country ?? ""} ${channel.category ?? ""} ${channel.url}`.toLowerCase().includes(search.toLowerCase())
  ), [channels, search]);

  useEffect(() => () => { hlsRef.current?.destroy(); }, []);

  async function loadFile(file?: File): Promise<void> {
    if (!file) return;
    setMessage("");
    setPlaying(false);
    try {
      const parsed = parseCatalog(await file.text(), file.name);
      const unique = [...new Map(parsed.map((channel) => [channel.url, channel])).values()];
      setChannels(unique);
      setSelectedUrl(unique[0]?.url ?? "");
      setMessage(unique.length
        ? `Importados ${unique.length} enlaces .m3u8 directos de “${file.name}”.`
        : "El archivo se ha leído, pero no contiene URL directas .m3u8. En el status-index público, urlHost es solo el dominio de la web, no la dirección de vídeo.");
    } catch (error) {
      setChannels([]);
      setSelectedUrl("");
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function playSelected(): Promise<void> {
    const video = videoRef.current;
    if (!video || !selectedUrl) return;
    setBusy(true);
    setPlaying(false);
    setMessage("Preparando reproducción…");
    hlsRef.current?.destroy();
    hlsRef.current = undefined;
    video.pause();
    video.removeAttribute("src");
    video.load();
    try {
      if (video.canPlayType("application/vnd.apple.mpegurl")) {
        video.src = selectedUrl;
        await video.play();
        setPlaying(true);
        setMessage("Reproducción iniciada. Si falla, el servidor puede exigir autorización o bloquear esta conexión.");
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
      video.onerror = () => { setPlaying(false); setMessage("El navegador no pudo reproducir este manifiesto. Puede requerir permisos, CORS o un formato compatible."); };
      setMessage("Cargando manifiesto HLS…");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally { setBusy(false); }
  }

  return (
    <section className="panel local-panel player-panel">
      <p className="eyebrow">HLS catalogue player</p>
      <h2>Importar catálogo y reproducir</h2>
      <p>Admite archivos M3U/M3U8, JSON y CSV. Detecta enlaces directos a manifiestos HLS y permite elegir un canal. No convierte nombres de dominio en enlaces de vídeo ni evita CORS, autenticación o DRM.</p>
      <input aria-label="Importar catálogo JSON CSV M3U" type="file" accept=".json,.csv,.m3u,.m3u8,application/json,text/csv,audio/x-mpegurl" onChange={(event) => void loadFile(event.target.files?.[0])} />
      <p className="diagnostic-note">También puedes importar los archivos JSON/CSV del índice de estado. Si solo contienen nombres y urlHost, no habrá enlaces reproducibles que extraer: será necesario un catálogo que publique las URL de vídeo.</p>
      {message ? <p role="status" className="player-message">{message}</p> : null}
      {channels.length > 0 ? (
        <div className="player-layout">
          <div className="player-controls">
            <label>Buscar canal
              <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nombre, país o categoría" />
            </label>
            <label>Canal ({visible.length} de {channels.length})
              <select value={selectedUrl} onChange={(event) => { setSelectedUrl(event.target.value); setPlaying(false); }} size={Math.min(8, Math.max(3, visible.length))}>
                {visible.map((channel) => <option key={channel.url} value={channel.url}>{channel.name}{channel.country ? ` · ${channel.country}` : ""}{channel.category ? ` · ${channel.category}` : ""}</option>)}
              </select>
            </label>
            <button disabled={!selectedUrl || busy} onClick={() => void playSelected()}>{busy ? "Cargando…" : playing ? "Volver a cargar canal" : "▶ Reproducir canal seleccionado"}</button>
            <span className="diagnostic-note">El estado de reproducción depende de la disponibilidad y los permisos de la fuente.</span>
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
