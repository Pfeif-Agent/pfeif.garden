import { useState, useMemo, useCallback, useEffect, useRef } from "react";

// ── Palette ───────────────────────────────────────────────
const P = {
  black:   "#000000",
  paprika: "#E55613",
  ocean:   "#016BA8",
  jungle:  "#28A745",
  amber:   "#F9CB0C",
};

// Tag state config
const TAG_CYCLE  = { "": "interest", interest: "lock", lock: "pass", pass: "" };
const TAG_LABEL  = { interest: "INT", lock: "LOCK", pass: "PASS" };
const TAG_COLOR  = { interest: P.amber, lock: P.jungle, pass: P.paprika };

// ── ICS Parser ────────────────────────────────────────────
function parseICS(text) {
  const content = text.replace(/\r\n[ \t]/g, "").replace(/\r\n/g, "\n");
  const blocks = content.split("BEGIN:VEVENT");
  const events = [];
  const genreGuess = a => {
    const g = GENRE_MAP[a]; if (g) return g;
    for (const [k,v] of Object.entries(GENRE_MAP)) if (k.toLowerCase() === a.toLowerCase()) return v;
    return "Unknown";
  };
  for (const block of blocks.slice(1)) {
    const chunk = block.split("END:VEVENT")[0];
    const ev = {};
    for (const line of chunk.split("\n")) {
      const l = line.trim();
      if (l.startsWith("SUMMARY:")) ev.artist = l.slice(8).trim();
      else if (l.includes("DTSTART") && l.includes("TZID")) {
        const m = l.match(/(\d{8}T\d{6})/);
        if (m) { const d = pD(m[1]); ev.startHour = d.h; ev.startMin = d.m; ev.date = d.date; }
      } else if (l.includes("DTEND") && l.includes("TZID")) {
        const m = l.match(/(\d{8}T\d{6})/);
        if (m) { const d = pD(m[1]); ev.endH = d.h; ev.endM = d.m; ev.endDate = d.date; }
      } else if (l.startsWith("LOCATION:")) {
        const loc = l.slice(9).replace(/\\n/g, "\n").replace(/\\,/g, ",");
        const parts = loc.split("\n");
        let venue = parts[0].trim();
        if (venue.includes("British Music Embassy") || venue.includes("Palm Door on Sixth")) venue = "BME Palm Door";
        ev.venue = venue; ev.address = parts.slice(1).join(", ").trim();
      } else if (l.includes("URL") && l.includes("VALUE=URI:")) {
        const m = l.match(/(https?:\/\/\S+)/); if (m) ev.url = m[1];
      } else if (l.startsWith("UID:")) ev.id = l.slice(4).trim();
    }
    if (ev.artist && ev.date && ev.startHour !== undefined) {
      const sT = ev.startHour * 60 + ev.startMin;
      const eT = (ev.endH || ev.startHour) * 60 + (ev.endM || ev.startMin);
      let dur;
      if (ev.endDate && ev.endDate !== ev.date) {
        dur = (1440 - sT) + eT;
      } else {
        dur = eT - sT;
      }
      if (dur <= 0) dur = 40;
      if (dur > 720) dur = 40;
      ev.duration = dur;
      const h = ev.startHour, m = ev.startMin;
      ev.startTime = `${h % 12 || 12}:${String(m).padStart(2, "0")}${h >= 12 ? "p" : "a"}`;
      ev.genre = genreGuess(ev.artist);
      ev.tHour = h < 6 ? h + 24 : h;
      if (h < 6) {
        const [y, mo, dy] = ev.date.split("-").map(Number);
        const prev = new Date(y, mo - 1, dy - 1);
        ev.nightDate = `${prev.getFullYear()}-${String(prev.getMonth()+1).padStart(2,"0")}-${String(prev.getDate()).padStart(2,"0")}`;
      } else { ev.nightDate = ev.date; }
      delete ev.endH; delete ev.endM; delete ev.endDate;
      events.push(ev);
    }
  }
  return events.sort((a, b) => a.nightDate.localeCompare(b.nightDate) || (a.tHour * 60 + a.startMin) - (b.tHour * 60 + b.startMin));
}
function pD(s) { return { date: `${s.slice(0,4)}-${s.slice(4,6)}-${s.slice(6,8)}`, h: +s.slice(9,11), m: +s.slice(11,13) }; }

// ── Austin Independent Music __remixContext parser ───────
// Parses the window.__remixContext JSON injected into austinindependentmusic.org pages.
// Time heuristic: plain times 1–11 → PM (SXSW unofficial shows are daytime/evening);
// times 0/< 6 after-midnight stay as-is and get tHour+24 for grid ordering.
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
    // No AM/PM: 1–11 → PM, 12 → noon, 0 → midnight
    if (h >= 1 && h <= 11) h += 12;
  }
  return { h, m };
}

