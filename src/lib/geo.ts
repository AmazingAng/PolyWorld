import { GeoResult } from "@/types";

const GEO: Record<string, [number, number]> = {
  // Countries
  "united states": [39.8, -98.5],
  usa: [39.8, -98.5],
  china: [35.86, 104.19],
  chinese: [35.86, 104.19],
  russia: [61.52, 105.31],
  russian: [61.52, 105.31],
  ukraine: [48.37, 31.16],
  ukrainian: [48.37, 31.16],
  india: [20.59, 78.96],
  indian: [20.59, 78.96],
  brazil: [-14.23, -51.92],
  brazilian: [-14.23, -51.92],
  "united kingdom": [55.37, -3.43],
  britain: [55.37, -3.43],
  british: [55.37, -3.43],
  france: [46.22, 2.21],
  french: [46.22, 2.21],
  germany: [51.16, 10.45],
  german: [51.16, 10.45],
  japan: [36.2, 138.25],
  japanese: [36.2, 138.25],
  "south korea": [35.9, 127.76],
  korean: [35.9, 127.76],
  "north korea": [40.33, 127.51],
  iran: [32.42, 53.68],
  iranian: [32.42, 53.68],
  israel: [31.04, 34.85],
  israeli: [31.04, 34.85],
  palestine: [31.95, 35.23],
  palestinian: [31.95, 35.23],
  gaza: [31.35, 34.3],
  hamas: [31.35, 34.3],
  hezbollah: [33.87, 35.5],
  taiwan: [23.69, 120.96],
  taiwanese: [23.69, 120.96],
  mexico: [23.63, -102.55],
  mexican: [23.63, -102.55],
  canada: [56.13, -106.34],
  canadian: [56.13, -106.34],
  australia: [-25.27, 133.77],
  australian: [-25.27, 133.77],
  turkey: [38.96, 35.24],
  turkish: [38.96, 35.24],
  "saudi arabia": [23.88, 45.07],
  saudi: [23.88, 45.07],
  argentina: [-38.41, -63.61],
  nigeria: [9.08, 8.67],
  "south africa": [-30.56, 22.93],
  egypt: [26.82, 30.8],
  polish: [51.91, 19.14],
  poland: [51.91, 19.14],
  italy: [41.87, 12.56],
  italian: [41.87, 12.56],
  spain: [40.46, -3.74],
  spanish: [40.46, -3.74],
  netherlands: [52.13, 5.29],
  dutch: [52.13, 5.29],
  greenland: [71.7, -42.6],
  panama: [8.53, -80.78],
  venezuela: [6.42, -66.58],
  colombia: [4.57, -74.29],
  philippines: [12.87, 121.77],
  indonesia: [-0.78, 113.92],
  thailand: [15.87, 100.99],
  vietnam: [14.05, 108.27],
  syria: [34.8, 38.99],
  syrian: [34.8, 38.99],
  iraq: [33.22, 43.67],
  iraqi: [33.22, 43.67],
  afghanistan: [33.93, 67.7],
  pakistan: [30.37, 69.34],
  somalia: [5.15, 46.19],
  yemen: [15.55, 48.51],
  sudan: [12.86, 30.21],
  ethiopia: [9.14, 40.48],
  kenya: [-0.02, 37.9],
  congo: [-4.03, 21.75],
  myanmar: [21.91, 95.95],
  cuba: [21.52, -77.78],
  switzerland: [46.81, 8.22],
  sweden: [60.12, 18.64],
  norway: [60.47, 8.46],
  finland: [61.92, 25.74],
  denmark: [56.26, 9.5],
  portugal: [39.39, -8.22],
  greece: [39.07, 21.82],
  czech: [49.81, 15.47],
  romania: [45.94, 24.96],
  hungary: [47.16, 19.5],
  belgium: [50.5, 4.46],
  austria: [47.51, 14.55],
  ireland: [53.14, -7.69],
  scotland: [56.49, -4.2],
  "new zealand": [-40.9, 174.88],
  singapore: [1.35, 103.81],
  malaysia: [4.21, 101.97],
  chile: [-35.67, -71.54],
  peru: [-9.18, -75.01],
  ecuador: [-1.83, -78.18],
  morocco: [31.79, -7.09],
  algeria: [28.03, 1.65],
  tunisia: [33.88, 9.53],
  libya: [26.33, 17.22],
  lebanon: [33.85, 35.86],
  lebanese: [33.85, 35.86],
  jordan: [30.58, 36.23],
  qatar: [25.35, 51.18],
  kuwait: [29.31, 47.48],
  bahrain: [26.06, 50.55],
  oman: [21.47, 55.97],
  emirates: [23.42, 53.84],
  dubai: [25.2, 55.27],
  bangladesh: [23.68, 90.35],
  "sri lanka": [7.87, 80.77],
  nepal: [28.39, 84.12],
  cambodia: [12.56, 104.99],
  mongolia: [46.86, 103.84],
  kazakhstan: [48.01, 66.92],
  azerbaijan: [40.14, 47.57],
  armenia: [40.06, 45.03],
  serbia: [44.01, 21.0],
  croatia: [45.1, 15.2],
  bosnia: [43.91, 17.67],
  albania: [41.15, 20.16],
  kosovo: [42.6, 20.9],
  montenegro: [42.7, 19.37],

  // Major cities
  washington: [38.9, -77.03],
  "new york": [40.71, -74.0],
  london: [51.5, -0.12],
  beijing: [39.9, 116.4],
  moscow: [55.75, 37.61],
  kyiv: [50.45, 30.52],
  taipei: [25.03, 121.56],
  jerusalem: [31.76, 35.21],
  tehran: [35.68, 51.38],
  tokyo: [35.68, 139.69],
  berlin: [52.52, 13.4],
  paris: [48.85, 2.35],
  brussels: [50.85, 4.35],
  "hong kong": [22.39, 114.1],
  shanghai: [31.23, 121.47],
  mumbai: [19.07, 72.87],
  delhi: [28.61, 77.2],
  seoul: [37.56, 126.97],
  baghdad: [33.31, 44.36],
  riyadh: [24.71, 46.67],
  ankara: [39.93, 32.85],
  cairo: [30.04, 31.23],
  nairobi: [-1.28, 36.81],

  // Leaders
  trump: [38.9, -77.03],
  biden: [38.9, -77.03],
  kamala: [38.9, -77.03],
  desantis: [30.43, -84.28],
  newsom: [38.57, -121.49],
  vance: [38.9, -77.03],
  "xi jinping": [39.9, 116.4],
  putin: [55.75, 37.61],
  zelensky: [50.45, 30.52],
  macron: [48.85, 2.35],
  starmer: [51.5, -0.12],
  scholz: [52.52, 13.4],
  netanyahu: [31.76, 35.21],
  lula: [-15.79, -47.88],
  milei: [-34.6, -58.38],
  erdogan: [39.93, 32.85],
  trudeau: [45.42, -75.69],
  carney: [45.42, -75.69],
  poilievre: [45.42, -75.69],
  "kim jong": [39.03, 125.75],
  khamenei: [35.68, 51.38],

  // Sports leagues → host country/region
  "la liga": [40.46, -3.74],
  "premier league": [51.5, -0.12],
  "champions league": [46.22, 2.21],
  "serie a": [41.87, 12.56],
  bundesliga: [51.16, 10.45],
  "ligue 1": [48.85, 2.35],
  "world cup": [46.22, 2.21],
  "copa america": [-14.23, -51.92],
  "euro 2026": [50.85, 4.35],
  wimbledon: [51.43, -0.21],
  "french open": [48.84, 2.24],
  "australian open": [-37.82, 144.98],
  "us open": [40.75, -73.85],

  // Regions
  "european union": [50.85, 4.35],
  nato: [50.87, 4.37],
  "middle east": [29.31, 47.48],
  "latin america": [-8.78, -55.49],
  "southeast asia": [12.87, 105.72],
  africa: [8.78, 34.5],
  arctic: [71.7, -42.6],
  crimea: [44.95, 34.1],
  "strait of hormuz": [26.6, 56.25],

  // US-centric keywords
  "elon musk": [38.9, -77.03],
  democratic: [38.9, -77.03],
  democrat: [38.9, -77.03],
  republican: [38.9, -77.03],
  congress: [38.9, -77.03],
  senate: [38.9, -77.03],
  "supreme court": [38.9, -77.03],
  "federal reserve": [38.9, -77.03],
  fed: [38.9, -77.03],
  nba: [40.71, -74.0],
  nfl: [40.71, -74.0],
  mlb: [40.71, -74.0],
  nhl: [40.71, -74.0],
  "super bowl": [40.71, -74.0],
  "world series": [40.71, -74.0],
  "march madness": [40.71, -74.0],

  // US states
  california: [36.77, -119.41],
  texas: [31.96, -99.9],
  florida: [27.66, -81.51],
  pennsylvania: [41.2, -77.19],
  michigan: [44.31, -85.6],
  wisconsin: [43.78, -88.78],
  arizona: [34.04, -111.09],
  nevada: [38.8, -116.41],
  ohio: [40.41, -82.71],
  "north carolina": [35.76, -79.01],
  georgia: [32.16, -82.9],
  iowa: [41.87, -93.09],
  virginia: [37.43, -78.65],
  colorado: [39.55, -105.78],
  minnesota: [46.73, -94.68],
};

