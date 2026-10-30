import { describe, expect, it } from 'vitest'
import { convertMinor, CURRENCY_OPTIONS, formatConverted } from './currencies'

describe('currencies', () => {
  it('lists ISO currencies without funds and metals', () => {
    const codes = CURRENCY_OPTIONS.map((c) => c.code)
    expect(codes).toContain('LKR')
    expect(codes).not.toContain('XAU')
  })

  it('converts cents using the target currency digits', () => {
    expect(convertMinor(10000, 0.92, 'EUR')).toBe(9200)
    expect(convertMinor(10000, 150, 'JPY')).toBe(15000)
  })

  it('formats converted minor units', () => {
    expect(formatConverted(9200, 'EUR')).toBe('€92.00')
    expect(formatConverted(15000, 'JPY')).toBe('¥15,000')
  })
})
