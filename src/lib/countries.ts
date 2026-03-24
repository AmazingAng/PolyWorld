// Mapping from country names (as used in world-atlas TopoJSON and geo.ts locations)
// to ISO codes and flag emojis

interface CountryInfo {
  iso: string;
  flag: string;
}

const COUNTRIES: Record<string, CountryInfo> = {
  "Afghanistan": { iso: "AF", flag: "🇦🇫" },
  "Albania": { iso: "AL", flag: "🇦🇱" },
  "Algeria": { iso: "DZ", flag: "🇩🇿" },
  "Argentina": { iso: "AR", flag: "🇦🇷" },
  "Armenia": { iso: "AM", flag: "🇦🇲" },
  "Australia": { iso: "AU", flag: "🇦🇺" },
  "Austria": { iso: "AT", flag: "🇦🇹" },
  "Azerbaijan": { iso: "AZ", flag: "🇦🇿" },
  "Bahrain": { iso: "BH", flag: "🇧🇭" },
  "Bangladesh": { iso: "BD", flag: "🇧🇩" },
  "Belgium": { iso: "BE", flag: "🇧🇪" },
  "Bosnia": { iso: "BA", flag: "🇧🇦" },
  "Bosnia and Herzegovina": { iso: "BA", flag: "🇧🇦" },
  "Brazil": { iso: "BR", flag: "🇧🇷" },
  "Cambodia": { iso: "KH", flag: "🇰🇭" },
  "Canada": { iso: "CA", flag: "🇨🇦" },
  "Chile": { iso: "CL", flag: "🇨🇱" },
  "China": { iso: "CN", flag: "🇨🇳" },
  "Colombia": { iso: "CO", flag: "🇨🇴" },
  "Congo": { iso: "CD", flag: "🇨🇩" },
  "Croatia": { iso: "HR", flag: "🇭🇷" },
  "Cuba": { iso: "CU", flag: "🇨🇺" },
  "Czech Republic": { iso: "CZ", flag: "🇨🇿" },
  "Czechia": { iso: "CZ", flag: "🇨🇿" },
  "Denmark": { iso: "DK", flag: "🇩🇰" },
  "Ecuador": { iso: "EC", flag: "🇪🇨" },
  "Egypt": { iso: "EG", flag: "🇪🇬" },
  "Ethiopia": { iso: "ET", flag: "🇪🇹" },
  "Finland": { iso: "FI", flag: "🇫🇮" },
  "France": { iso: "FR", flag: "🇫🇷" },
  "Georgia": { iso: "GE", flag: "🇬🇪" },
  "Germany": { iso: "DE", flag: "🇩🇪" },
  "Greece": { iso: "GR", flag: "🇬🇷" },
  "Greenland": { iso: "GL", flag: "🇬🇱" },
  "Hungary": { iso: "HU", flag: "🇭🇺" },
  "India": { iso: "IN", flag: "🇮🇳" },
  "Indonesia": { iso: "ID", flag: "🇮🇩" },
  "Iran": { iso: "IR", flag: "🇮🇷" },
  "Iraq": { iso: "IQ", flag: "🇮🇶" },
  "Ireland": { iso: "IE", flag: "🇮🇪" },
  "Israel": { iso: "IL", flag: "🇮🇱" },
  "Italy": { iso: "IT", flag: "🇮🇹" },
  "Japan": { iso: "JP", flag: "🇯🇵" },
  "Jordan": { iso: "JO", flag: "🇯🇴" },
  "Kazakhstan": { iso: "KZ", flag: "🇰🇿" },
  "Kenya": { iso: "KE", flag: "🇰🇪" },
  "Kosovo": { iso: "XK", flag: "🇽🇰" },
  "Kuwait": { iso: "KW", flag: "🇰🇼" },
  "Lebanon": { iso: "LB", flag: "🇱🇧" },
  "Libya": { iso: "LY", flag: "🇱🇾" },
  "Malaysia": { iso: "MY", flag: "🇲🇾" },
  "Mexico": { iso: "MX", flag: "🇲🇽" },
  "Mongolia": { iso: "MN", flag: "🇲🇳" },
  "Montenegro": { iso: "ME", flag: "🇲🇪" },
  "Morocco": { iso: "MA", flag: "🇲🇦" },
  "Myanmar": { iso: "MM", flag: "🇲🇲" },
  "Nepal": { iso: "NP", flag: "🇳🇵" },
  "Netherlands": { iso: "NL", flag: "🇳🇱" },
  "New Zealand": { iso: "NZ", flag: "🇳🇿" },
  "Nigeria": { iso: "NG", flag: "🇳🇬" },
  "North Korea": { iso: "KP", flag: "🇰🇵" },
  "Norway": { iso: "NO", flag: "🇳🇴" },
  "Oman": { iso: "OM", flag: "🇴🇲" },
  "Pakistan": { iso: "PK", flag: "🇵🇰" },
  "Palestine": { iso: "PS", flag: "🇵🇸" },
  "Panama": { iso: "PA", flag: "🇵🇦" },
  "Peru": { iso: "PE", flag: "🇵🇪" },
  "Philippines": { iso: "PH", flag: "🇵🇭" },
  "Poland": { iso: "PL", flag: "🇵🇱" },
  "Portugal": { iso: "PT", flag: "🇵🇹" },
  "Qatar": { iso: "QA", flag: "🇶🇦" },
  "Romania": { iso: "RO", flag: "🇷🇴" },
  "Russia": { iso: "RU", flag: "🇷🇺" },
  "Saudi Arabia": { iso: "SA", flag: "🇸🇦" },
  "Serbia": { iso: "RS", flag: "🇷🇸" },
  "Singapore": { iso: "SG", flag: "🇸🇬" },
  "Somalia": { iso: "SO", flag: "🇸🇴" },
  "South Africa": { iso: "ZA", flag: "🇿🇦" },
  "South Korea": { iso: "KR", flag: "🇰🇷" },
  "Spain": { iso: "ES", flag: "🇪🇸" },
  "Sri Lanka": { iso: "LK", flag: "🇱🇰" },
  "Sudan": { iso: "SD", flag: "🇸🇩" },
  "Sweden": { iso: "SE", flag: "🇸🇪" },
  "Switzerland": { iso: "CH", flag: "🇨🇭" },
  "Syria": { iso: "SY", flag: "🇸🇾" },
  "Thailand": { iso: "TH", flag: "🇹🇭" },
  "Tunisia": { iso: "TN", flag: "🇹🇳" },
  "Turkey": { iso: "TR", flag: "🇹🇷" },
  "Türkiye": { iso: "TR", flag: "🇹🇷" },
  "Ukraine": { iso: "UA", flag: "🇺🇦" },
  "United Arab Emirates": { iso: "AE", flag: "🇦🇪" },
  "United Kingdom": { iso: "GB", flag: "🇬🇧" },
  "United States": { iso: "US", flag: "🇺🇸" },
  "United States of America": { iso: "US", flag: "🇺🇸" },
  "Venezuela": { iso: "VE", flag: "🇻🇪" },
  "Vietnam": { iso: "VN", flag: "🇻🇳" },
  "Yemen": { iso: "YE", flag: "🇾🇪" },
};

