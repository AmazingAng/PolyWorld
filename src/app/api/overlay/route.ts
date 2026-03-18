import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

// ---------------------------------------------------------------------------
// Wikidata SPARQL — shared helper
// centroidOffset: [dLon, dLat] added to country-centroid fallback points so
// different layers sharing the same country don't stack on identical pixels.
// ---------------------------------------------------------------------------
async function wikidataSPARQL(
  sparql: string,
  labelKey: string,
  logTag: string,
  centroidOffset: [number, number] = [0, 0],
): Promise<GeoJSON.FeatureCollection> {
  const url = `https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(sparql)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "polyworld/1.0" },
    next: { revalidate: 3600 },
  });
  if (!res.ok) { console.error(`[overlay] Wikidata ${logTag} ${res.status}`); return EMPTY; }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const bindings: any[] = (await res.json())?.results?.bindings ?? [];
  const seenLabel = new Set<string>();
  const features: GeoJSON.Feature[] = [];
  for (const r of bindings) {
    const label: string = r[labelKey]?.value ?? "";
    if (!label || seenLabel.has(label)) continue;
    seenLabel.add(label);
    const coordStr: string = r.coord?.value ?? "";
    const alpha2: string = (r.alpha2?.value ?? "").toUpperCase();
    const m = coordStr.match(/Point\(([^ ]+) ([^ ]+)\)/);
    if (m) {
      // Exact Wikidata coordinate — use as-is (no offset; already precise)
      features.push({ type: "Feature", geometry: { type: "Point", coordinates: [parseFloat(m[1]), parseFloat(m[2])] }, properties: { title: label, country: alpha2 } });
    } else if (alpha2 && CENTROIDS[alpha2]) {
      // Country-centroid fallback — apply layer offset so layers don't overlap
      const [baseLon, baseLat] = CENTROIDS[alpha2];
      features.push({ type: "Feature", geometry: { type: "Point", coordinates: [baseLon + centroidOffset[0], baseLat + centroidOffset[1]] }, properties: { title: label, country: alpha2 } });
    }
  }
  console.log(`[overlay] Wikidata ${logTag} → ${features.length} points`);
  return { type: "FeatureCollection", features };
}

// conflicts: macro-level ongoing armed conflicts (wars) — centroid offset [0, 0]
function wikidataConflicts() {
  return wikidataSPARQL(`
    SELECT DISTINCT ?conflictLabel ?coord ?alpha2 WHERE {
      ?conflict wdt:P31/wdt:P279* wd:Q350604.
      ?conflict wdt:P580 ?start.
      FILTER(?start >= "2015-01-01T00:00:00Z"^^xsd:dateTime)
      FILTER NOT EXISTS { ?conflict wdt:P582 ?end. }
      OPTIONAL { ?conflict wdt:P625 ?coord. }
      OPTIONAL { ?conflict wdt:P17 ?country. ?country wdt:P297 ?alpha2. }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    } LIMIT 200`, "conflictLabel", "conflicts", [0, 0]);
}

// military: specific battles/operations/campaigns — centroid offset [+1.2, -0.8] to separate from conflicts
// protests: civil unrest / protests / riots — centroid offset [-1.2, +0.8]
function wikidataProtests() {
  // Q2742167=protest, Q1125062=civil unrest, Q853816=riot, Q180684=strike action
  return wikidataSPARQL(`
    SELECT DISTINCT ?eventLabel ?coord ?alpha2 WHERE {
      VALUES ?type { wd:Q2742167 wd:Q1125062 wd:Q853816 wd:Q180684 }
      ?event wdt:P31/wdt:P279* ?type.
      ?event wdt:P580 ?start.
      FILTER(?start >= "2023-01-01T00:00:00Z"^^xsd:dateTime)
      FILTER NOT EXISTS { ?event wdt:P582 ?end. }
      OPTIONAL { ?event wdt:P625 ?coord. }
      OPTIONAL { ?event wdt:P17 ?country. ?country wdt:P297 ?alpha2. }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    } LIMIT 150`, "eventLabel", "protests", [-1.2, 0.8]);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function eonetToPoints(data: any, wildfiresOnly: boolean): GeoJSON.FeatureCollection {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const features: GeoJSON.Feature[] = (data.events || []).flatMap((event: any) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cats: string[] = (event.categories || []).map((c: any) => c.id as string);
    if (wildfiresOnly && !cats.includes("wildfires")) return [];
    if (!wildfiresOnly && cats.includes("wildfires")) return [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (event.geometry || []).slice(0, 1).flatMap((geo: any) => {
      if (geo.type === "Point") {
        return [{ type: "Feature" as const, geometry: { type: "Point" as const, coordinates: geo.coordinates as [number, number] }, properties: { title: event.title as string } }];
      }
      if (geo.type === "Polygon") {
        const ring = geo.coordinates[0] as [number, number][];
        const lon = ring.reduce((s: number, c: [number, number]) => s + c[0], 0) / ring.length;
        const lat = ring.reduce((s: number, c: [number, number]) => s + c[1], 0) / ring.length;
        return [{ type: "Feature" as const, geometry: { type: "Point" as const, coordinates: [lon, lat] as [number, number] }, properties: { title: event.title as string } }];
      }
      return [];
    });
  });
  return { type: "FeatureCollection", features };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function noaaToPoints(data: any): GeoJSON.FeatureCollection {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const features: GeoJSON.Feature[] = (data.features || []).flatMap((f: any) => {
    const geom = f.geometry;
    if (!geom) return [];
    let coords: [number, number] | null = null;
    if (geom.type === "Point") {
      coords = [geom.coordinates[0] as number, geom.coordinates[1] as number];
    } else if (geom.type === "Polygon") {
      const ring = geom.coordinates[0] as [number, number][];
      coords = [ring.reduce((s: number, c: [number, number]) => s + c[0], 0) / ring.length, ring.reduce((s: number, c: [number, number]) => s + c[1], 0) / ring.length];
    } else if (geom.type === "MultiPolygon") {
      const ring = (geom.coordinates[0]?.[0] ?? []) as [number, number][];
      if (ring.length) coords = [ring.reduce((s: number, c: [number, number]) => s + c[0], 0) / ring.length, ring.reduce((s: number, c: [number, number]) => s + c[1], 0) / ring.length];
    }
    if (!coords) return [];
    return [{ type: "Feature" as const, geometry: { type: "Point" as const, coordinates: coords }, properties: { title: f.properties?.event ?? "Alert" } }];
  });
  return { type: "FeatureCollection", features };
}

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

// ---------------------------------------------------------------------------
// UCDP Georeferenced Event Dataset API
// Free, requires token — request at https://ucdp.uu.se/apidocs/
// type_of_violence: 1=state-based (military), 2=non-state, 3=one-sided
// ---------------------------------------------------------------------------
async function ucdpToPoints(typeOfViolence: string, token: string): Promise<GeoJSON.FeatureCollection> {
  const startDate = new Date();
  startDate.setFullYear(startDate.getFullYear() - 1);
  const since = startDate.toISOString().slice(0, 10); // last 12 months

  const url =
    `https://ucdpapi.pcr.uu.se/api/gedevents/25.1` +
    `?pagesize=1000&StartDate=${since}&TypeOfViolence=${typeOfViolence}`;

  const res = await fetch(url, {
    headers: { "x-ucdp-access-token": token },
    next: { revalidate: 3600 }, // 1-hour cache (data updates monthly)
  });
  if (!res.ok) {
    console.error(`[overlay] UCDP ${res.status} for TypeOfViolence=${typeOfViolence}`);
    return EMPTY;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = await res.json();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const events: any[] = data?.Result ?? data?.results ?? [];

  const features: GeoJSON.Feature[] = events.flatMap(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (e: any) => {
      const lat = parseFloat(e.latitude);
      const lon = parseFloat(e.longitude);
      if (!isFinite(lat) || !isFinite(lon)) return [];
      const sides = [e.side_a, e.side_b].filter(Boolean).join(" vs ");
      const deaths = (e.deaths_a ?? 0) + (e.deaths_b ?? 0) + (e.deaths_civilians ?? 0);
      return [{
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [lon, lat] as [number, number] },
        properties: { title: sides || e.conflict_name || "", deaths, date: e.date, country: e.country },
      }];
    }
  );

  console.log(`[overlay] UCDP TypeOfViolence=${typeOfViolence} → ${features.length} points`);
  return { type: "FeatureCollection", features };
}

