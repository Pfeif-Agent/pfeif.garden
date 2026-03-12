import { useState, useMemo, useCallback, useEffect, useRef } from "react";

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
        // Crosses midnight: time from start to midnight + midnight to end
        dur = (1440 - sT) + eT;
      } else {
        dur = eT - sT;
      }
      // Cap clearly bogus values (>12h is probably bad data), default short ones
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

// ── Austin Independent Music HTML parser ──────────────────
// Parses the server-rendered HTML from austinindependentmusic.org/shows/day/YYYY-MM-DD
function parseAustinIndie(html, dateStr) {
  const events = [];
  // Extract date from page title if not provided: "Sat 3/7" etc
  if (!dateStr) {
    const titleMatch = html.match(/(\d{1,2})\/(\d{1,2})\s*-\s*Shows/);
    if (titleMatch) dateStr = `2026-${titleMatch[1].padStart(2,"0")}-${titleMatch[2].padStart(2,"0")}`;
    else return events;
  }
  // The page uses a table-like structure. We parse text content.
  // Strip HTML tags but keep structure via newlines
  const text = html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/tr>/gi, "\n---ROW---\n")
    .replace(/<\/td>/gi, "\t")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&").replace(/&#x27;/g, "'").replace(/&quot;/g, '"')
    .replace(/\s+/g, " ");

  // Simpler approach: find venue blocks by looking for known venue names or
  // the pattern of time entries (H:MM or "doors at H:MM")
  // Since the HTML structure is consistent, let's look for time+artist pairs per venue
  const lines = html.split(/\n/);
  let currentVenue = null;
  let lastTime = null;

  // Try to find structured data from the rendered text
  // The page has: venue name, then rows of [time, artist_name]
  const venueRegex = /class="[^"]*venue[^"]*"[^>]*>([^<]+)/gi;
  const timeRegex = /(\d{1,2}:\d{2})/;
  const artistRegex = /class="[^"]*artist[^"]*"[^>]*>([^<]+)/gi;

  // Fallback: parse the flat text for patterns
  const flat = html.replace(/<[^>]+>/g, "\n").split("\n").map(l => l.trim()).filter(Boolean);
  for (let i = 0; i < flat.length; i++) {
    const line = flat[i];
    // Venue detection: lines that are known venue names or precede time entries
    const timeParts = line.match(/^(\d{1,2}):(\d{2})$/);
    if (timeParts) {
      let h = parseInt(timeParts[1]); const m = parseInt(timeParts[2]);
      // Next non-empty line after time is likely the artist
      let artist = null;
      for (let j = i + 1; j < Math.min(i + 4, flat.length); j++) {
        const next = flat[j];
        if (next && !next.match(/^\d{1,2}:\d{2}$/) && !next.match(/^(21\+|18\+|all|free|\$\d+)$/i) && next.length > 1) {
          artist = next.replace(/\s*\(.*\)\s*$/, "").trim();
          break;
        }
      }
      if (artist && currentVenue) {
        const tHour = h < 6 ? h + 24 : h;
        let nightDate = dateStr;
        if (h < 6) {
          const [y, mo, dy] = dateStr.split("-").map(Number);
          const prev = new Date(y, mo - 1, dy - 1);
          nightDate = `${prev.getFullYear()}-${String(prev.getMonth()+1).padStart(2,"0")}-${String(prev.getDate()).padStart(2,"0")}`;
        }
        events.push({
          id: `unofficial-${currentVenue}-${h}${m}-${artist}`.replace(/\s+/g, "-").slice(0, 80),
          artist, venue: currentVenue, address: "",
          date: dateStr, nightDate, startHour: h, startMin: m,
          startTime: `${h % 12 || 12}:${String(m).padStart(2,"0")}${h >= 12 ? "p" : "a"}`,
          duration: 40, genre: "Unknown", tHour,
          source: "austinindie", unofficial: true,
        });
      }
    } else if (!line.match(/^(21\+|18\+|all|free|\$\d+|doors at|where|when|who|age|cover|prev|next|sold out)/i)
      && !line.match(/^\d{1,2}:\d{2}$/)
      && line.length > 3 && line.length < 60
      && !line.match(/^\d+$/)
      && !line.includes("week")
      && !line.includes("/shows/")) {
      // Could be a venue name — check if next lines have times
      let hasTime = false;
      for (let j = i + 1; j < Math.min(i + 8, flat.length); j++) {
        if (flat[j]?.match(/^\d{1,2}:\d{2}$/)) { hasTime = true; break; }
        if (flat[j]?.match(/^doors at/i)) { hasTime = true; break; }
      }
      if (hasTime) currentVenue = line;
    }
  }
  return events;
}

