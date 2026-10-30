const FRANKFURTER_URL = 'https://api.frankfurter.dev/v2/rates'

type FrankfurterRate = { quote: string; rate: number }

/**
 * Latest rates from `base` to each of `quotes`, from Frankfurter. Returns an
 * empty map when the request fails or a currency has no rate, so the
 * calculator keeps working in the base currency.
 */
export async function fetchRates(
  base: string,
  quotes: string[],
): Promise<Record<string, number>> {
  const wanted = quotes.filter((code) => code !== base)
  if (wanted.length === 0) return {}
  const url = new URL(FRANKFURTER_URL)
  url.searchParams.set('base', base)
  url.searchParams.set('quotes', wanted.join(','))
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      cf: { cacheTtl: 3600, cacheEverything: true },
    })
    if (!response.ok) return {}
    const body = (await response.json()) as FrankfurterRate[]
    return Object.fromEntries(
      body
        .filter((r) => wanted.includes(r.quote) && r.rate > 0)
        .map((r) => [r.quote, r.rate]),
    )
  } catch {
    return {}
  }
}