// ---------------------------------------------------------------------------
// Country centroid lookup (shared by outages + intel layers)
// ---------------------------------------------------------------------------
const CENTROIDS: Record<string, [number, number]> = {
  US: [-95.7, 37.1], GB: [-3.4, 55.4], DE: [10.4, 51.2], FR: [2.3, 46.2],
  CN: [104.2, 35.9], RU: [105.3, 61.5], JP: [138.3, 36.2], IN: [78.9, 20.6],
  BR: [-51.9, -14.2], AU: [133.8, -25.3], CA: [-96.8, 60.1], KR: [127.8, 36.6],
  IT: [12.6, 42.8],  ES: [-3.7, 40.5],  NL: [5.3, 52.1],   SE: [18.6, 60.1],
  PL: [19.1, 51.9],  UA: [31.2, 48.4],  TR: [35.2, 39.9],  MX: [-102.5, 23.6],
  NG: [8.7, 9.1],    EG: [30.8, 26.8],  ZA: [25.1, -29.0], KE: [37.9, 0.0],
  IR: [53.7, 32.4],  SA: [45.1, 23.9],  PK: [69.3, 30.4],  ID: [113.9, -0.8],
  AR: [-63.6, -38.4],CO: [-74.3, 4.6],  VE: [-66.6, 6.4],  PH: [121.8, 12.9],
  TH: [100.9, 15.9], VN: [106.3, 16.6], BD: [90.4, 23.7],  MM: [96.7, 19.2],
  IQ: [43.7, 33.2],  SY: [38.0, 35.0],  AF: [67.7, 33.9],  LY: [17.2, 26.3],
  SD: [30.2, 12.9],  ET: [40.5, 9.1],   YE: [48.5, 15.6],  AZ: [47.6, 40.1],
  RO: [24.9, 45.9],  HU: [19.5, 47.2],  CZ: [15.5, 49.8],  GR: [21.8, 39.1],
  RS: [21.0, 44.0],  BG: [25.5, 42.7],  HR: [15.2, 45.1],  SK: [19.7, 48.7],
  IL: [34.9, 31.5],  LB: [35.5, 33.9],  KZ: [66.9, 48.0],  UZ: [63.9, 41.4],
  MA: [-7.1, 31.8],  DZ: [1.7, 28.0],   TN: [9.0, 33.9],   GH: [-1.0, 7.9],
  SN: [-14.5, 14.5], CM: [12.4, 5.7],   TZ: [35.0, -6.4],  UG: [32.3, 1.4],
  MZ: [35.0, -18.7], ZW: [30.0, -20.0], MG: [46.9, -18.8], CI: [-5.6, 7.5],
  BE: [4.5, 50.5],   CH: [8.2, 46.8],   AT: [14.6, 47.7],  LT: [23.9, 55.2],
  NO: [8.5, 60.5],   FI: [25.7, 61.9],  DK: [10.0, 56.3],  PT: [-8.2, 39.6],
  CL: [-71.5, -35.7],PE: [-75.0, -9.2], EC: [-78.1, -1.8],  BO: [-64.7, -17.0],
  PY: [-58.4, -23.4],UY: [-56.2, -32.5],GY: [-58.9, 4.9],  TW: [121.0, 23.7],
  MY: [109.7, 3.1],  SG: [103.8, 1.4],  NZ: [171.5, -42.3],HK: [114.2, 22.3],
};

