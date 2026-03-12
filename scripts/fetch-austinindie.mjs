#!/usr/bin/env node
/**
 * fetch-austinindie.mjs
 * Fetches all SXSW days from austinindependentmusic.org, extracts
 * window.__remixContext, maps to SxswApp show format, writes to
 * public/data/austinindie.json for the client to auto-load.
 *
 * Usage:   node scripts/fetch-austinindie.mjs
 * Cron:    0 7 12-18 3 * cd /path/to/pfeif.garden && node scripts/fetch-austinindie.mjs && git add public/data/austinindie.json && git commit -m "chore: refresh Austin Indie data $(date +%Y-%m-%d)" && git push
 */

import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const NIGHTS = [
  "2026-03-12",
  "2026-03-13",
  "2026-03-14",
  "2026-03-15",
  "2026-03-16",
  "2026-03-17",
  "2026-03-18",
];

// ── Time parser ───────────────────────────────────────────
// Times on Austin Indie are plain strings: "1:00", "noon", "midnight", "9:30 pm"
// Heuristic for bare times (no AM/PM): 1–11 → PM, 12 → noon, 0 → midnight
function parseRemixTime(t) {
  if (!t) return null;
  const s = t.trim().toLowerCase();
  if (s === "noon") return { h: 12, m: 0 };
  if (s === "midnight") return { h: 0, m: 0 };
  const match = s.match(/^(\d{1,2})(?::(\d{2}))?(?:\s*(am|pm))?$/);
  if (!match) return null;
  let h = parseInt(match[1]);
  const m = parseInt(match[2] || "0");
  const ampm = match[3];
  if (ampm === "am") { if (h === 12) h = 0; }
  else if (ampm === "pm") { if (h !== 12) h += 12; }
  else {
    if (h >= 1 && h <= 11) h += 12;
  }
  return { h, m };
}

// ── Mapper ────────────────────────────────────────────────
function mapRemixShows(data, dateStr) {
  const shows = data?.state?.loaderData?.["routes/shows.day.$day"]?.shows || [];
  const result = [];

  for (const show of shows) {
    const venueName = show.venue?.name?.trim() || "Unknown";

    for (const set of (show.sets || [])) {
      const band = set.band?.name?.trim();
      if (!band) continue;

      const parsed = parseRemixTime(set.startTime);
      if (!parsed) continue; // skip sets with no/unparseable time

      const { h, m } = parsed;
      const tHour = h < 6 ? h + 24 : h;

      // After-midnight sets belong to the previous calendar night
      let nightDate = dateStr;
      if (h < 6) {
        const [y, mo, dy] = dateStr.split("-").map(Number);
        const prev = new Date(y, mo - 1, dy - 1);
        nightDate = `${prev.getFullYear()}-${String(prev.getMonth() + 1).padStart(2, "0")}-${String(prev.getDate()).padStart(2, "0")}`;
      }

      result.push({
        id: `austinindie-${show.id}-${set.band.id}`,
        artist: band,
        venue: venueName,
        address: "",
        date: dateStr,
        nightDate,
        startHour: h,
        startMin: m,
        duration: 40,
        startTime: `${h % 12 || 12}:${String(m).padStart(2, "0")}${h >= 12 ? "p" : "a"}`,
        genre: "Unknown",
        tHour,
        source: "austinindie",
        unofficial: true,
        url: set.band.listeningLink || undefined,
        eventName: show.headline || undefined,
        age: show.age || undefined,
        cover: show.cover || undefined,
      });
    }
  }

  return result;
}

// ── Fetch one day ─────────────────────────────────────────
async function fetchDay(date) {
  const url = `https://austinindependentmusic.org/shows/day/${date}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; pfeif.garden/1.0)" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const html = await res.text();

  const match = html.match(/window\.__remixContext\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
  if (!match) throw new Error("No __remixContext found");

  const data = JSON.parse(match[1]);
  return mapRemixShows(data, date);
}

// ── Main ──────────────────────────────────────────────────
async function main() {
  const allShows = [];
  let totalVenues = new Set();

  for (const date of NIGHTS) {
    try {
      const shows = await fetchDay(date);
      shows.forEach(s => totalVenues.add(s.venue));
      allShows.push(...shows);
      console.log(`✓ ${date}  ${shows.length} sets`);
    } catch (e) {
      console.error(`✗ ${date}  ${e.message}`);
    }
    // be polite
    await new Promise(r => setTimeout(r, 500));
  }

  const outDir = join(__dirname, "../public/data");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "austinindie.json");
  writeFileSync(outPath, JSON.stringify(allShows, null, 2));

  console.log(`\n${allShows.length} sets · ${totalVenues.size} venues · written to public/data/austinindie.json`);
}

main().catch(e => { console.error(e); process.exit(1); });
