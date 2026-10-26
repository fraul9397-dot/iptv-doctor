import { CalendarDays, Download, Github, Package, Tv } from "lucide-react";
import { useEffect, useState } from "react";
import { generateICalendar, generateM3UPlaceholder, generateXMLTV } from "@bjia666/match2epg";
import { createDiagnosticsSummary, probePlaylist, renderCsvReport, renderJsonReport, type ChannelDiagnostic } from "iptv-doctor-core";
import { getWorldCup2026Dataset } from "iptv-sports-data";
import { summarizeLocalPlaylist, type LocalPlaylistSummary } from "./localPlaylist";
import { StatusCatalogPlayer } from "./StatusCatalogPlayer";

const dataset = getWorldCup2026Dataset();
const usChannels = dataset.broadcasters.US?.channels ?? [];

interface StatusIndex {
  updatedAt: string;
  sourceMode: string;
  summary: {
    total: number;
    online: number;
    slow: number;
    offline: number;
    healthScore: number;
    countries: number;
  };
  records: Array<{
    id: string;
    name: string;
    country: string;
    category: string;
    status: "ok" | "warn" | "fail";
    latencyMs?: number;
    urlHost: string;
    checkedAt: string;
  }>;
}

function statusLabel(status: StatusIndex["records"][number]["status"]): string {
  if (status === "ok") return "online";
  if (status === "warn") return "slow";
  return "offline";
}