// ---------------------------------------------------------------------------
// Feodo Tracker — free C2 malware server feed (no auth required)
// Used for intel hotspots layer
// ---------------------------------------------------------------------------
async function feodoToPoints(): Promise<GeoJSON.FeatureCollection> {
  const res = await fetch("https://feodotracker.abuse.ch/downloads/ipblocklist.json", { next: { revalidate: 1800 } });
  if (!res.ok) return EMPTY;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const servers: any[] = await res.json();
  const seen = new Set<string>();
  const features: GeoJSON.Feature[] = servers.flatMap(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (s: any) => {
      const code = (s.country ?? "").toUpperCase();
      const coords = CENTROIDS[code];
      if (!coords || seen.has(code)) return [];
      seen.add(code); // one dot per country to avoid pile-up
      return [{
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: coords },
        properties: { title: `C2 infrastructure: ${code}`, country: code, type: s.malware ?? "malware" },
      }];
    }
  );
  console.log(`[overlay] Feodo Tracker intel → ${features.length} countries`);
  return { type: "FeatureCollection", features };
}

export async function GET(req: NextRequest) {
  const layer = req.nextUrl.searchParams.get("layer") ?? "";
  const ucdpToken = process.env.UCDP_TOKEN ?? "";

  try {
    if (layer === "natural") {
      const res = await fetch("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson", { next: { revalidate: 300 } });
      if (!res.ok) return NextResponse.json(EMPTY);
      return NextResponse.json(await res.json());
    }

    if (layer === "fires") {
      const res = await fetch("https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=7&limit=150&category=wildfires", { next: { revalidate: 300 } });
      if (!res.ok) return NextResponse.json(EMPTY);
      return NextResponse.json(eonetToPoints(await res.json(), true));
    }

    if (layer === "weather") {
      // Global: GDACS tropical cyclones + floods + drought (GeoJSON, free, no auth)
      // + NASA EONET severe storms  + US NOAA alerts
      const since = new Date(); since.setDate(since.getDate() - 30);
      const sinceStr = since.toISOString().slice(0, 10);
      const todayStr = new Date().toISOString().slice(0, 10);
      const [gdacsRes, eonetRes, noaaRes] = await Promise.allSettled([
        fetch(
          `https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH` +
          `?eventlist=TC,FL,DR,VO&alertlevel=Green,Orange,Red&pagesize=200` +
          `&fromDate=${sinceStr}&toDate=${todayStr}`,
          { next: { revalidate: 600 } },
        ),
        fetch(
          "https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=14&limit=300&category=severeStorms,floods",
          { next: { revalidate: 300 } },
        ),
        fetch("https://api.weather.gov/alerts/active?status=actual&severity=extreme%2Csevere%2Cmoderate%2Cminor", {
          headers: { Accept: "application/geo+json" },
          next: { revalidate: 300 },
        }),
      ]);
      const features: GeoJSON.Feature[] = [];
      // GDACS — already GeoJSON FeatureCollection with Point geometry
      if (gdacsRes.status === "fulfilled" && gdacsRes.value.ok) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const gd: any = await gdacsRes.value.json();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (gd.features ?? []).forEach((f: any) => {
          if (f.geometry?.type === "Point") {
            const p = f.properties ?? {};
            features.push({
              type: "Feature",
              geometry: { type: "Point", coordinates: f.geometry.coordinates },
              properties: {
                title: p.name ?? p.eventtype ?? "Event",
                country: p.country ?? "",
                date: p.fromdate ?? "",
                type: p.eventtype ?? "",
              },
            });
          }
        });
      }
      if (eonetRes.status === "fulfilled" && eonetRes.value.ok) {
        features.push(...eonetToPoints(await eonetRes.value.json(), false).features);
      }
      if (noaaRes.status === "fulfilled" && noaaRes.value.ok) {
        features.push(...noaaToPoints(await noaaRes.value.json()).features);
      }
      console.log(`[overlay] weather → ${features.length} events (GDACS + EONET + NOAA)`);
      return NextResponse.json({ type: "FeatureCollection", features });
    }

    // Military flights: ADSB.lol real-time ADS-B military aircraft (free, no key)
    if (layer === "military") {
      const res = await fetch("https://api.adsb.lol/v2/mil", { next: { revalidate: 60 } });
      if (!res.ok) {
        console.error(`[overlay] ADSB.lol ${res.status}`);
        return NextResponse.json(EMPTY);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any = await res.json();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const aircraft: any[] = data?.ac ?? data?.aircraft ?? [];
      const features: GeoJSON.Feature[] = aircraft.flatMap(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (a: any) => {
          const lat = parseFloat(a.lat ?? a.latitude ?? "");
          const lon = parseFloat(a.lon ?? a.lng ?? a.longitude ?? "");
          if (!isFinite(lat) || !isFinite(lon)) return [];
          return [{
            type: "Feature" as const,
            geometry: { type: "Point" as const, coordinates: [lon, lat] as [number, number] },
            properties: {
              title: (a.flight ?? a.callsign ?? "").trim() || a.hex || "Military",
              type: a.t ?? a.type ?? "",
              altitude: a.alt_baro ?? a.altitude ?? 0,
              speed: a.gs ?? a.speed ?? 0,
            },
          }];
        }
      );
      console.log(`[overlay] ADSB.lol military flights → ${features.length} aircraft`);
      return NextResponse.json({ type: "FeatureCollection", features });
    }

    // Conflicts = all violence: UCDP (precise) → Wikidata ongoing armed conflicts
    if (layer === "conflicts") {
      if (ucdpToken) {
        const data = await ucdpToPoints("1,2,3", ucdpToken);
        if (data.features.length > 0) return NextResponse.json(data);
      }
      return NextResponse.json(await wikidataConflicts());
    }

    // Intel: C2 malware infrastructure hotspots via Feodo Tracker (free, no auth)
    if (layer === "intel") {
      return NextResponse.json(await feodoToPoints());
    }

    // Sports layers — all share one cached Ticketmaster fetch, filtered by genre
    // genre keywords per layer (case-insensitive):
    const SPORT_GENRES: Record<string, RegExp> = {
      soccer:     /^soccer$/i,
      basketball: /^basketball$/i,
      baseball:   /^(baseball|softball)$/i,
      hockey:     /^(ice\s*hockey|hockey|field\s*hockey)$/i,
      tennis:     /^tennis$/i,
      golf:       /^golf$/i,
      combat:     /^(boxing|wrestling|mixed\s*martial\s*arts|mma|ufc)$/i,
    };
    const SPORT_LAYER_IDS = Object.keys(SPORT_GENRES);

    if (SPORT_LAYER_IDS.includes(layer)) {
      const tmKey = process.env.TICKETMASTER_KEY ?? "";
      if (!tmKey) {
        console.warn("[overlay] TICKETMASTER_KEY not set — sports layer empty");
        return NextResponse.json(EMPTY);
      }
      const now = new Date();
      const end = new Date(now);
      end.setDate(end.getDate() + 14); // 14-day window for more coverage
      const fmt = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, "Z");
      // Fixed URL → Next.js caches this response for 30 min, shared across all sport sub-layers
      const tmUrl =
        `https://app.ticketmaster.com/discovery/v2/events.json` +
        `?apikey=${tmKey}&classificationName=sports&size=200` +
        `&startDateTime=${fmt(now)}&endDateTime=${fmt(end)}&sort=date,asc`;
      const res = await fetch(tmUrl, { next: { revalidate: 1800 } });
      if (!res.ok) {
        console.error(`[overlay] Ticketmaster ${res.status}`);
        return NextResponse.json(EMPTY);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any = await res.json();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const allEvents: any[] = data?._embedded?.events ?? [];
      const genreRe = SPORT_GENRES[layer];
      const features: GeoJSON.Feature[] = allEvents.flatMap(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (e: any) => {
          const genre: string = e.classifications?.[0]?.genre?.name ?? "";
          if (!genreRe.test(genre)) return [];
          const venue = e?._embedded?.venues?.[0];
          const lat = parseFloat(venue?.location?.latitude ?? "");
          const lon = parseFloat(venue?.location?.longitude ?? "");
          if (!isFinite(lat) || !isFinite(lon)) return [];
          return [{
            type: "Feature" as const,
            geometry: { type: "Point" as const, coordinates: [lon, lat] as [number, number] },
            properties: {
              title: e.name ?? "",
              sport: genre,
              venue: venue?.name ?? "",
              city: venue?.city?.name ?? "",
              date: e.dates?.start?.localDate ?? "",
            },
          }];
        }
      );
      console.log(`[overlay] Ticketmaster ${layer} → ${features.length} events`);
      return NextResponse.json({ type: "FeatureCollection", features });
    }

    // Elections: active Polymarket markets with election-related titles (no external API needed)
    if (layer === "elections") {
      const db = getDb();
      const rows = db.prepare(`
        SELECT title, lat, lng, geo_country
        FROM events
        WHERE is_active = 1 AND is_closed = 0
          AND lat IS NOT NULL AND lng IS NOT NULL
          AND (
            LOWER(title) LIKE '%election%' OR
            LOWER(title) LIKE '%president%' OR
            LOWER(title) LIKE '%prime minister%' OR
            LOWER(title) LIKE '%parliament%' OR
            LOWER(title) LIKE '%senate%' OR
            LOWER(title) LIKE '%referendum%' OR
            LOWER(title) LIKE '%chancellor%' OR
            LOWER(title) LIKE '%inaugur%' OR
            LOWER(title) LIKE '%ballot%'
          )
      `).all() as { title: string; lat: number; lng: number; geo_country: string }[];
      const features: GeoJSON.Feature[] = rows.map((r) => ({
        type: "Feature" as const,
        geometry: { type: "Point" as const, coordinates: [r.lng, r.lat] as [number, number] },
        properties: { title: r.title, country: r.geo_country },
      }));
      console.log(`[overlay] elections (Polymarket DB) → ${features.length} markets`);
      return NextResponse.json({ type: "FeatureCollection", features });
    }

    // Internet outages: Cloudflare Radar (free, requires token)
    // Register at https://developers.cloudflare.com/radar/ — free with Cloudflare account
    if (layer === "outages") {
      const cfToken = process.env.CLOUDFLARE_TOKEN ?? "";
      if (!cfToken) {
        console.warn("[overlay] CLOUDFLARE_TOKEN not set — outages layer empty");
        return NextResponse.json(EMPTY);
      }
      // Cloudflare Radar BGP leaks — free with token, returns events with countries[]
      const url = "https://api.cloudflare.com/client/v4/radar/bgp/leaks/events?format=json&dateRange=7d&per_page=100";
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${cfToken}` },
        next: { revalidate: 600 },
      });
      if (!res.ok) {
        console.error(`[overlay] Cloudflare Radar BGP leaks ${res.status}`);
        return NextResponse.json(EMPTY);
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any = await res.json();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const events: any[] = data?.result?.events ?? data?.result?.leaks ?? [];
      const seen = new Set<string>();
      const features: GeoJSON.Feature[] = events.flatMap(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (o: any) => {
          // countries is an array of country codes involved in the BGP leak
          const countries: string[] = (o.countries ?? o.involvedCountries ?? []).map((c: string) => c.toUpperCase());
          return countries.flatMap((code: string) => {
            if (seen.has(code)) return [];
            const coords = CENTROIDS[code];
            if (!coords) return [];
            seen.add(code);
            const leakType = o.leakType ?? o.type ?? "bgp-leak";
            return [{
              type: "Feature" as const,
              geometry: { type: "Point" as const, coordinates: coords },
              properties: {
                title: `BGP route leak: ${code}`,
                country: code,
                type: leakType,
                date: o.startTime ?? o.date ?? "",
              },
            }];
          });
        }
      );
      console.log(`[overlay] Cloudflare Radar BGP leaks → ${features.length} countries`);
      return NextResponse.json({ type: "FeatureCollection", features });
    }

    // Protests / civil unrest: ACLED OAuth (precise) → Wikidata (ongoing protests)
    if (layer === "protests") {
      const acledEmail    = process.env.ACLED_EMAIL ?? "";
      const acledPassword = process.env.ACLED_PASSWORD ?? "";
      if (acledEmail && acledPassword) {
        try {
          // Step 1: get OAuth access token — form-urlencoded with client_id=acled
          const tokenBody = new URLSearchParams({
            grant_type: "password",
            username: acledEmail,
            password: acledPassword,
            client_id: "acled",
          });
          const tokenRes = await fetch("https://acleddata.com/oauth/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: tokenBody.toString(),
          });
          if (tokenRes.ok) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const tokenData: any = await tokenRes.json();
            const accessToken: string = tokenData?.access_token ?? "";
            if (accessToken) {
              // Step 2: fetch protest events (last 30 days)
              const since = new Date();
              since.setDate(since.getDate() - 30);
              const sinceStr = since.toISOString().slice(0, 10);
              const todayStr = new Date().toISOString().slice(0, 10);
              const dataRes = await fetch(
                `https://acleddata.com/api/acled/read` +
                `?event_type=Protests&limit=500` +
                `&event_date=${sinceStr}|${todayStr}&event_date_where=BETWEEN` +
                `&fields=longitude|latitude|event_date|country|notes`,
                {
                  headers: { Authorization: `Bearer ${accessToken}` },
                  next: { revalidate: 1800 },
                },
              );
              if (dataRes.ok) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const data: any = await dataRes.json();
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const events: any[] = data?.data ?? [];
                const features: GeoJSON.Feature[] = events.flatMap(
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  (e: any) => {
                    const lat = parseFloat(e.latitude);
                    const lon = parseFloat(e.longitude);
                    if (!isFinite(lat) || !isFinite(lon)) return [];
                    return [{ type: "Feature" as const, geometry: { type: "Point" as const, coordinates: [lon, lat] as [number, number] }, properties: { title: e.notes ?? e.country ?? "Protest", date: e.event_date } }];
                  }
                );
                if (features.length > 0) {
                  console.log(`[overlay] ACLED protests → ${features.length} events`);
                  return NextResponse.json({ type: "FeatureCollection", features });
                }
              }
            }
          }
        } catch (e) {
          console.error("[overlay] ACLED OAuth error:", e);
        }
      }
      // Fallback: Wikidata ongoing civil unrest / protests
      return NextResponse.json(await wikidataProtests());
    }

    return NextResponse.json(EMPTY);
  } catch (err) {
    console.error(`[overlay API] layer="${layer}" error:`, err);
    return NextResponse.json(EMPTY);
  }
}
