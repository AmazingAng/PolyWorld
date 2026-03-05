export interface RegionalView {
  id: string;
  label: string;
  center: [number, number]; // [lng, lat]
  zoom: number;
}

export const REGIONAL_VIEWS: RegionalView[] = [
  { id: "global", label: "Global", center: [10, 25], zoom: 1.8 },
  { id: "americas", label: "Americas", center: [-80, 15], zoom: 2.5 },
  { id: "europe", label: "Europe", center: [15, 50], zoom: 3.5 },
  { id: "mena", label: "MENA", center: [40, 28], zoom: 3.2 },
  { id: "asia-pacific", label: "Asia-Pacific", center: [105, 25], zoom: 2.8 },
  { id: "africa", label: "Africa", center: [20, 0], zoom: 2.8 },
  { id: "oceania", label: "Oceania", center: [145, -25], zoom: 3.5 },
];
