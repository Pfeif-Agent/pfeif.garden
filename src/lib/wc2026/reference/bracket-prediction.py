#!/usr/bin/env python3
"""
Reference implementation of the odds-seeded bracket projection.
This is the algorithm Phase 2 ports to TS (see reference/PREDICTION.md).
Run it (`python3 bracket-prediction.py`) to see the projected bracket; diff your
TS port (../bracket.ts) against this output. Reads src/data/fixtures.json for the graph.

Two inputs decide everything:
  - ranking(): how the 4 teams in a group are ordered (1st/2nd/3rd/4th)
  - winner_of(a, b): who advances in a knockout game
For the PRE-tournament projection both use pre-WC odds (lower oddsValue = stronger).
For LIVE, swap ranking() to read real group standings and winner_of() to read real
results once a match is played (see PREDICTION.md, "Live blending").
"""
import json, re, os

# minimal locked data (mirror of data/draft.ts; lower ODDS = stronger)
ODDS = {"Mexico":66,"South Africa":1000,"South Korea":250,"Czechia":250,"Canada":150,"Bosnia & Herzegovina":250,
 "Qatar":1000,"Switzerland":66,"Brazil":9,"Morocco":40,"Haiti":2500,"Scotland":250,"United States":50,"Paraguay":250,
 "Australia":500,"Türkiye":66,"Germany":14,"Curaçao":2500,"Ivory Coast":200,"Ecuador":80,"Netherlands":20,"Japan":50,
 "Sweden":100,"Tunisia":500,"Belgium":33,"Egypt":250,"Iran":500,"New Zealand":1000,"Spain":4.5,"Cape Verde":1000,
 "Saudi Arabia":1000,"Uruguay":66,"France":5,"Senegal":66,"Iraq":1000,"Norway":33,"Argentina":9,"Algeria":250,
 "Austria":150,"Jordan":1000,"Portugal":8,"DR Congo":750,"Uzbekistan":1000,"Colombia":40,"England":7,"Croatia":80,
 "Ghana":500,"Panama":1000}
HERE = os.path.dirname(__file__)
# reference/ lives at src/lib/wc2026/reference/; the data is at src/data/.
FX = json.load(open(os.path.join(HERE, "..", "..", "..", "data", "fixtures.json")))
M = {m["num"]: m for m in FX}
GROUP = {m["team1"]: m["group"] for m in FX if m["stage"] == "group"}
GROUP.update({m["team2"]: m["group"] for m in FX if m["stage"] == "group"})

# 1) group ranking (PRE: by odds). LIVE: replace with real standings ordering.
def ranking(group):
    teams = [t for t, g in GROUP.items() if g == group]
    return sorted(teams, key=lambda t: ODDS[t])          # [1st, 2nd, 3rd, 4th]
pos = {(g, i + 1): ranking(g)[i] for g in "ABCDEFGHIJKL" for i in range(4)}

# 2) best-8 third-placed teams (PRE: by odds), matched into the 3X/Y/Z slots.
thirds = sorted((ranking(g)[2] for g in "ABCDEFGHIJKL"), key=lambda t: ODDS[t])[:8]
slots = []                                               # [(code, {allowed groups})]
for m in FX:
    for c in (m["team1"], m["team2"]):
        if c.startswith("3") and "/" in c and c not in [s[0] for s in slots]:
            slots.append((c, set(c[1:].split("/"))))
assign = {}
def _match(i, used):                                     # bijective: qualifying third -> slot (group must be allowed)
    if i == len(thirds): return True
    t, g = thirds[i], GROUP[thirds[i]]
    for code, groups in slots:
        if code in used or g not in groups: continue
        used.add(code); assign[code] = t
        if _match(i + 1, used): return True
        used.discard(code); assign.pop(code, None)
    return False
assert _match(0, set()), "no valid thirds assignment (should never happen)"

# 3) knockout winner (PRE: better odds). LIVE: real result once the match is played.
def winner_of(a, b):
    return a if ODDS[a] <= ODDS[b] else b

_memo = {}
def resolve(code):                                       # slot code -> projected team
    if code in ODDS: return code
    mo = re.match(r"^([12])([A-L])$", code)
    if mo: return pos[(mo.group(2), int(mo.group(1)))]   # 1A / 2B = group winner / runner-up
    if code.startswith("3") and "/" in code: return assign[code]
    mo = re.match(r"^([WL])(\d+)$", code)                # W## / L## = winner / loser of match ##
    n = int(mo.group(2)); w = win(n)
    return w if mo.group(1) == "W" else (resolve(M[n]["team1"]) if w == resolve(M[n]["team2"]) else resolve(M[n]["team2"]))
def win(n):
    if n in _memo: return _memo[n]
    w = winner_of(resolve(M[n]["team1"]), resolve(M[n]["team2"])); _memo[n] = w; return w

if __name__ == "__main__":
    print("Projected qualifying thirds:", ", ".join(thirds))
    for n in range(73, 105):
        m = M[n]
        print(f'{n:>3} {m["round"]:<20} {resolve(m["team1"]):<14} v {resolve(m["team2"]):<14}'
              + ("  -> " + win(n) if m["round"] != "Match for third place" else ""))
    print("Projected champion:", win(104))