// ── Genre map & colors ────────────────────────────────────
const GENRE_MAP = {"2charm":"Pop/House-Techno","60 JUNO":"Rock/Post-Punk","Adult DVD":"Dance/Rock","Agatha is Dead!":"Rock/Alternative","Alkyone":"Folk/Indie Pop","Amie Blu":"Singer-Songwriter/Indie Pop","Andrew Cushin":"Singer-Songwriter/Indie Pop","Angela Autumn":"Alt Country/Indie Rock","ARXX":"Rock/Power Pop","Bayonne":"Electronic/Pop","Big Bill":"Rock/Punk","Brainwasher":"Rock/Psychedelic","The Braymores":"Rock/Indie Rock","Buckets":"Punk/Indie Rock","The Bures Band":"Americana/Rock","Casket Cassette":"Rock/Post-Punk","Couch Dog":"Rock/Indie Rock","Creature Canyon":"Rock/Indie Rock","DOSSEY":"Rock/Punk","Dylan LeBlanc":"Americana/Indie Rock","Easy Honey":"Rock/Indie Rock","Elijah Delgado":"Rock/Indie Pop","Elijah Johnston":"Rock/Indie Rock","Eric Zayne":"Pop/R&B","FEET":"Rock/Indie Rock","Forty Feet Tall":"Punk/Post-Punk","Frankfurt Helmet":"Electronic/Indie Rock","Girl Tones":"Rock/Pop Punk","Glassio":"Electronic/Dream Pop","Gogol Bordello":"Rock/Alternative","haha Laughing":"Experimental/Hip-Hop","Hector Gannet":"Rock/Folk","Hemi Hemingway":"Pop/Indie Pop","Home Counties":"Rock/Alternative","Hot Garbage":"Rock/Psychedelic","ICHIGORINAHAMU":"Electronic/Hyperpop","IYLA":"Pop/R&B","Joe Harvey-Whyte":"Experimental/Americana","La Texana":"Rock/Alternative","Lee Bains":"Rock","Lena Dardelet":"Latin/Pop","Les Itinérantes":"Classical/Folk","Lil Asian Thiccie":"Electronic/Hyperpop","Little Guilt":"Pop/Indie Pop","Liz Cooper":"Rock/Indie Pop","Lofi Legs":"Rock/Alternative","Lola Young":"Pop","Loren Heat":"Pop","Luke Tyler Shelton":"Americana/Rock","Magnolian":"Folk/Indie Rock","Marijuana Deathsquads":"Electronic/Psychedelic","Marilina Bertoldi":"Rock/Alternative","Marry Cherry":"Rock/Alternative","Martin Eyerer":"DJ/House-Techno","Mato Wayuhi":"Pop/Hip-Hop","Mau P":"Dance","MEEK":"Pop","Michael The Lion":"DJ/Disco","Modeselektor":"DJ/Electronic","Monsieur Van Pratt":"Electronic/Disco","Night Ritualz":"Latin/Post-Punk","Nilipek.":"Singer-Songwriter/Dream Pop","NOAMZ":"Soul/Alternative","Packaging":"Pop/Psychedelic","Panam":"Rock/Indie Rock","Panic Shack":"Rock/Punk","Pink Breath of Heaven":"Rock/Shoegaze","Pretty Jane":"Rock/Indie Rock","Adult Leisure":"Rock/Alternative"};
const GC = {"Rock":"#ef4444","Punk":"#f97316","Post-Punk":"#fb923c","Alternative":"#a855f7","Indie Rock":"#ec4899","Indie Pop":"#f472b6","Pop":"#06b6d4","Electronic":"#22d3ee","Dance":"#2dd4bf","DJ":"#14b8a6","Folk":"#84cc16","Americana":"#a3e635","Singer-Songwriter":"#fbbf24","Hip-Hop":"#f59e0b","Latin":"#e879f9","Soul":"#c084fc","R&B":"#818cf8","Psychedelic":"#f43f5e","Dream Pop":"#a78bfa","Shoegaze":"#e11d48","Classical":"#fde68a","Hyperpop":"#d946ef","Disco":"#fcd34d","Alt Country":"#65a30d","Experimental":"#f87171","House-Techno":"#0ea5e9","Power Pop":"#fb7185"};
const gc = g => { if (!g) return "#6b7280"; for (const [k, c] of Object.entries(GC)) if (g.includes(k)) return c; return "#6b7280"; };