function downloadFile(name: string, content: string, type: string): void {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

export function App() {
  const [localSummary, setLocalSummary] = useState<LocalPlaylistSummary | undefined>();
  const [statusIndex, setStatusIndex] = useState<StatusIndex | undefined>();
  const [probeResults, setProbeResults] = useState<ChannelDiagnostic[] | undefined>();
  const [probeBusy, setProbeBusy] = useState(false);
  const [probeMessage, setProbeMessage] = useState("");
  const [probeFilter, setProbeFilter] = useState<"all" | "ok" | "warn" | "fail">("all");
  const [probeSearch, setProbeSearch] = useState("");
  const summaryItems = statusIndex
    ? [
        { value: statusIndex.summary.total, label: "entries checked" },
        { value: statusIndex.summary.online, label: "online" },
        { value: statusIndex.summary.offline, label: "offline" },
        { value: `${statusIndex.summary.healthScore}%`, label: "health score" }
      ]
    : [
        { value: dataset.tournament.matchCount, label: "matches" },
        { value: dataset.tournament.teamCount, label: "teams" },
        { value: dataset.tournament.hostCountries.length, label: "hosts" },
        { value: usChannels.length, label: "US paths" }
      ];

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}status-index.json`)
      .then((response) => (response.ok ? response.json() : undefined))
      .then((value: StatusIndex | undefined) => setStatusIndex(value))
      .catch(() => setStatusIndex(undefined));
  }, []);

  async function handleLocalPlaylist(file: File | undefined): Promise<void> {
    if (!file) return;
    const text = await file.text();
    setLocalSummary(summarizeLocalPlaylist(text));
    setProbeResults(undefined);
    setProbeMessage("");
    setProbeFilter("all");
    setProbeSearch("");
  }

  async function handleProbePlaylist(): Promise<void> {
    if (!localSummary || localSummary.probeChannels.length === 0) return;
    setProbeBusy(true);
    setProbeMessage("");
    setProbeResults(undefined);
    try {
      const sample = localSummary.probeChannels.slice(0, 50);
      const results = await probePlaylist(sample, {
        timeoutMs: 6000,
        concurrency: 4,
        slowThresholdMs: 2500,
        sampleSegments: 1
      });
      setProbeResults(results);
      setProbeFilter("all");
      setProbeSearch("");
      setProbeMessage(sample.length < localSummary.probeChannels.length
        ? `Se comprobaron las primeras ${sample.length} entradas válidas de ${localSummary.probeChannels.length}. Puedes ejecutar la prueba por lotes con archivos más pequeños.`
        : `Comprobación terminada: ${results.length} entradas.`);
    } catch (error) {
      setProbeMessage(`No se pudo completar la prueba: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setProbeBusy(false);
    }
  }

  return (
    <main className="shell">
      <section className="toolbar">
        <div>
          <p className="eyebrow">IPTV playlist checker</p>
          <h1>IPTV Doctor</h1>
          <p className="dek">
            Check M3U and M3U8 playlists, clean dead IPTV channels, fix XMLTV EPG IDs, and export legal World Cup 2026 metadata.
          </p>
        </div>
        <div className="actions">
          <a className="button-link" href="https://github.com/xyzs996/iptv-doctor" target="_blank" rel="noreferrer">
            <Github size={16} /> GitHub
          </a>
          <a className="button-link" href="https://www.npmjs.com/package/iptv-doctor" target="_blank" rel="noreferrer">
            <Package size={16} /> npm
          </a>
          <button onClick={() => downloadFile("worldcup-2026-us.xml", generateXMLTV(dataset, "US"), "application/xml")}>
            <Download size={16} /> XMLTV
          </button>
          <button onClick={() => downloadFile("worldcup-2026.ics", generateICalendar(dataset), "text/calendar")}>
            <CalendarDays size={16} /> iCal
          </button>
          <button onClick={() => downloadFile("worldcup-2026-us.m3u", generateM3UPlaceholder(dataset, "US"), "audio/x-mpegurl")}>
            <Tv size={16} /> M3U
          </button>
        </div>
      </section>

      <section className="summary">
        {summaryItems.map((item) => (
          <div key={item.label}><strong>{item.value}</strong><span>{item.label}</span></div>
        ))}
      </section>

      {statusIndex ? (
        <section className="panel status-panel">
          <div className="panel-title">
            <div>
              <p className="eyebrow">Auto-updated index</p>
              <h2>Live IPTV Status Index</h2>
            </div>
            <div className="status-actions">
              <a href={`${import.meta.env.BASE_URL}status-index.json`}>JSON</a>
              <a href={`${import.meta.env.BASE_URL}status-index.csv`}>CSV</a>
              <span>{new Date(statusIndex.updatedAt).toLocaleString()}</span>
            </div>
          </div>
          <div className="status-table">
            {statusIndex.records.slice(0, 10).map((record) => (
              <article className="status-row" key={record.id}>
                <strong>{record.name}</strong>
                <span>{record.country} · {record.category}</span>
                <span className={`status-pill ${record.status}`}>{statusLabel(record.status)}</span>
                <span>{typeof record.latencyMs === "number" ? `${record.latencyMs} ms` : "-"}</span>
                <span>{record.urlHost}</span>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="grid">
        <div className="panel">
          <h2>Schedule</h2>
          <div className="match-list">
            {dataset.fixtures.map((fixture) => (
              <article className="match-row" key={fixture.id}>
                <time>{new Date(fixture.kickoffUtc).toLocaleString()}</time>
                <div>
                  <strong>{fixture.homeTeam} vs {fixture.awayTeam}</strong>
                  <span>{fixture.stage} · {fixture.venue}, {fixture.city}</span>
                </div>
              </article>
            ))}
          </div>
        </div>

        <div className="panel">
          <h2>US Viewing</h2>
          <div className="channel-list">
            {usChannels.map((channel) => (
              <article className="channel-row" key={channel.id}>
                <strong>{channel.name}</strong>
                <span>{channel.language} · {channel.kind}</span>
                <a href={channel.website} target="_blank" rel="noreferrer">Official site</a>
              </article>
            ))}
          </div>
        </div>
      </section>

      <StatusCatalogPlayer />

      <section className="panel local-panel">
        <h2>Analizador local de listas M3U / M3U8</h2>
        <p>Analiza la estructura, detecta URLs inválidas y duplicadas y permite exportar una lista depurada. El archivo se procesa en este navegador y no se sube al servidor.</p>
        <input
          aria-label="Seleccionar archivo M3U local"
          type="file"
          accept=".m3u,.m3u8,audio/x-mpegurl"
          onChange={(event) => void handleLocalPlaylist(event.target.files?.[0])}
        />
        {localSummary ? (
          <div className="local-summary">
            <strong>{localSummary.total} entradas encontradas</strong>
            <div className="diagnostic-stats">
              <div><strong>{localSummary.total - localSummary.invalidUrls - localSummary.duplicateUrls}</strong><span>entradas únicas válidas</span></div>
              <div><strong>{localSummary.duplicateUrls}</strong><span>URLs duplicadas</span></div>
              <div><strong>{localSummary.invalidUrls}</strong><span>URLs no válidas</span></div>
              <div><strong>{localSummary.missingNames}</strong><span>nombres ausentes</span></div>
            </div>
            <div className="chips">
              {localSummary.groups.map((item) => (
                <span key={item.group}>{item.group}: {item.count}</span>
              ))}
            </div>
            <p>Canales detectados: {localSummary.channels.slice(0, 10).join(", ") || "ninguno"}</p>
            <button onClick={() => downloadFile("iptv-doctor-lista-depurada.m3u", localSummary.cleanedM3U, "audio/x-mpegurl")}>
              <Download size={16} /> Descargar M3U depurada
            </button>
            <button disabled={probeBusy || localSummary.probeChannels.length === 0} onClick={() => void handleProbePlaylist()}>
              {probeBusy ? "Comprobando disponibilidad..." : "Comprobar manifiestos y una muestra HLS"}
            </button>
            <p className="diagnostic-note">La prueba intenta leer cada manifiesto y solicitar una muestra de segmento. Algunos proveedores bloquean las peticiones desde navegadores mediante CORS o requieren autenticación; en esos casos el resultado puede ser inconcluso y no demuestra por sí solo que el canal esté caído.</p>
            {probeMessage ? <p role="status">{probeMessage}</p> : null}
            {probeResults ? (() => {
              const summary = createDiagnosticsSummary(probeResults);
              const normalizedSearch = probeSearch.trim().toLocaleLowerCase();
              const visibleResults = probeResults.filter((item) => {
                const matchesStatus = probeFilter === "all" || item.status === probeFilter;
                const matchesSearch = !normalizedSearch
                  || item.channel.name.toLocaleLowerCase().includes(normalizedSearch)
                  || item.channel.url.toLocaleLowerCase().includes(normalizedSearch)
                  || item.code.toLocaleLowerCase().includes(normalizedSearch)
                  || item.message.toLocaleLowerCase().includes(normalizedSearch);
                return matchesStatus && matchesSearch;
              });
              return (
                <div className="probe-results">
                  <div className="diagnostic-stats">
                    <div><strong>{summary.total}</strong><span>comprobados</span></div>
                    <div><strong>{summary.ok}</strong><span>correctos</span></div>
                    <div><strong>{summary.warn}</strong><span>lentos</span></div>
                    <div><strong>{summary.fail}</strong><span>fallos o bloqueos</span></div>
                  </div>
                  <div className="actions">
                    <button onClick={() => downloadFile("iptv-doctor-diagnostico.json", renderJsonReport(probeResults), "application/json")}>Descargar JSON</button>
                    <button onClick={() => downloadFile("iptv-doctor-diagnostico.csv", renderCsvReport(probeResults), "text/csv;charset=utf-8")}>Descargar CSV</button>
                  </div>
                  <div className="diagnostic-filters">
                    <label>
                      Filtrar resultados
                      <select aria-label="Filtrar resultados por estado" value={probeFilter} onChange={(event) => setProbeFilter(event.target.value as "all" | "ok" | "warn" | "fail")}>
                        <option value="all">Todos ({probeResults.length})</option>
                        <option value="ok">Correctos ({summary.ok})</option>
                        <option value="warn">Lentos ({summary.warn})</option>
                        <option value="fail">Fallos o bloqueos ({summary.fail})</option>
                      </select>
                    </label>
                    <label>
                      Buscar canal, URL o error
                      <input aria-label="Buscar en los resultados del diagnóstico" type="search" value={probeSearch} onChange={(event) => setProbeSearch(event.target.value)} placeholder="Nombre del canal, dominio, CORS..." />
                    </label>
                  </div>
                  <div className="issue-list">
                    <strong>Resultados detallados ({visibleResults.length} mostrados de {probeResults.length})</strong>
                    {visibleResults.length > 0 ? (
                      <ul>{visibleResults.map((item, index) => (
                        <li key={item.channel.url + index}>
                          <strong>{item.status.toUpperCase()} · {item.code}</strong> — {item.channel.name}: {item.message}
                          {typeof item.latencyMs === "number" ? ` (${item.latencyMs} ms)` : ""}
                        </li>
                      ))}</ul>
                    ) : <p>No hay resultados que coincidan con el filtro o la búsqueda.</p>}
                  </div>
                </div>
              );
            })() : null}
            <p className="diagnostic-note">Importante: este análisis revisa el formato y la estructura. No confirma si una emisión está activa; eso requiere comprobaciones de red y puede depender de CORS, autenticación o permisos del proveedor.</p>
            {localSummary.issues.length > 0 ? (
              <div className="issue-list">
                <strong>Observaciones ({localSummary.issues.length}{localSummary.issues.length === 50 ? "+" : ""})</strong>
                <ul>{localSummary.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>
              </div>
            ) : <p>No se detectaron problemas estructurales en las entradas analizadas.</p>}
          </div>
        ) : null}
      </section>

      <section className="search-panel">
        <article>
          <h2>M3U / M3U8 checker</h2>
          <p>Detect broken IPTV playlist entries, slow HLS manifests, and failed media segment samples before match day.</p>
        </article>
        <article>
          <h2>XMLTV EPG fixer</h2>
          <p>Compare playlist `tvg-id` values with XMLTV display names and generate fixed M3U output from the CLI.</p>
        </article>
        <article>
          <h2>GitHub Actions health reports</h2>
          <p>Run `xyzs996/iptv-doctor@v1` in CI and publish HTML, JSON, CSV, and Shields-compatible badge artifacts.</p>
        </article>
      </section>
    </main>
  );
}
