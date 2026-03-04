export interface StreamSource {
  name: string;
  region: string;
  hlsUrl: string;
}

export const STREAMS: StreamSource[] = [
  {
    name: "Al Jazeera English",
    region: "Middle East",
    hlsUrl: "https://live-hls-web-aje.getaj.net/AJE/01.m3u8",
  },
  {
    name: "DW News",
    region: "Germany",
    hlsUrl: "https://dwamdstream102.akamaized.net/hls/live/2015525/dwstream102/index.m3u8",
  },
  {
    name: "France 24 English",
    region: "France",
    hlsUrl: "https://stream.france24.com/live/hls/f24_en_hi.m3u8",
  },
  {
    name: "CGTN",
    region: "China",
    hlsUrl: "https://news.cgtn.com/resource/live/english/cgtn-news.m3u8",
  },
  {
    name: "ABC News Australia",
    region: "Australia",
    hlsUrl: "https://abc-iview-mediapackagestreams-2.akamaized.net/out/v1/6e1cc6d25ec0480ea099a5399d73bc4b/index.m3u8",
  },
  {
    name: "Sky News",
    region: "United Kingdom",
    hlsUrl: "https://linear-33.frequency.stream/dist/skynews/33/hls/master/manifest.m3u8",
  },
  {
    name: "India Today",
    region: "India",
    hlsUrl: "https://indiatoday.intoday.in/hls/live/playlist.m3u8",
  },
  {
    name: "NHK World",
    region: "Japan",
    hlsUrl: "https://nhkworld.webcdn.stream.ne.jp/www11/nhkworld-tv/bmcc-vh/en/1300/index_sub.m3u8",
  },
  {
    name: "TRT World",
    region: "Turkey",
    hlsUrl: "https://tv-trtworld.medya.trt.com.tr/master_720.m3u8",
  },
  {
    name: "Euronews",
    region: "Europe",
    hlsUrl: "https://rakuten-euronews-2-gb.samsung.wurl.tv/playlist.m3u8",
  },
];