function mapRemixShows(data, dateStr) {
  const shows = data?.state?.loaderData?.["routes/shows.day.$day"]?.shows || [];
  const result = [];
  for (const show of shows) {
    const venueName = show.venue?.name || "Unknown";
    for (const set of (show.sets || [])) {
      const band = set.band?.name?.trim();
      if (!band) continue;
      const parsed = parseRemixTime(set.startTime);
      if (!parsed) continue;
      const { h, m } = parsed;
      const tHour = h < 6 ? h + 24 : h;
      let nightDate = dateStr;
      if (h < 6) {
        const [y, mo, dy] = dateStr.split("-").map(Number);
        const prev = new Date(y, mo - 1, dy - 1);
        nightDate = `${prev.getFullYear()}-${String(prev.getMonth()+1).padStart(2,"0")}-${String(prev.getDate()).padStart(2,"0")}`;
      }
      const id = `austinindie-${show.id}-${set.band.id}`;
      result.push({
        id, artist: band, venue: venueName, address: "",
        date: dateStr, nightDate,
        startHour: h, startMin: m, duration: 40,
        startTime: `${h % 12 || 12}:${String(m).padStart(2,"0")}${h >= 12 ? "p" : "a"}`,
        genre: "Unknown", tHour,
        source: "austinindie", unofficial: true,
        url: set.band.listeningLink || undefined,
        eventName: show.headline || undefined,
        age: show.age || undefined,
        cover: show.cover || undefined,
      });
    }
  }
  return result;
}

function extractRemixContext(html) {
  // window.__remixContext = { ... };
  const match = html.match(/window\.__remixContext\s*=\s*(\{[\s\S]*?\});\s*<\/script>/);
  if (!match) return null;
  try { return JSON.parse(match[1]); } catch { return null; }
}

// ── Genre map & colors ────────────────────────────────────
const GENRE_MAP = {"2charm":"Pop/House-Techno","60 JUNO":"Rock/Post-Punk","Adult DVD":"Dance/Rock","Agatha is Dead!":"Rock/Alternative","Alkyone":"Folk/Indie Pop","Amie Blu":"Singer-Songwriter/Indie Pop","Andrew Cushin":"Singer-Songwriter/Indie Pop","Angela Autumn":"Alt Country/Indie Rock","ARXX":"Rock/Power Pop","Bayonne":"Electronic/Pop","Big Bill":"Rock/Punk","Brainwasher":"Rock/Psychedelic","The Braymores":"Rock/Indie Rock","Buckets":"Punk/Indie Rock","The Bures Band":"Americana/Rock","Casket Cassette":"Rock/Post-Punk","Couch Dog":"Rock/Indie Rock","Creature Canyon":"Rock/Indie Rock","DOSSEY":"Rock/Punk","Dylan LeBlanc":"Americana/Indie Rock","Easy Honey":"Rock/Indie Rock","Elijah Delgado":"Rock/Indie Pop","Elijah Johnston":"Rock/Indie Rock","Eric Zayne":"Pop/R&B","FEET":"Rock/Indie Rock","Forty Feet Tall":"Punk/Post-Punk","Frankfurt Helmet":"Electronic/Indie Rock","Girl Tones":"Rock/Pop Punk","Glassio":"Electronic/Dream Pop","Gogol Bordello":"Rock/Alternative","haha Laughing":"Experimental/Hip-Hop","Hector Gannet":"Rock/Folk","Hemi Hemingway":"Pop/Indie Pop","Home Counties":"Rock/Alternative","Hot Garbage":"Rock/Psychedelic","ICHIGORINAHAMU":"Electronic/Hyperpop","IYLA":"Pop/R&B","Joe Harvey-Whyte":"Experimental/Americana","La Texana":"Rock/Alternative","Lee Bains":"Rock","Lena Dardelet":"Latin/Pop","Les Itinérantes":"Classical/Folk","Lil Asian Thiccie":"Electronic/Hyperpop","Little Guilt":"Pop/Indie Pop","Liz Cooper":"Rock/Indie Pop","Lofi Legs":"Rock/Alternative","Lola Young":"Pop","Loren Heat":"Pop","Luke Tyler Shelton":"Americana/Rock","Magnolian":"Folk/Indie Rock","Marijuana Deathsquads":"Electronic/Psychedelic","Marilina Bertoldi":"Rock/Alternative","Marry Cherry":"Rock/Alternative","Martin Eyerer":"DJ/House-Techno","Mato Wayuhi":"Pop/Hip-Hop","Mau P":"Dance","MEEK":"Pop","Michael The Lion":"DJ/Disco","Modeselektor":"DJ/Electronic","Monsieur Van Pratt":"Electronic/Disco","Night Ritualz":"Latin/Post-Punk","Nilipek.":"Singer-Songwriter/Dream Pop","NOAMZ":"Soul/Alternative","Packaging":"Pop/Psychedelic","Panam":"Rock/Indie Rock","Panic Shack":"Rock/Punk","Pink Breath of Heaven":"Rock/Shoegaze","Pretty Jane":"Rock/Indie Rock","Adult Leisure":"Rock/Alternative"};
const GC = {"Rock":"#ef4444","Punk":"#f97316","Post-Punk":"#fb923c","Alternative":"#a855f7","Indie Rock":"#ec4899","Indie Pop":"#f472b6","Pop":"#06b6d4","Electronic":"#22d3ee","Dance":"#2dd4bf","DJ":"#14b8a6","Folk":"#84cc16","Americana":"#a3e635","Singer-Songwriter":"#fbbf24","Hip-Hop":"#f59e0b","Latin":"#e879f9","Soul":"#c084fc","R&B":"#818cf8","Psychedelic":"#f43f5e","Dream Pop":"#a78bfa","Shoegaze":"#e11d48","Classical":"#fde68a","Hyperpop":"#d946ef","Disco":"#fcd34d","Alt Country":"#65a30d","Experimental":"#f87171","House-Techno":"#0ea5e9","Power Pop":"#fb7185"};
const gc = g => { if (!g) return "#555"; for (const [k, c] of Object.entries(GC)) if (g.includes(k)) return c; return "#555"; };

