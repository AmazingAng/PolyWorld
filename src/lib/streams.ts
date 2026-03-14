export interface StreamSource {
  id: string;
  name: string;
  region: string;
  /** YouTube channel handle (e.g. @SkyNews) — used for live stream detection */
  handle: string;
  /** Fallback YouTube video ID if live detection fails */
  fallbackVideoId?: string;
  /** Static HLS URL (if known to be stable) — tried before YouTube detection */
  hlsUrl?: string;
  category: "news" | "sports";
}

export const STREAMS: StreamSource[] = [
  // ── News ──────────────────────────────────────────────
  {
    id: "aljazeera",
    name: "Al Jazeera",
    region: "Middle East",
    handle: "@AlJazeeraEnglish",
    fallbackVideoId: "gCNeDWCI0vo",
    category: "news",
  },
  {
    id: "dw",
    name: "DW News",
    region: "Germany",
    handle: "@DWNews",
    fallbackVideoId: "LuKwFajn37U",
    hlsUrl:
      "https://dwamdstream102.akamaized.net/hls/live/2015525/dwstream102/index.m3u8",
    category: "news",
  },
  {
    id: "france24",
    name: "France 24",
    region: "France",
    handle: "@FRANCE24",
    fallbackVideoId: "u9foWyMSETk",
    category: "news",
  },
  {
    id: "cgtn",
    name: "CGTN",
    region: "China",
    handle: "@CGTNEurope",
    fallbackVideoId: "sHOOe6PZKGI",
    category: "news",
  },
  {
    id: "sky",
    name: "Sky News",
    region: "United Kingdom",
    handle: "@SkyNews",
    fallbackVideoId: "oY_DQcyPKEk",
    category: "news",
  },
  {
    id: "euronews",
    name: "Euronews",
    region: "Europe",
    handle: "@euronews",
    fallbackVideoId: "pykpO5kQJ98",
    category: "news",
  },
  {
    id: "india-today",
    name: "India Today",
    region: "India",
    handle: "@indiatoday",
    fallbackVideoId: "KdxEAt91D7k",
    category: "news",
  },
  {
    id: "nhk-world",
    name: "NHK World",
    region: "Japan",
    handle: "@NHKWORLDJAPAN",
    fallbackVideoId: "f0lYkdA-Gtw",
    category: "news",
  },
  {
    id: "trt-world",
    name: "TRT World",
    region: "Turkey",
    handle: "@TRTWorld",
    fallbackVideoId: "ABfFhWzWs0s",
    hlsUrl: "https://tv-trtworld.medya.trt.com.tr/master_720.m3u8",
    category: "news",
  },
  {
    id: "abc-au",
    name: "ABC News AU",
    region: "Australia",
    handle: "@abcnewsaustralia",
    fallbackVideoId: "vOTiJkg1voo",
    category: "news",
  },
  {
    id: "bloomberg",
    name: "Bloomberg",
    region: "Finance",
    handle: "@markets",
    fallbackVideoId: "iEpJwprxDdk",
    category: "news",
  },
  {
    id: "cnbc",
    name: "CNBC",
    region: "Finance",
    handle: "@CNBC",
    fallbackVideoId: "9NyxcX3rhQs",
    category: "news",
  },

  // ── Sports ────────────────────────────────────────────
  {
    id: "bein-xtra",
    name: "beIN Xtra",
    region: "Soccer / La Liga",
    handle: "@beabornnews",
    fallbackVideoId: "NzcLOGNnoT0",
    hlsUrl: "https://bein-xtra-xumo.amagi.tv/playlist.m3u8",
    category: "sports",
  },
  {
    id: "sony-sports",
    name: "Sony Sports",
    region: "Cricket / WWE",
    handle: "@SonySportsNetwork",
    fallbackVideoId: "r1fmDcR_aV0",
    category: "sports",
  },
  {
    id: "ten-sports",
    name: "Ten Sports",
    region: "Football / Cricket",
    handle: "@TENSports",
    fallbackVideoId: "SH19MYmBeuo",
    category: "sports",
  },
  {
    id: "wion",
    name: "WION Sports",
    region: "World Sports",
    handle: "@WION",
    category: "sports",
  },
  {
    id: "cna",
    name: "CNA Sport",
    region: "Asia Sports",
    handle: "@channelnewsasia",
    fallbackVideoId: "XWq5kBlakcQ",
    category: "sports",
  },
  {
    id: "ndtv-sports",
    name: "NDTV Sports",
    region: "Cricket / F1",
    handle: "@NDTV",
    category: "sports",
  },
];