// City/leader/keyword → parent country for display purposes
const PARENT_COUNTRY: Record<string, string> = {
  washington: "United States", "new york": "United States",
  london: "United Kingdom", beijing: "China", shanghai: "China", "hong kong": "China",
  moscow: "Russia", kyiv: "Ukraine", taipei: "Taiwan",
  jerusalem: "Israel", tehran: "Iran", tokyo: "Japan",
  berlin: "Germany", paris: "France", brussels: "Belgium",
  mumbai: "India", delhi: "India", seoul: "South Korea",
  baghdad: "Iraq", riyadh: "Saudi Arabia", ankara: "Turkey",
  cairo: "Egypt", nairobi: "Kenya",
  trump: "United States", biden: "United States", kamala: "United States",
  desantis: "United States", newsom: "United States", vance: "United States",
  "elon musk": "United States",
  "xi jinping": "China", putin: "Russia", zelensky: "Ukraine",
  macron: "France", starmer: "United Kingdom", scholz: "Germany",
  netanyahu: "Israel", lula: "Brazil", milei: "Argentina",
  erdogan: "Turkey", trudeau: "Canada", carney: "Canada", poilievre: "Canada",
  "kim jong": "North Korea", khamenei: "Iran",
  gaza: "Palestine", hamas: "Palestine", hezbollah: "Lebanon",
  crimea: "Ukraine", dubai: "United Arab Emirates",
  scotland: "United Kingdom",
  california: "United States", texas: "United States", florida: "United States",
  pennsylvania: "United States", michigan: "United States", wisconsin: "United States",
  arizona: "United States", nevada: "United States", ohio: "United States",
  "north carolina": "United States", georgia: "United States", iowa: "United States",
  virginia: "United States", colorado: "United States", minnesota: "United States",
};