const NIGHTS = [
  { key: "2026-03-12", label: "Thu 3/12", day: "Thu" },
  { key: "2026-03-13", label: "Fri 3/13", day: "Fri" },
  { key: "2026-03-14", label: "Sat 3/14", day: "Sat" },
  { key: "2026-03-15", label: "Sun 3/15", day: "Sun" },
  { key: "2026-03-16", label: "Mon 3/16", day: "Mon" },
  { key: "2026-03-17", label: "Tue 3/17", day: "Tue" },
  { key: "2026-03-18", label: "Wed 3/18", day: "Wed" },
];

// ── Venue areas ───────────────────────────────────────────
// "Other" venues I'm confident about: Continental Club → South Congress
// Flagged for Jacob: Rivian Electric Roadhouse, Augustine, Wanderlust Wine Co.
const AREAS = {
  "Red River":       ["Swan Dive","The 13th Floor","Chess Club","Elysium","Mohawk","Valhalla"],
  "East 6th":        ["Hotel Vegas","Low Down Lounge","Lefty's Brick Bar","Shangri-La","Zilker Brewing","Inn Cahoots","Seven Spirits","Marlow"],
  "Dirty 6th":       ["Las Perlas","Seven Grand","BME Palm Door","Flamingo Cantina","The Creek and the Cave"],
  "Downtown":        ["Speakeasy","Central Presbyterian Church","Antone's","ACL Live Moody","Neon Grotto","Coconut Club","Downright Austin","Brushy Street Commons"],
  "South Congress":  ["Continental Club"],
  "Other":           ["Rivian Electric Roadhouse","Augustine","Wanderlust Wine Co."],
};
const areaOf = v => { for (const [a, vs] of Object.entries(AREAS)) if (vs.some(x => v.includes(x))) return a; return "Other"; };

// ── Grid constants ────────────────────────────────────────
const GRID_START = 14;
const GRID_END = 27;
const PX = 1.8;
const COL = 174;       // +16px wider than before
const TAG_W = 56;      // wide enough for "INT"/"LOCK"/"PASS" text
const ORIGIN = GRID_START * 60;
const TOTAL_PX = (GRID_END - GRID_START) * 60 * PX;
const SCROLL_8PM = (20 - GRID_START) * 60 * PX;

