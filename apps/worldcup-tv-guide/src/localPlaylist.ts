import { parseM3UWithIssues, type M3UChannel } from "iptv-doctor-core";

export interface LocalPlaylistSummary {
  total: number;
  groups: Array<{ group: string; count: number }>;
  channels: string[];
  duplicateUrls: number;
  invalidUrls: number;
  missingNames: number;
  issues: string[];
  cleanedM3U: string;
}

function validHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function renderPlaylist(channels: M3UChannel[]): string {
  const lines = ["#EXTM3U"];
  for (const channel of channels) {
    const attrs = [
      channel.tvgId ? `tvg-id="${channel.tvgId.replaceAll('"', "&quot;")}"` : "",
      channel.tvgName ? `tvg-name="${channel.tvgName.replaceAll('"', "&quot;")}"` : "",
      channel.groupTitle ? `group-title="${channel.groupTitle.replaceAll('"', "&quot;")}"` : ""
    ].filter(Boolean).join(" ");
    lines.push(`#EXTINF:-1${attrs ? ` ${attrs}` : ""},${channel.name}`);
    lines.push(channel.url);
  }
  return `${lines.join("\n")}\n`;
}

export function summarizeLocalPlaylist(input: string): LocalPlaylistSummary {
  const parsed = parseM3UWithIssues(input);
  const groupCounts = new Map<string, number>();
  const seenUrls = new Set<string>();
  const uniqueValidChannels: M3UChannel[] = [];
  let duplicateUrls = 0;
  let invalidUrls = 0;
  let missingNames = 0;
  const issues = parsed.issues.map((issue) =>
    `${issue.line ? `Línea ${issue.line}: ` : ""}${issue.message}`
  );

  for (const channel of parsed.channels) {
    const group = channel.groupTitle?.trim() || "Sin categoría";
    groupCounts.set(group, (groupCounts.get(group) ?? 0) + 1);
    if (!channel.name.trim() || channel.name === "Unnamed Channel") missingNames++;
    if (!validHttpUrl(channel.url)) {
      invalidUrls++;
      issues.push(`Dirección no válida o no HTTP(S): ${channel.name}`);
      continue;
    }
    const normalizedUrl = channel.url.trim();
    if (seenUrls.has(normalizedUrl)) {
      duplicateUrls++;
      issues.push(`URL duplicada: ${channel.name}`);
      continue;
    }
    seenUrls.add(normalizedUrl);
    uniqueValidChannels.push({ ...channel, url: normalizedUrl });
  }

  if (parsed.channels.length === 0 && issues.length === 0) {
    issues.push("No se han encontrado canales. Comprueba que el archivo sea una lista M3U/M3U8.");
  }

  return {
    total: parsed.channels.length,
    groups: [...groupCounts.entries()]
      .map(([group, count]) => ({ group, count }))
      .sort((left, right) => left.group.localeCompare(right.group)),
    channels: parsed.channels.map((channel) => channel.name),
    duplicateUrls,
    invalidUrls,
    missingNames,
    issues: issues.slice(0, 50),
    cleanedM3U: renderPlaylist(uniqueValidChannels)
  };
}