export function getParentCountry(location: string): string | null {
  const key = location.toLowerCase();
  return PARENT_COUNTRY[key] || null;
}

// Short keys need case-sensitive whole-word matching
const SHORT_KEYS = new Set(["us", "uk", "eu", "uae", "un"]);

// Political/generic keywords that should only match as fallback
// These map to DC/NY but are less specific than actual place names
const FALLBACK_KEYS = new Set([
  "republican", "democratic", "democrat", "congress", "senate",
  "supreme court", "federal reserve", "fed", "elon musk",
  "trump", "biden", "kamala", "vance",
  "nba", "nfl", "mlb", "nhl", "super bowl", "world series", "march madness",
]);

// Sort by length DESC so longer (more specific) keys match first
const geoKeys = Object.keys(GEO).sort((a, b) => b.length - a.length);

const regexCache = new Map<string, RegExp>();

function getRegex(key: string): RegExp {
  let rx = regexCache.get(key);
  if (!rx) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    rx = new RegExp(`\\b${escaped}\\b`, "i");
    regexCache.set(key, rx);
  }
  return rx;
}

export function geolocate(
  title: string,
  _description?: string // eslint-disable-line @typescript-eslint/no-unused-vars
): GeoResult | null {
  // Only use title for geo matching (description often contains noise)
  const text = title || "";

  let fallbackResult: GeoResult | null = null;

  // Phase 1: Match non-short keys longest-first; defer political/generic keywords
  for (const key of geoKeys) {
    if (SHORT_KEYS.has(key)) continue;
    if (!getRegex(key).test(text)) continue;

    const loc = key
      .split(" ")
      .map((w) => w[0].toUpperCase() + w.slice(1))
      .join(" ");

    if (FALLBACK_KEYS.has(key)) {
      // Save first political/generic match as fallback, keep looking for real places
      if (!fallbackResult) {
        fallbackResult = { coords: GEO[key], location: loc };
      }
      continue;
    }

    // Real geographic match — return immediately
    return { coords: GEO[key], location: loc };
  }

  // Phase 2: Fallback to short keys (US, UK, EU)
  if (/\bUS\b/.test(text) || /\bU\.S\./.test(text)) {
    return { coords: GEO["usa"], location: "United States" };
  }
  if (/\bUK\b/.test(text)) {
    return { coords: GEO["united kingdom"], location: "United Kingdom" };
  }
  if (/\bEU\b/.test(text)) {
    return { coords: GEO["european union"], location: "European Union" };
  }
  if (/\bUAE\b/.test(text)) {
    return { coords: GEO["emirates"], location: "UAE" };
  }

  // Phase 3: Use political/generic keyword match if no real place found
  return fallbackResult;
}
