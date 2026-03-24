import { useMemo } from "react";
import { useI18n, type Locale } from "@/i18n";
import type { ProcessedMarket } from "@/types";

/** Pure utility: localize a market given a locale string. No hooks. */
export function localizeMarket(market: ProcessedMarket, locale: Locale): ProcessedMarket {
  if (locale !== "zh" || !market.titleZh) return market;
  return {
    ...market,
    title: market.titleZh,
    description: market.descriptionZh ?? market.description,
    markets: market.marketsZh ?? market.markets,
  };
}

/**
 * Returns a display-only copy of the market with zh fields swapped in when locale is "zh".
 * Logic code should always use the original market (English data) to avoid breaking
 * "Yes"/"No" comparisons, tokenId matching, etc.
 */
export function useLocalizedMarket(market: ProcessedMarket): ProcessedMarket {
  const { locale } = useI18n();
  return useMemo(() => localizeMarket(market, locale), [locale, market]);
}