const NIGHTS = [
  { key: "2026-03-12", label: "Thu 3/12", day: "Thu" },
  { key: "2026-03-13", label: "Fri 3/13", day: "Fri" },
  { key: "2026-03-14", label: "Sat 3/14", day: "Sat" },
  { key: "2026-03-15", label: "Sun 3/15", day: "Sun" },
  { key: "2026-03-16", label: "Mon 3/16", day: "Mon" },
  { key: "2026-03-17", label: "Tue 3/17", day: "Tue" },
  { key: "2026-03-18", label: "Wed 3/18", day: "Wed" },
];

const AREAS = {
  "Red River": ["Swan Dive","The 13th Floor","Chess Club","Elysium","Mohawk","Valhalla"],
  "East 6th": ["Hotel Vegas","Low Down Lounge","Lefty's Brick Bar","Shangri-La","Zilker Brewing","Inn Cahoots","Seven Spirits","Marlow"],
  "Dirty 6th/7th": ["Las Perlas","Seven Grand","BME Palm Door","Flamingo Cantina","The Creek and the Cave"],
  "Downtown": ["Speakeasy","Central Presbyterian Church","Antone's","ACL Live Moody","Neon Grotto","Coconut Club","Downright Austin","Brushy Street Commons"],
  "Other": ["Continental Club","Rivian Electric Roadhouse","Augustine","Wanderlust Wine Co."],
};
const areaOf = v => { for (const [a, vs] of Object.entries(AREAS)) if (vs.some(x => v.includes(x))) return a; return "Other"; };

// Fixed grid: 2pm (14) to 3am (27)
const GRID_START = 14;
const GRID_END = 27;
const PX = 1.8;
const COL = 158;
const ORIGIN = GRID_START * 60;
const TOTAL_PX = (GRID_END - GRID_START) * 60 * PX;
const SCROLL_8PM = (20 - GRID_START) * 60 * PX; // default scroll offset