// ── Main App ──────────────────────────────────────────────
export default function App() {
  const [shows, setShows] = useState([]);
  const [night, setNight] = useState("2026-03-12");
  const [tags, setTags] = useState({});
  const [nightStars, setNightStars] = useState({});
  const [selected, setSelected] = useState(null);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [addForm, setAddForm] = useState(false);
  const [addData, setAddData] = useState({ artist: "", venue: "", time: "21:00", dur: "40", genre: "" });
  const fileRef = useRef(null);
  const scrollRef = useRef(null);

  // Load from storage
  useEffect(() => {
    (async () => {
      try {
        const r = await window.storage.get("sxsw-data");
        if (r?.value) {
          const d = JSON.parse(r.value);
          if (d.shows) setShows(d.shows);
          if (d.tags) setTags(d.tags);
          if (d.nightStars) setNightStars(d.nightStars);
        }
      } catch (e) {}
      setLoading(false);
    })();
  }, []);

  // Auto-load pre-fetched Austin Indie data (written daily by scripts/fetch-austinindie.mjs)
  useEffect(() => {
    fetch("/data/austinindie.json")
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (Array.isArray(data) && data.length) mergeShows(data); })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveState = useCallback(async (s, t, ns) => {
    try { await window.storage.set("sxsw-data", JSON.stringify({ shows: s, tags: t, nightStars: ns })); } catch {}
  }, []);
  useEffect(() => { if (!loading) saveState(shows, tags, nightStars); }, [shows, tags, nightStars, loading, saveState]);

  // Scroll to 8pm on night change
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = SCROLL_8PM;
  }, [night, shows.length]);

  // Additive merge
  const mergeShows = useCallback((newShows) => {
    setShows(prev => {
      const existing = new Set(prev.map(s => s.id));
      const toAdd = newShows.filter(s => !existing.has(s.id));
      const merged = [...prev, ...toAdd];
      return merged.sort((a, b) => a.nightDate.localeCompare(b.nightDate) || (a.tHour * 60 + a.startMin) - (b.tHour * 60 + b.startMin));
    });
  }, []);

  const handleFile = useCallback(async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    let parsed;
    if (file.name.endsWith(".ics")) { parsed = parseICS(text); }
    else { try { parsed = JSON.parse(text); } catch { alert("Could not parse file"); return; } }
    if (shows.length === 0) setShows(parsed);
    else mergeShows(parsed);
    const nights = [...new Set(parsed.map(s => s.nightDate))].sort();
    if (nights.length) setNight(nights[0]);
    if (fileRef.current) fileRef.current.value = "";
  }, [shows.length, mergeShows]);

  const handlePasteJSON = useCallback(async () => {
    try {
      const trimmed = pasteText.trim();
      let parsed;
      if (trimmed.startsWith("BEGIN:VCALENDAR") || trimmed.startsWith("BEGIN:VEVENT")) {
        parsed = parseICS(trimmed);
      } else if (trimmed.includes("__remixContext") || (trimmed.startsWith("<") && trimmed.includes("austinindependent"))) {
        const ctx = extractRemixContext(trimmed);
        if (!ctx) { alert("No __remixContext found in HTML. Make sure you pasted the full page source."); return; }
        const dateMatch = trimmed.match(/\/shows\/day\/(\d{4}-\d{2}-\d{2})/);
        parsed = mapRemixShows(ctx, dateMatch ? dateMatch[1] : night);
      } else { parsed = JSON.parse(trimmed); }
      if (!Array.isArray(parsed) || !parsed.length) { alert("No shows found."); return; }
      mergeShows(parsed);
      const nights = [...new Set(parsed.map(s => s.nightDate))].sort();
      if (nights.length) setNight(nights[0]);
      setShowPaste(false); setPasteText("");
    } catch (e) { alert("Could not parse. Paste valid JSON, ICS, or austinindependentmusic.org HTML."); }
  }, [pasteText, mergeShows]);

  const addShow = useCallback(() => {
    const { artist, venue, time, dur, genre } = addData;
    if (!artist.trim() || !venue.trim()) return;
    const [h, m] = time.split(":").map(Number);
    const tHour = h < 6 ? h + 24 : h;
    const id = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const show = {
      id, artist: artist.trim(), venue: venue.trim(), address: "",
      date: night, nightDate: night,
      startHour: h, startMin: m, duration: parseInt(dur) || 40,
      startTime: `${h % 12 || 12}:${String(m).padStart(2, "0")}${h >= 12 ? "p" : "a"}`,
      genre: genre.trim() || "Unknown", tHour,
      source: "manual", unofficial: true,
    };
    mergeShows([show]);
    setAddData({ artist: "", venue: "", time: "21:00", dur: "40", genre: "" });
    setAddForm(false);
  }, [addData, night, mergeShows]);

  // ── Computed ─────────────────────────────────────────────
  const nightShows = useMemo(() => {
    let s = shows.filter(x => x.nightDate === night);
    if (search) s = s.filter(x =>
      x.artist.toLowerCase().includes(search.toLowerCase()) ||
      x.venue.toLowerCase().includes(search.toLowerCase())
    );
    return s.sort((a, b) => (a.tHour * 60 + a.startMin) - (b.tHour * 60 + b.startMin));
  }, [shows, night, search]);

  const starred = useMemo(() => new Set(nightStars[night] || []), [nightStars, night]);

  const venues = useMemo(() => {
    const vs = [...new Set(nightShows.map(s => s.venue))];
    const countMap = {};
    const isUnofficial = {};
    vs.forEach(v => {
      const vShows = nightShows.filter(s => s.venue === v);
      countMap[v] = vShows.length;
      // unofficial if every show at this venue is from austinindie or manual
      isUnofficial[v] = vShows.every(s => s.source === "austinindie" || s.source === "manual");
    });

    // Tier 0: pinned (starred) — any source
    // Tier 1: official SXSW (unstarred)
    // Tier 2: AIM unofficial (unstarred)
    const tier = v => starred.has(v) ? 0 : isUnofficial[v] ? 2 : 1;

    return vs.sort((a, b) => {
      const ta = tier(a), tb = tier(b);
      if (ta !== tb) return ta - tb;
      return countMap[b] - countMap[a];
    });
  }, [nightShows, starred]);

  const toggleStar = useCallback((venue) => {
    setNightStars(prev => {
      const arr = prev[night] || [];
      const s = new Set(arr);
      s.has(venue) ? s.delete(venue) : s.add(venue);
      return { ...prev, [night]: [...s] };
    });
  }, [night]);

  // Cycle: null → interest → lock → pass → null
  const toggleTag = useCallback(id => {
    setTags(p => {
      const cur = p[id] || "";
      const next = TAG_CYCLE[cur] ?? "";
      if (!next) { const n = {...p}; delete n[id]; return n; }
      return { ...p, [id]: next };
    });
  }, []);

  const nightCounts = useMemo(() => {
    const c = {};
    shows.forEach(s => { c[s.nightDate] = (c[s.nightDate] || 0) + 1; });
    return c;
  }, [shows]);

  const nightLabel = NIGHTS.find(n => n.key === night)?.label || night;
  const starCount = starred.size;

  // ── Loading / empty states ───────────────────────────────
  if (loading) return (
    <div style={{ ...rootS, display: "flex", alignItems: "center", justifyContent: "center", height: "100vh" }}>
      <p style={{ color: "#555" }}>Loading...</p>
    </div>
  );

  if (!shows.length) return (
    <div style={{ ...rootS, display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", flexDirection: "column", gap: 16, padding: 32 }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, color: P.paprika, margin: 0 }}>SXSW 2026</h1>
      <p style={{ color: "#555", fontSize: 12, textAlign: "center", maxWidth: 420, lineHeight: 1.6 }}>
        Upload your SXSW schedule export (.ics) or a schedule.json. Friends can add their .ics files too — data merges, never overwrites.
      </p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
        <button onClick={() => fileRef.current?.click()} style={btnPrimaryS}>Upload .ics or .json</button>
        <button onClick={() => setShowPaste(p => !p)} style={btnS}>{showPaste ? "Cancel" : "Paste data"}</button>
      </div>
      {showPaste && (
        <div style={{ width: "100%", maxWidth: 500 }}>
          <textarea
            value={pasteText}
            onChange={e => setPasteText(e.target.value)}
            placeholder="Paste schedule.json, raw ICS text, or HTML from austinindependentmusic.org..."
            style={{ background: "#111", border: "1px solid #222", borderRadius: 6, padding: "10px 12px", color: "#e4e4e7", fontSize: 11, fontFamily: "inherit", outline: "none", width: "100%", height: 160, resize: "vertical", boxSizing: "border-box" }}
          />
          <button
            onClick={handlePasteJSON}
            disabled={!pasteText.trim()}
            style={{ ...btnPrimaryS, marginTop: 8, opacity: pasteText.trim() ? 1 : 0.4, width: "100%" }}
          >
            Load schedule
          </button>
        </div>
      )}
      <input ref={fileRef} type="file" accept=".ics,.json" onChange={handleFile} style={{ display: "none" }} />
      <p style={{ color: "#333", fontSize: 10, marginTop: 20 }}>Export from schedule.sxsw.com → My Schedule → Calendar Feed</p>
    </div>
  );

  // ── Hour markers ─────────────────────────────────────────
  const hours = [];
  for (let h = GRID_START; h <= GRID_END; h++) hours.push(h);

  // ── Main UI ──────────────────────────────────────────────
  return (
    <div style={rootS}>
      {/* Subtle grid bg */}
      <div style={{
        position: "fixed", inset: 0, opacity: 0.015, pointerEvents: "none",
        backgroundImage: "repeating-linear-gradient(0deg,transparent,transparent 1px,#fff 1px,#fff 2px),repeating-linear-gradient(90deg,transparent,transparent 1px,#fff 1px,#fff 2px)",
        backgroundSize: "24px 24px",
      }} />

      {/* ── Header ── */}
      <div style={{ position: "sticky", top: 0, zIndex: 50, background: P.black, borderBottom: "1px solid #1a1a1a", padding: "10px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <h1 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: P.paprika }}>SXSW 2026</h1>
          <span style={{ fontSize: 10, color: "#444", letterSpacing: "0.08em" }}>
            {nightShows.length} shows · {venues.length} venues{starCount > 0 ? ` · ${starCount}★` : ""}
          </span>
          <div style={{ flex: 1 }} />
          <input
            placeholder="Search..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={inputS}
          />
          <button onClick={() => fileRef.current?.click()} style={{ ...btnS, fontSize: 10, padding: "4px 10px" }}>+ Import</button>
          <button onClick={() => setAddForm(f => !f)} style={{ ...btnS, fontSize: 10, padding: "4px 10px", background: addForm ? "#222" : "#111" }}>+ Show</button>
          <input ref={fileRef} type="file" accept=".ics,.json" onChange={handleFile} style={{ display: "none" }} />
        </div>
        <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
          {NIGHTS.map(n => {
            const ns = (nightStars[n.key] || []).length;
            return (
              <button key={n.key} onClick={() => setNight(n.key)} style={{
                padding: "6px 12px", borderRadius: 6, border: "none", cursor: "pointer",
                fontSize: 11, fontWeight: 700, fontFamily: "inherit",
                background: night === n.key ? P.paprika : "#111",
                color: night === n.key ? "#fff" : "#555",
                transition: "background 0.15s, color 0.15s",
              }}>
                {n.day}
                <span style={{ fontSize: 10, marginLeft: 3, opacity: 0.7 }}>{nightCounts[n.key] || 0}</span>
                {ns > 0 && <span style={{ fontSize: 10, marginLeft: 2, color: P.amber }}>★</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Add show form ── */}
      {addForm && (
        <div style={{ background: "#0a0a0a", borderBottom: "1px solid #1a1a1a", padding: "10px 14px", display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <div style={lblS}>Artist</div>
            <input value={addData.artist} onChange={e => setAddData(p=>({...p, artist: e.target.value}))} placeholder="Artist name" style={{ ...inputS, width: 140 }} />
          </div>
          <div>
            <div style={lblS}>Venue</div>
            <input value={addData.venue} onChange={e => setAddData(p=>({...p, venue: e.target.value}))} placeholder="Venue" style={{ ...inputS, width: 130 }} />
          </div>
          <div>
            <div style={lblS}>Time</div>
            <input type="time" value={addData.time} onChange={e => setAddData(p=>({...p, time: e.target.value}))} style={{ ...inputS, width: 90 }} />
          </div>
          <div>
            <div style={lblS}>Min</div>
            <input type="number" value={addData.dur} onChange={e => setAddData(p=>({...p, dur: e.target.value}))} style={{ ...inputS, width: 50 }} />
          </div>
          <div>
            <div style={lblS}>Genre</div>
            <input value={addData.genre} onChange={e => setAddData(p=>({...p, genre: e.target.value}))} placeholder="Rock/Indie" style={{ ...inputS, width: 100 }} />
          </div>
          <button
            onClick={addShow}
            disabled={!addData.artist.trim() || !addData.venue.trim()}
            style={{ ...btnS, background: P.ocean, border: "none", color: "#fff", opacity: addData.artist.trim() && addData.venue.trim() ? 1 : 0.4 }}
          >
            Add to {NIGHTS.find(n=>n.key===night)?.day}
          </button>
          <button onClick={() => setAddForm(false)} style={{ ...btnS, fontSize: 10 }}>Cancel</button>
        </div>
      )}

      {/* ── Timeline grid ── */}
      <div ref={scrollRef} style={{ overflowX: "auto", overflowY: "auto", maxHeight: "calc(100vh - 90px)" }}>
        <div style={{ display: "flex", minWidth: "fit-content" }}>

          {/* Time gutter */}
          <div style={{ width: 48, flexShrink: 0, position: "sticky", left: 0, zIndex: 20, background: P.black }}>
            <div style={{ height: 48 }} />
            <div style={{ position: "relative", height: TOTAL_PX }}>
              {hours.map(h => {
                const d = h > 24 ? `${h-24}a` : h === 24 ? "12a" : h > 12 ? `${h-12}p` : h === 12 ? "12p" : `${h}a`;
                return (
                  <div key={h} style={{ position: "absolute", top: (h * 60 - ORIGIN) * PX, fontSize: 10, color: "#333", fontWeight: 600, textAlign: "right", width: 40, lineHeight: 1 }}>
                    {d}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Venue columns */}
          {venues.map(venue => {
            const vShows = nightShows.filter(s => s.venue === venue);
            const fav = starred.has(venue);
            const area = areaOf(venue);
            return (
              <div key={venue} style={{ width: COL, flexShrink: 0, borderLeft: "1px solid #111" }}>
                {/* Venue header */}
                <div
                  onClick={() => toggleStar(venue)}
                  style={{
                    height: 48, padding: "5px 7px", cursor: "pointer",
                    background: fav ? "#111" : "#0a0a0a",
                    borderBottom: "1px solid #1a1a1a",
                    borderTop: fav ? `2px solid ${P.amber}` : "2px solid transparent",
                    position: "sticky", top: 0, zIndex: 10,
                    transition: "background 0.15s, border-color 0.15s",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                    <span style={{ fontSize: 11, color: fav ? P.amber : "#333", transition: "color 0.15s" }}>{fav ? "★" : "☆"}</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: fav ? P.amber : "#aaa", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1, transition: "color 0.15s" }}>
                      {venue}
                    </span>
                  </div>
                  <div style={{ fontSize: 10, color: "#333", marginTop: 1 }}>{area} · {vShows.length}</div>
                </div>

                {/* Show tiles */}
                <div style={{ position: "relative", height: TOTAL_PX }}>
                  {hours.map(h => (
                    <div key={h} style={{ position: "absolute", top: (h * 60 - ORIGIN) * PX, width: "100%", borderTop: "1px solid #ffffff04" }} />
                  ))}
                  {vShows.map(show => {
                    const top = (show.tHour * 60 + show.startMin - ORIGIN) * PX;
                    const height = Math.max(show.duration * PX, 32);
                    const genreColor = gc(show.genre);
                    const tag = tags[show.id];
                    const isSel = selected?.id === show.id;
                    const unofficial = show.unofficial || show.source === "austinindie" || show.source === "manual";

                    // Visual state
                    let bg, borderColor, leftBarColor, textColor, subColor, opacity;
                    opacity = 1;

                    if (tag === "pass") {
                      bg = "#0a0a0a"; borderColor = "#1a1a1a"; leftBarColor = "#333";
                      textColor = "#333"; subColor = "#222"; opacity = 0.4;
                    } else if (tag === "lock") {
                      bg = `${P.jungle}1a`; borderColor = `${P.jungle}99`; leftBarColor = P.jungle;
                      textColor = "#e4e4e7"; subColor = "#888";
                    } else if (tag === "interest") {
                      bg = `${P.amber}12`; borderColor = `${P.amber}88`; leftBarColor = P.amber;
                      textColor = "#ccc"; subColor = "#666";
                    } else if (unofficial) {
                      bg = "#0d0d0d"; borderColor = "#2a2a2a"; leftBarColor = "#333";
                      textColor = "#555"; subColor = "#333";
                    } else {
                      bg = `${genreColor}08`; borderColor = `${genreColor}28`; leftBarColor = `${genreColor}55`;
                      textColor = "#777"; subColor = "#444";
                    }
                    if (isSel) { bg = tag === "lock" ? `${P.jungle}33` : tag === "interest" ? `${P.amber}22` : `${genreColor}18`; }

                    const tagColor = TAG_COLOR[tag] || "#2a2a2a";
                    const tagLabel = TAG_LABEL[tag] || "";

                    return (
                      <div
                        key={show.id}
                        style={{
                          position: "absolute", top, left: 3, right: 3, height: height - 2,
                          display: "flex", borderRadius: 4, overflow: "hidden",
                          opacity,
                          zIndex: isSel ? 5 : tag === "lock" ? 3 : tag === "pass" ? 0 : 1,
                          outline: isSel ? `2px solid ${genreColor}` : "none",
                          boxShadow: tag === "lock" ? `0 2px 10px ${P.jungle}33` : "none",
                        }}
                      >
                        {/* Main content — opens detail panel */}
                        <div
                          onClick={() => setSelected(show)}
                          style={{
                            flex: 1, minWidth: 0,
                            background: bg,
                            border: `1px solid ${borderColor}`,
                            borderLeft: `3px solid ${leftBarColor}`,
                            borderRight: "none",
                            borderTopLeftRadius: 4, borderBottomLeftRadius: 4,
                            borderTopRightRadius: 0, borderBottomRightRadius: 0,
                            padding: "3px 5px", cursor: "pointer",
                            textDecoration: tag === "pass" ? "line-through" : "none",
                            transition: "background 0.15s, border-color 0.15s, color 0.15s",
                          }}
                        >
                          <div style={{ fontSize: 11, fontWeight: tag === "lock" ? 800 : 600, color: textColor, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", transition: "color 0.15s" }}>
                            {show.artist}
                          </div>
                          {height > 40 && (
                            <div style={{ fontSize: 10, color: subColor, marginTop: 1, transition: "color 0.15s" }}>
                              {show.startTime} · {show.duration}m
                            </div>
                          )}
                        </div>
                        {/* Tag button — cycles state */}
                        <div
                          onClick={(e) => { e.stopPropagation(); toggleTag(show.id); }}
                          style={{
                            width: TAG_W, flexShrink: 0, cursor: "pointer",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            background: tag ? `${tagColor}20` : "#0a0a0a",
                            border: `1px solid ${tag ? tagColor : "#1a1a1a"}`,
                            borderLeft: "none",
                            borderTopRightRadius: 4, borderBottomRightRadius: 4,
                            fontSize: 10, fontWeight: 800, color: tag ? tagColor : "#2a2a2a",
                            letterSpacing: "0.06em",
                            userSelect: "none",
                            transition: "background 0.15s, border-color 0.15s, color 0.15s",
                          }}
                        >
                          {tagLabel || <span style={{ fontSize: 16, opacity: 0.2, fontWeight: 300 }}>·</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {!venues.length && (
            <div style={{ padding: 40, color: "#333", fontSize: 12 }}>
              No shows this night{search ? " matching your search" : ""}.
            </div>
          )}
        </div>
      </div>

      {/* ── Detail panel — always mounted, springs in/out ── */}
      <div
        style={{
          position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 100,
          height: "calc(100vh - 100px)",
          overflowY: "auto",
          background: "#080808",
          borderTop: `2px solid ${selected ? gc(selected.genre) : "transparent"}`,
          transition: "transform 0.35s cubic-bezier(0.175, 0.885, 0.32, 1.275), border-color 0.15s",
          transform: selected ? "translateY(0)" : "translateY(105%)",
          boxShadow: selected ? "0 -12px 48px rgba(0,0,0,0.9)" : "none",
        }}
      >
        {selected && (() => {
          const sMin = selected.tHour * 60 + selected.startMin;
          const sEnd = sMin + selected.duration;
          const conflicts = nightShows.filter(s =>
            s.id !== selected.id &&
            s.tHour * 60 + s.startMin < sEnd &&
            sMin < s.tHour * 60 + s.startMin + s.duration
          );
          const sameVenue = nightShows.filter(s => s.venue === selected.venue && s.id !== selected.id);
          const otherNights = shows.filter(s => s.artist === selected.artist && s.id !== selected.id);

          return (
            <div style={{ padding: "14px 14px 24px" }}>
              {/* Top row: info area + action buttons */}
              <div style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                {/* Info area — entire block links to SXSW page */}
                <a
                  href={selected.url || undefined}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    flex: 1, minWidth: 0, textDecoration: "none",
                    cursor: selected.url ? "pointer" : "default",
                    display: "block",
                  }}
                >
                  <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: "#e4e4e7" }}>{selected.artist}</h2>
                  <div style={{ fontSize: 11, color: "#555", marginTop: 2 }}>
                    <span style={{ color: gc(selected.genre), fontWeight: 700 }}>{selected.genre}</span>
                  </div>
                  <div style={{ display: "flex", gap: 24, marginTop: 10, flexWrap: "wrap" }}>
                    <div>
                      <div style={lblS}>When</div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#ccc" }}>{nightLabel} · {selected.startTime} ({selected.duration}m)</div>
                    </div>
                    <div>
                      <div style={lblS}>Where</div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#ccc" }}>{selected.venue}</div>
                      {selected.address && <div style={{ fontSize: 10, color: "#444" }}>{selected.address} · {areaOf(selected.venue)}</div>}
                      {!selected.address && <div style={{ fontSize: 10, color: "#444" }}>{areaOf(selected.venue)}</div>}
                    </div>
                  </div>
                </a>

                {/* Action buttons */}
                <div style={{ display: "flex", flexDirection: "column", gap: 5, flexShrink: 0 }}>
                  <div style={{ display: "flex", gap: 5 }}>
                    <button
                      onClick={() => toggleTag(selected.id)}
                      style={{
                        ...btnS, fontSize: 10, fontWeight: 800,
                        background: tags[selected.id] ? `${TAG_COLOR[tags[selected.id]]}18` : "#111",
                        borderColor: tags[selected.id] ? TAG_COLOR[tags[selected.id]] : "#333",
                        color: tags[selected.id] ? TAG_COLOR[tags[selected.id]] : "#666",
                      }}
                    >
                      {TAG_LABEL[tags[selected.id]] || "tag"}
                    </button>
                    <button onClick={() => setSelected(null)} style={{ ...btnS, fontSize: 14, padding: "3px 12px" }}>×</button>
                  </div>
                  {selected.url && (
                    <a
                      href={selected.url}
                      target="_blank"
                      rel="noreferrer"
                      style={{ ...btnS, textDecoration: "none", color: P.ocean, borderColor: `${P.ocean}88`, fontSize: 10, textAlign: "center", display: "block" }}
                    >
                      event website ↗
                    </a>
                  )}
                </div>
              </div>

              {/* Conflicts */}
              {conflicts.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ ...lblS, color: P.amber }}>⚡ {conflicts.length} overlapping</div>
                  {conflicts.map(s => (
                    <div key={s.id} onClick={() => setSelected(s)} style={{
                      display: "flex", alignItems: "center", gap: 8,
                      padding: "5px 8px", marginTop: 3, borderRadius: 4, cursor: "pointer",
                      background: "#0d0d0d", borderLeft: `3px solid ${gc(s.genre)}`,
                    }}>
                      <span style={{ flex: 1, fontSize: 11, fontWeight: 600, color: "#aaa" }}>{s.artist}</span>
                      <span style={{ fontSize: 10, color: "#555" }}>{s.startTime} · {s.venue}</span>
                      {tags[s.id] && <span style={{ fontSize: 10, fontWeight: 800, color: TAG_COLOR[tags[s.id]] }}>{TAG_LABEL[tags[s.id]]}</span>}
                    </div>
                  ))}                </div>
              )}

              {/* Same venue */}
              {sameVenue.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div style={lblS}>Also at {selected.venue}</div>
                  {sameVenue.map(s => (
                    <div key={s.id} onClick={() => setSelected(s)} style={{
                      display: "flex", alignItems: "center", gap: 8,
                      padding: "5px 8px", marginTop: 3, borderRadius: 4, cursor: "pointer",
                      background: "#0d0d0d", borderLeft: `3px solid ${gc(s.genre)}`,
                    }}>
                      <span style={{ flex: 1, fontSize: 11, fontWeight: 600, color: "#aaa" }}>{s.artist}</span>
                      <span style={{ fontSize: 10, color: "#555" }}>{s.startTime}</span>
                      {tags[s.id] && <span style={{ fontSize: 10, fontWeight: 800, color: TAG_COLOR[tags[s.id]] }}>{TAG_LABEL[tags[s.id]]}</span>}
                    </div>
                  ))}
                </div>
              )}

              {/* Other nights */}
              {otherNights.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div style={lblS}>Other nights</div>
                  {otherNights.map(s => (
                    <div key={s.id} onClick={() => { setNight(s.nightDate); setSelected(s); }} style={{
                      display: "flex", alignItems: "center", gap: 8,
                      padding: "5px 8px", marginTop: 3, borderRadius: 4, cursor: "pointer",
                      background: "#0d0d0d", borderLeft: `3px solid ${gc(s.genre)}`,
                    }}>
                      <span style={{ flex: 1, fontSize: 11, fontWeight: 600, color: "#aaa" }}>
                        {NIGHTS.find(n => n.key === s.nightDate)?.label || s.nightDate} · {s.venue}
                      </span>
                      <span style={{ fontSize: 10, color: "#555" }}>{s.startTime}</span>
                      {tags[s.id] && <span style={{ fontSize: 10, fontWeight: 800, color: TAG_COLOR[tags[s.id]] }}>{TAG_LABEL[tags[s.id]]}</span>}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// ── Shared style objects ──────────────────────────────────
const rootS = {
  background: P.black, color: "#e4e4e7",
  fontFamily: "'Inter', 'SF Pro Text', system-ui, sans-serif",
  minHeight: "100vh",
};
const btnS = {
  background: "#111", border: "1px solid #2a2a2a", borderRadius: 6,
  color: "#888", padding: "5px 12px", cursor: "pointer",
  fontSize: 11, fontFamily: "inherit", fontWeight: 600,
};
const btnPrimaryS = {
  ...btnS, background: P.paprika, border: `1px solid ${P.paprika}`, color: "#fff",
};
const lblS = {
  fontSize: 9, fontWeight: 700, color: "#444",
  letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 2,
};
const inputS = {
  background: "#0a0a0a", border: "1px solid #222", borderRadius: 6,
  padding: "5px 10px", color: "#e4e4e7", fontSize: 11,
  fontFamily: "inherit", outline: "none",
};
