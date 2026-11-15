const { State, City } = require("country-state-city");
const fs = require("fs");

// extra well-known towns for sparse UTs (merged + de-duped with the dataset)
const EXTRA = {
  "Ladakh": ["Leh","Kargil","Diskit","Padum","Nubra","Khaltse","Nyoma","Drass","Turtuk","Hanle","Choglamsar","Sankoo","Zanskar","Shey","Thiksey"],
  "Lakshadweep": ["Kavaratti","Agatti","Amini","Andrott","Kadmat","Kalpeni","Kiltan","Minicoy","Bitra","Chetlat","Bangaram"],
  "Andaman and Nicobar Islands": ["Port Blair","Bombooflat","Garacharama","Diglipur","Rangat","Mayabunder","Car Nicobar","Havelock Island","Neil Island","Campbell Bay","Little Andaman","Hut Bay"],
};

const states = State.getStatesOfCountry("IN").map(s => s.name).sort((a,b)=>a.localeCompare(b));
const out = {};
for (const s of State.getStatesOfCountry("IN")) {
  const ds = City.getCitiesOfState("IN", s.isoCode).map(c => c.name.trim());
  const extra = EXTRA[s.name] || [];
  const seen = new Map(); // lowercase -> original (first wins)
  for (const name of [...ds, ...extra]) {
    const key = name.toLowerCase();
    if (name && !seen.has(key)) seen.set(key, name);
  }
  out[s.name] = [...seen.values()].sort((a,b)=>a.localeCompare(b));
}

const total = Object.values(out).reduce((n,a)=>n+a.length,0);
const header = `// Exhaustive India state -> cities dataset (static, homogeneous values). ${total} cities.
// Generated from the country-state-city dataset (ISO-3166-2 IN), with a few sparse
// union territories hand-augmented. Regenerate with scripts/gen-india-cities if it drifts.
// A "city" question also offers an "Other" option so a missing town never blocks anyone.
`;
const statesLine = `export const INDIA_STATES: string[] = ${JSON.stringify(states)};\n\n`;
const citiesLine = `export const STATE_CITIES: Record<string, string[]> = ${JSON.stringify(out)};\n`;
fs.writeFileSync("/home/claude/vedam-superapp/src/lib/india-cities.ts", header + "\n" + statesLine + citiesLine);
console.log("wrote india-cities.ts; states:", states.length, "total cities:", total);
console.log("Ladakh:", out["Ladakh"].length, "| Lakshadweep:", out["Lakshadweep"].length, "| Sikkim:", out["Sikkim"].length, "| Andaman:", out["Andaman and Nicobar Islands"].length);
console.log("Kathua present in J&K:", out["Jammu and Kashmir"].includes("Kathua"), "| KathUrban glitch gone:", !JSON.stringify(out).includes("KathUrban"));