// ── Main App ──────────────────────────────────────────────
export default function App() {
  const [shows, setShows] = useState([]);
  const [night, setNight] = useState("2026-03-12");
  const [tags, setTags] = useState({});
  // Per-night venue stars: { "2026-03-15": ["Swan Dive","Mohawk"], ... }
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
      } catch (e) { /* first load */ }
      setLoading(false);
    })();
  }, []);

  // Save all state in one key to minimize storage calls
  const saveState = useCallback(async (s, t, ns) => {
    try { await window.storage.set("sxsw-data", JSON.stringify({ shows: s, tags: t, nightStars: ns })); } catch {}
  }, []);
  useEffect(() => { if (!loading) saveState(shows, tags, nightStars); }, [shows, tags, nightStars, loading, saveState]);

  // Scroll to 8pm on night change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = SCROLL_8PM;
    }
  }, [night, shows.length]);

  // ADDITIVE import - merge new shows, don't overwrite
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
    if (shows.length === 0) {
      setShows(parsed); // first load: set directly
    } else {
      mergeShows(parsed); // subsequent: merge
    }
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
      } else if (trimmed.includes("austinindependentmusic") || (trimmed.includes("<") && trimmed.includes("Shows"))) {
        // Detect Austin Indie HTML - try to extract date from URL or content
        const dateMatch = trimmed.match(/(\d{4}-\d{2}-\d{2})/);
        parsed = parseAustinIndie(trimmed, dateMatch ? dateMatch[1] : null);
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

  // ── Computed ────────────────────────────────────────────
  const nightShows = useMemo(() => {
    let s = shows.filter(x => x.nightDate === night);
    if (search) s = s.filter(x => x.artist.toLowerCase().includes(search.toLowerCase()) || x.venue.toLowerCase().includes(search.toLowerCase()));
    return s.sort((a, b) => (a.tHour * 60 + a.startMin) - (b.tHour * 60 + b.startMin));
  }, [shows, night, search]);

  const starred = useMemo(() => new Set(nightStars[night] || []), [nightStars, night]);

  const venues = useMemo(() => {
    const vs = [...new Set(nightShows.map(s => s.venue))];
    const countMap = {};
    vs.forEach(v => { countMap[v] = nightShows.filter(s => s.venue === v).length; });
    return vs.sort((a, b) => {
      const fa = starred.has(a) ? 0 : 1, fb = starred.has(b) ? 0 : 1;
      if (fa !== fb) return fa - fb;
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

  const toggleTag = useCallback(id => {
    setTags(p => {
      const c = p[id];
      if (!c) return { ...p, [id]: "interested" };
      if (c === "interested") return { ...p, [id]: "must" };
      if (c === "must") return { ...p, [id]: "dismissed" };
      const n = { ...p }; delete n[id]; return n;
    });
  }, []);

  const nightCounts = useMemo(() => {
    const c = {};
    shows.forEach(s => { c[s.nightDate] = (c[s.nightDate] || 0) + 1; });
    return c;
  }, [shows]);

  const nightLabel = NIGHTS.find(n => n.key === night)?.label || night;
  const starCount = starred.size;

  // ── Empty state ─────────────────────────────────────────
  if (loading) return <div style={{ ...root, display: "flex", alignItems: "center", justifyContent: "center", height: "100vh" }}><p style={{ color: "#71717a" }}>Loading...</p></div>;

  if (!shows.length) return (
    <div style={{ ...root, display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", flexDirection: "column", gap: 16, padding: 32 }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, background: "linear-gradient(135deg,#f97316,#ef4444,#ec4899)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", margin: 0 }}>SXSW 2026</h1>
      <p style={{ color: "#71717a", fontSize: 13, textAlign: "center", maxWidth: 420, lineHeight: 1.6 }}>
        Upload your SXSW schedule export (.ics) or a schedule.json. Friends can add their .ics files too — data merges, never overwrites.
      </p>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "center" }}>
        <button onClick={() => fileRef.current?.click()} style={btnPrimary}>Upload .ics or .json</button>
        <button onClick={() => setShowPaste(p => !p)} style={btn}>{showPaste ? "Cancel" : "Paste data"}</button>
      </div>
      {showPaste && (
        <div style={{ width: "100%", maxWidth: 500 }}>
          <textarea value={pasteText} onChange={e => setPasteText(e.target.value)} placeholder={"Paste schedule.json, raw ICS text, or HTML from austinindependentmusic.org..."} style={{ background: "#18181b", border: "1px solid #27272a", borderRadius: 6, padding: "10px 12px", color: "#e4e4e7", fontSize: 11, fontFamily: "inherit", outline: "none", width: "100%", height: 160, resize: "vertical", boxSizing: "border-box" }} />
          <button onClick={handlePasteJSON} disabled={!pasteText.trim()} style={{ ...btnPrimary, marginTop: 8, opacity: pasteText.trim() ? 1 : 0.4, width: "100%" }}>Load schedule</button>
        </div>
      )}
      <input ref={fileRef} type="file" accept=".ics,.json" onChange={handleFile} style={{ display: "none" }} />
      <p style={{ color: "#3f3f46", fontSize: 10, marginTop: 20 }}>Export from schedule.sxsw.com → My Schedule → Calendar Feed</p>
    </div>
  );

  // ── Hours for grid ──────────────────────────────────────
  const hours = [];
  for (let h = GRID_START; h <= GRID_END; h++) hours.push(h);

  // ── Main UI ─────────────────────────────────────────────
  return (
    <div style={root}>
      <div style={{ position: "fixed", inset: 0, opacity: 0.015, pointerEvents: "none", backgroundImage: "repeating-linear-gradient(0deg,transparent,transparent 1px,#fff 1px,#fff 2px),repeating-linear-gradient(90deg,transparent,transparent 1px,#fff 1px,#fff 2px)", backgroundSize: "24px 24px" }} />

      {/* Header */}
      <div style={{ position: "sticky", top: 0, zIndex: 50, background: "#09090b", borderBottom: "1px solid #27272a", padding: "10px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
          <h1 style={{ margin: 0, fontSize: 16, fontWeight: 800, background: "linear-gradient(135deg,#f97316,#ef4444,#ec4899)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>SXSW 2026</h1>
          <span style={{ fontSize: 10, color: "#52525b", letterSpacing: "0.08em" }}>
            {nightShows.length} shows · {venues.length} venues{starCount > 0 ? ` · ${starCount}★` : ""}
          </span>
          <div style={{ flex: 1 }} />
          <input placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} style={inputStyle} />
          <button onClick={() => fileRef.current?.click()} style={{ ...btn, fontSize: 10, padding: "4px 10px" }}>+ Import</button>
          <button onClick={() => setAddForm(f => !f)} style={{ ...btn, fontSize: 10, padding: "4px 10px", background: addForm ? "#3f3f46" : "#27272a" }}>+ Show</button>
          <input ref={fileRef} type="file" accept=".ics,.json" onChange={handleFile} style={{ display: "none" }} />
        </div>
        <div style={{ display: "flex", gap: 3 }}>
          {NIGHTS.map(n => {
            const ns = (nightStars[n.key] || []).length;
            return (
              <button key={n.key} onClick={() => setNight(n.key)} style={{
                padding: "6px 12px", borderRadius: 6, border: "none", cursor: "pointer", fontSize: 11, fontWeight: 700, fontFamily: "inherit",
                background: night === n.key ? "linear-gradient(135deg,#f97316,#ef4444)" : "#18181b",
                color: night === n.key ? "#fff" : "#71717a", transition: "all 0.15s",
              }}>
                {n.day}<span style={{ fontSize: 8, marginLeft: 3, opacity: 0.7 }}>{nightCounts[n.key] || 0}</span>
                {ns > 0 && <span style={{ fontSize: 7, marginLeft: 2, color: night === n.key ? "#fde68a" : "#f97316" }}>★</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Add show form */}
      {addForm && (
        <div style={{ background: "#111113", borderBottom: "1px solid #27272a", padding: "10px 14px", display: "flex", gap: 6, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <div style={lbl}>Artist</div>
            <input value={addData.artist} onChange={e => setAddData(p => ({...p, artist: e.target.value}))} placeholder="Artist name" style={{ ...inputStyle, width: 140 }} />
          </div>
          <div>
            <div style={lbl}>Venue</div>
            <input value={addData.venue} onChange={e => setAddData(p => ({...p, venue: e.target.value}))} placeholder="Venue" style={{ ...inputStyle, width: 130 }} />
          </div>
          <div>
            <div style={lbl}>Time</div>
            <input type="time" value={addData.time} onChange={e => setAddData(p => ({...p, time: e.target.value}))} style={{ ...inputStyle, width: 90 }} />
          </div>
          <div>
            <div style={lbl}>Min</div>
            <input type="number" value={addData.dur} onChange={e => setAddData(p => ({...p, dur: e.target.value}))} style={{ ...inputStyle, width: 50 }} />
          </div>
          <div>
            <div style={lbl}>Genre</div>
            <input value={addData.genre} onChange={e => setAddData(p => ({...p, genre: e.target.value}))} placeholder="Rock/Indie" style={{ ...inputStyle, width: 100 }} />
          </div>
          <button onClick={addShow} disabled={!addData.artist.trim() || !addData.venue.trim()} style={{ ...btn, background: "#7c3aed", borderColor: "#7c3aed", color: "#fff", opacity: addData.artist.trim() && addData.venue.trim() ? 1 : 0.4 }}>Add to {NIGHTS.find(n=>n.key===night)?.day}</button>
          <button onClick={() => setAddForm(false)} style={{ ...btn, fontSize: 10 }}>Cancel</button>
          <span style={{ fontSize: 9, color: "#52525b", marginLeft: 4 }}>Or paste austinindependentmusic.org HTML via Import → Paste</span>
        </div>
      )}

      {/* Timeline */}
      <div ref={scrollRef} style={{ overflowX: "auto", overflowY: "auto", maxHeight: "calc(100vh - 90px)" }}>
        <div style={{ display: "flex", minWidth: "fit-content" }}>
          {/* Time gutter */}
          <div style={{ width: 48, flexShrink: 0, position: "sticky", left: 0, zIndex: 20, background: "#09090b" }}>
            <div style={{ height: 48 }} />
            <div style={{ position: "relative", height: TOTAL_PX }}>
              {hours.map(h => {
                const d = h > 24 ? `${h-24}a` : h === 24 ? "12a" : h > 12 ? `${h-12}p` : h === 12 ? "12p" : `${h}a`;
                return <div key={h} style={{ position: "absolute", top: (h * 60 - ORIGIN) * PX, fontSize: 10, color: "#3f3f46", fontWeight: 600, textAlign: "right", width: 40, lineHeight: "1" }}>{d}</div>;
              })}
            </div>
          </div>

          {/* Venue columns */}
          {venues.map(venue => {
            const vShows = nightShows.filter(s => s.venue === venue);
            const fav = starred.has(venue);
            const area = areaOf(venue);
            return (
              <div key={venue} style={{ width: COL, flexShrink: 0, borderLeft: "1px solid #1a1a1e" }}>
                <div onClick={() => toggleStar(venue)} style={{
                  height: 48, padding: "5px 7px", cursor: "pointer",
                  background: fav ? "#1c1917" : "#0c0c0f", borderBottom: "1px solid #27272a",
                  borderTop: fav ? "2px solid #f97316" : "2px solid transparent",
                  position: "sticky", top: 0, zIndex: 10,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 3 }}>
                    <span style={{ fontSize: 11 }}>{fav ? "★" : "☆"}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, color: fav ? "#f97316" : "#d4d4d8", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1 }}>{venue}</span>
                  </div>
                  <div style={{ fontSize: 9, color: "#3f3f46", marginTop: 1 }}>{area} · {vShows.length}</div>
                </div>

                <div style={{ position: "relative", height: TOTAL_PX }}>
                  {hours.map(h => (
                    <div key={h} style={{ position: "absolute", top: (h * 60 - ORIGIN) * PX, width: "100%", borderTop: "1px solid #ffffff05" }} />
                  ))}
                  {vShows.map(show => {
                    const top = (show.tHour * 60 + show.startMin - ORIGIN) * PX;
                    const height = Math.max(show.duration * PX, 30);
                    const color = gc(show.genre);
                    const tag = tags[show.id];
                    const isSel = selected?.id === show.id;
                    const unofficial = show.unofficial || show.source === "austinindie" || show.source === "manual";

                    // Visual hierarchy
                    let bg, border, borderL, textColor, subColor, opacity;
                    opacity = 1;
                    if (tag === "dismissed") {
                      bg = "#111113"; border = "1px solid #1e1e22"; borderL = "3px solid #27272a";
                      textColor = "#3f3f46"; subColor = "#27272a"; opacity = 0.5;
                    } else if (tag === "must") {
                      bg = `${color}dd`; border = `1px solid ${color}`; borderL = `3px solid ${color}`;
                      textColor = "#fff"; subColor = "#ffffffbb";
                    } else if (tag === "interested") {
                      bg = `${color}25`; border = `1px solid ${color}66`; borderL = `3px solid ${color}`;
                      textColor = "#e4e4e7"; subColor = "#a1a1aa";
                    } else if (unofficial) {
                      bg = "#18181b"; border = "1px dashed #3f3f46"; borderL = "3px dashed #52525b";
                      textColor = "#71717a"; subColor = "#52525b";
                    } else {
                      bg = `${color}08`; border = `1px solid ${color}22`; borderL = `3px solid ${color}44`;
                      textColor = "#a1a1aa"; subColor = "#52525b";
                    }
                    if (isSel && tag !== "dismissed") { bg = tag === "must" ? `${color}ee` : `${color}35`; }

                    const tagIcon = tag === "must" ? "★" : tag === "interested" ? "☆" : tag === "dismissed" ? "✕" : "";

                    return (
                      <div key={show.id} style={{
                        position: "absolute", top, left: 3, right: 3, height: height - 2,
                        display: "flex", borderRadius: 4, overflow: "hidden",
                        opacity, zIndex: isSel ? 5 : tag === "must" ? 3 : tag === "dismissed" ? 0 : 1,
                        outline: isSel ? `2px solid ${color}` : "none",
                        transition: "opacity 0.15s",
                        boxShadow: tag === "must" ? `0 2px 8px ${color}44` : "none",
                      }}>
                        {/* Main show area - opens detail */}
                        <div onClick={() => setSelected(show)} style={{
                          flex: 1, minWidth: 0,
                          background: bg, border, borderLeft: borderL,
                          borderRight: "none", borderTopRightRadius: 0, borderBottomRightRadius: 0,
                          borderTopLeftRadius: 4, borderBottomLeftRadius: 4,
                          padding: "3px 5px", cursor: "pointer",
                          textDecoration: tag === "dismissed" ? "line-through" : "none",
                        }}>
                          <div style={{ fontSize: 10, fontWeight: tag === "must" ? 800 : 700, color: textColor, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {show.artist}
                            {unofficial && !tag && <span style={{ fontSize: 7, color: "#52525b", fontStyle: "italic", marginLeft: 3 }}>u</span>}
                          </div>
                          {height > 38 && <div style={{ fontSize: 9, color: subColor, marginTop: 1 }}>{show.startTime} · {show.duration}m</div>}
                        </div>
                        {/* Tag zone - cycles state */}
                        <div onClick={(e) => { e.stopPropagation(); toggleTag(show.id); }} style={{
                          width: 26, flexShrink: 0, cursor: "pointer",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          background: tag === "must" ? `${color}cc` : tag === "interested" ? `${color}18` : tag === "dismissed" ? "#1a1a1e" : "#ffffff06",
                          borderTop: border, borderRight: border, borderBottom: border,
                          borderTopRightRadius: 4, borderBottomRightRadius: 4,
                          fontSize: 12, color: tag === "must" ? "#fff" : tag === "interested" ? color : tag === "dismissed" ? "#3f3f46" : "#3f3f46",
                          transition: "background 0.1s",
                        }}>
                          {tagIcon || <span style={{ fontSize: 8, opacity: 0.4 }}>·</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {!venues.length && <div style={{ padding: 40, color: "#52525b", fontSize: 12 }}>No shows this night{search ? " matching your search" : ""}.</div>}
        </div>
      </div>

      {/* Detail panel */}
      {selected && (
        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 100, background: "#18181b", borderTop: `2px solid ${gc(selected.genre)}`, padding: "12px 14px", boxShadow: "0 -8px 32px rgba(0,0,0,0.7)", maxHeight: "42vh", overflowY: "auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>{selected.artist}</h2>
              <div style={{ fontSize: 11, color: "#a1a1aa", marginTop: 2 }}>
                <span style={{ color: gc(selected.genre), fontWeight: 600 }}>{selected.genre}</span>
              </div>
            </div>
            <div style={{ display: "flex", gap: 5 }}>
              <button onClick={() => toggleTag(selected.id)} style={{ ...btn, background: tags[selected.id] === "must" ? "#92400e" : tags[selected.id] === "dismissed" ? "#1c1917" : "#27272a", fontSize: 10 }}>
                {tags[selected.id] === "must" ? "★ Locked" : tags[selected.id] === "interested" ? "☆ Interested" : tags[selected.id] === "dismissed" ? "✕ Dismissed" : "Tag"}
              </button>
              {selected.url && <a href={selected.url} target="_blank" rel="noreferrer" style={{ ...btn, textDecoration: "none", color: "#a1a1aa", fontSize: 10 }}>↗</a>}
              <button onClick={() => setSelected(null)} style={{ ...btn, fontSize: 13, padding: "3px 10px" }}>×</button>
            </div>
          </div>
          <div style={{ display: "flex", gap: 20, marginTop: 8, flexWrap: "wrap" }}>
            <div><div style={lbl}>When</div><div style={{ fontSize: 13, fontWeight: 600 }}>{nightLabel} · {selected.startTime} ({selected.duration}m)</div></div>
            <div><div style={lbl}>Where</div><div style={{ fontSize: 13, fontWeight: 600 }}>{selected.venue}</div><div style={{ fontSize: 10, color: "#52525b" }}>{selected.address} · {areaOf(selected.venue)}</div></div>
          </div>
          {/* Conflicts */}
          {(() => {
            const sMin = selected.tHour * 60 + selected.startMin, sEnd = sMin + selected.duration;
            const conflicts = nightShows.filter(s => s.id !== selected.id && s.tHour * 60 + s.startMin < sEnd && sMin < s.tHour * 60 + s.startMin + s.duration);
            if (!conflicts.length) return null;
            return (
              <div style={{ marginTop: 10 }}>
                <div style={{ ...lbl, color: "#fbbf24" }}>⚡ {conflicts.length} overlapping</div>
                {conflicts.map(s => (
                  <div key={s.id} onClick={() => setSelected(s)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 7px", marginTop: 2, borderRadius: 4, background: "#1c1917", border: "1px solid #292524", cursor: "pointer" }}>
                    <div style={{ width: 3, height: 18, borderRadius: 2, background: gc(s.genre) }} />
                    <span style={{ fontSize: 10, fontWeight: 600, flex: 1 }}>{s.artist}</span>
                    <span style={{ fontSize: 9, color: "#71717a" }}>{s.startTime} · {s.venue}</span>
                    {tags[s.id] === "must" && <span style={{ color: "#fbbf24", fontSize: 9 }}>★</span>}
                  </div>
                ))}
              </div>
            );
          })()}
          {/* Same venue */}
          {(() => {
            const same = nightShows.filter(s => s.venue === selected.venue && s.id !== selected.id);
            if (!same.length) return null;
            return (
              <div style={{ marginTop: 10 }}>
                <div style={lbl}>Also at {selected.venue}</div>
                {same.map(s => (
                  <div key={s.id} onClick={() => setSelected(s)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 7px", marginTop: 2, borderRadius: 4, background: "#111113", border: "1px solid #27272a", cursor: "pointer" }}>
                    <div style={{ width: 3, height: 18, borderRadius: 2, background: gc(s.genre) }} />
                    <span style={{ fontSize: 10, fontWeight: 600, flex: 1 }}>{s.artist}</span>
                    <span style={{ fontSize: 9, color: "#71717a" }}>{s.startTime} · {s.duration}m</span>
                    {tags[s.id] === "must" && <span style={{ color: "#fbbf24", fontSize: 9 }}>★</span>}
                  </div>
                ))}
              </div>
            );
          })()}
          {/* Other nights for this artist */}
          {(() => {
            const all = shows.filter(s => s.artist === selected.artist && s.id !== selected.id);
            if (!all.length) return null;
            return (
              <div style={{ marginTop: 10 }}>
                <div style={lbl}>Other {selected.artist} shows</div>
                {all.map(s => {
                  const nl = NIGHTS.find(n => n.key === s.nightDate)?.label || s.nightDate;
                  return (
                    <div key={s.id} onClick={() => { setNight(s.nightDate); setSelected(s); }} style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 7px", marginTop: 2, borderRadius: 4, background: "#111113", border: "1px solid #27272a", cursor: "pointer" }}>
                      <div style={{ width: 3, height: 18, borderRadius: 2, background: gc(s.genre) }} />
                      <span style={{ fontSize: 10, fontWeight: 600, flex: 1 }}>{nl} · {s.startTime}</span>
                      <span style={{ fontSize: 9, color: "#71717a" }}>{s.venue}</span>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

const root = { fontFamily: "'SF Mono','JetBrains Mono','Fira Code',monospace", background: "#09090b", color: "#e4e4e7", minHeight: "100vh" };
const btn = { background: "#27272a", border: "1px solid #3f3f46", borderRadius: 5, color: "#d4d4d8", padding: "5px 12px", fontSize: 11, fontWeight: 600, fontFamily: "inherit", cursor: "pointer" };
const btnPrimary = { ...btn, background: "linear-gradient(135deg,#f97316,#ef4444)", border: "none", color: "#fff", padding: "10px 24px", fontSize: 13 };
const lbl = { fontSize: 9, color: "#52525b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 2 };
const inputStyle = { background: "#18181b", border: "1px solid #27272a", borderRadius: 6, padding: "5px 10px", color: "#e4e4e7", fontSize: 11, fontFamily: "inherit", outline: "none", width: 140 };
