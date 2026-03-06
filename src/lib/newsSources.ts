import type { NewsSource } from "@/types";

export const NEWS_SOURCES: NewsSource[] = [
  {
    name: "NYT World",
    feedUrl: "https://rss.nytimes.com/services/xml/rss/nyt/World.xml",
    region: "Global",
  },
  {
    name: "BBC World",
    feedUrl: "https://feeds.bbci.co.uk/news/world/rss.xml",
    region: "United Kingdom",
  },
  {
    name: "Al Jazeera",
    feedUrl: "https://www.aljazeera.com/xml/rss/all.xml",
    region: "Middle East",
  },
  {
    name: "Bloomberg",
    feedUrl: "https://feeds.bloomberg.com/markets/news.rss",
    region: "United States",
  },
  {
    name: "CoinDesk",
    feedUrl: "https://www.coindesk.com/arc/outboundfeeds/rss/",
    region: "Global",
  },
  {
    name: "Politico",
    feedUrl: "https://rss.politico.com/politics-news.xml",
    region: "United States",
  },
  {
    name: "France 24",
    feedUrl: "https://www.france24.com/en/rss",
    region: "France",
  },
  {
    name: "DW News",
    feedUrl: "https://rss.dw.com/rdf/rss-en-all",
    region: "Germany",
  },
  {
    name: "CNBC",
    feedUrl: "https://www.cnbc.com/id/100003114/device/rss/rss.html",
    region: "United States",
  },
  {
    name: "The Guardian",
    feedUrl: "https://www.theguardian.com/world/rss",
    region: "United Kingdom",
  },
  {
    name: "NHK World",
    feedUrl: "https://www3.nhk.or.jp/rss/news/cat0.xml",
    region: "Japan",
  },
  {
    name: "CNA",
    feedUrl: "https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml",
    region: "Singapore",
  },
  {
    name: "ABC News",
    feedUrl: "https://abcnews.go.com/abcnews/internationalheadlines",
    region: "United States",
  },
  {
    name: "Decrypt",
    feedUrl: "https://decrypt.co/feed",
    region: "Global",
  },
];
