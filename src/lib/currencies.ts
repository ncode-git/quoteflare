import { data } from 'currency-codes'

export type CurrencyOption = { code: string; name: string }

/** ISO 4217 codes except funds and metals (XAU, XDR, ...), which have no rates. */
export const CURRENCY_OPTIONS: CurrencyOption[] = data
  .filter((c) => !c.code.startsWith('X'))
  .map((c) => ({ code: c.code, name: c.currency }))
  .sort((a, b) => a.code.localeCompare(b.code))

const DIGITS = new Map(data.map((c) => [c.code, c.digits]))

const digitsOf = (currency: string) => DIGITS.get(currency) ?? 2

/** Converts base-currency cents to the smallest unit of `to`. */
export const convertMinor = (minor: number, rate: number, to: string) =>
  Math.round((minor / 100) * rate * 10 ** digitsOf(to))

export const formatConverted = (minor: number, currency: string) =>
  new Intl.NumberFormat('en', { style: 'currency', currency }).format(
    minor / 10 ** digitsOf(currency),
  )