// Also handle location strings from geo.ts that differ from TopoJSON names
const LOCATION_ALIASES: Record<string, string> = {
  "Usa": "United States",
  "United States": "United States of America",
  "Britain": "United Kingdom",
  "British": "United Kingdom",
  "Chinese": "China",
  "Russian": "Russia",
  "Ukrainian": "Ukraine",
  "Indian": "India",
  "Brazilian": "Brazil",
  "French": "France",
  "German": "Germany",
  "Japanese": "Japan",
  "Korean": "South Korea",
  "Iranian": "Iran",
  "Israeli": "Israel",
  "Palestinian": "Palestine",
  "Mexican": "Mexico",
  "Canadian": "Canada",
  "Australian": "Australia",
  "Turkish": "Turkey",
  "Saudi": "Saudi Arabia",
  "Polish": "Poland",
  "Italian": "Italy",
  "Spanish": "Spain",
  "Dutch": "Netherlands",
  "Syrian": "Syria",
  "Iraqi": "Iraq",
  "Lebanese": "Lebanon",
  "Czech": "Czech Republic",
  "European Union": "Belgium",
  "Emirates": "United Arab Emirates",
  "UAE": "United Arab Emirates",
  "Taiwan": "China",
  "Taiwanese": "China",
};

export function getCountryInfo(name: string): CountryInfo | null {
  // Direct match
  if (COUNTRIES[name]) return COUNTRIES[name];

  // Check aliases
  const aliased = LOCATION_ALIASES[name];
  if (aliased && COUNTRIES[aliased]) return COUNTRIES[aliased];

  // Case-insensitive search
  const lower = name.toLowerCase();
  for (const [key, info] of Object.entries(COUNTRIES)) {
    if (key.toLowerCase() === lower) return info;
  }

  return null;
}

export function getCountryFlag(name: string): string {
  const info = getCountryInfo(name);
  return info?.flag || "🌍";
}

/**
 * Resolve a location string (city, adjective, alias, or country) to the
 * canonical COUNTRIES key that matches TopoJSON feature names.
 * Returns null if no match is found.
 */
export function resolveCountryName(location: string): string | null {
  const result = _resolveExact(location);
  if (result) return result;

  // Handle "City, Country" format — try the last comma-separated part
  if (location.includes(",")) {
    const parts = location.split(",").map((s) => s.trim());
    for (let i = parts.length - 1; i >= 0; i--) {
      const r = _resolveExact(parts[i]);
      if (r) return r;
    }
  }

  return null;
}

function _resolveExact(location: string): string | null {
  // Direct COUNTRIES key
  if (COUNTRIES[location]) return location;

  // Alias → canonical country
  const aliased = LOCATION_ALIASES[location];
  if (aliased) {
    const resolved = LOCATION_ALIASES[aliased] || aliased;
    if (COUNTRIES[resolved]) return resolved;
    if (COUNTRIES[aliased]) return aliased;
  }

  // Case-insensitive fallback
  const lower = location.toLowerCase();
  for (const key of Object.keys(COUNTRIES)) {
    if (key.toLowerCase() === lower) return key;
  }
  for (const [alias, canonical] of Object.entries(LOCATION_ALIASES)) {
    if (alias.toLowerCase() === lower) {
      const resolved = LOCATION_ALIASES[canonical] || canonical;
      if (COUNTRIES[resolved]) return resolved;
      if (COUNTRIES[canonical]) return canonical;
    }
  }

  return null;
}

export function marketMatchesCountry(
  marketLocation: string | null,
  countryName: string
): boolean {
  if (!marketLocation) return false;
  const loc = marketLocation.toLowerCase();
  const country = countryName.toLowerCase();

  // Direct match
  if (loc.includes(country)) return true;

  // Check if the country name maps to an alias that matches
  for (const [alias, canonical] of Object.entries(LOCATION_ALIASES)) {
    if (canonical.toLowerCase() === country && loc.includes(alias.toLowerCase())) {
      return true;
    }
    if (alias.toLowerCase() === country && loc.includes(canonical.toLowerCase())) {
      return true;
    }
  }

  // Some location strings from geo.ts are city names — match via COUNTRIES keys
  // e.g. location="Washington" should match "United States"
  // This is handled by the caller filtering on coords proximity instead
  return false;
}
