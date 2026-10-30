import { describe, expect, it } from 'vitest'
import { issuePath, serviceSchema } from './services'

const base = {
  name: 'Web development',
  description: '',
  note: '',
  unitLabel: 'hour',
  unitPrice: '49.99',
  pricingMode: 'fixed',
  billing: 'one_time',
  categoryId: '',
  minQuantity: '1',
  maxQuantity: '',
  quantityStep: '1',
  taxable: true,
  isPrivate: false,
  estimatedDaysMin: '',
  estimatedDaysMax: '',
  requires: [],
  groups: [],
  options: [],
}

const errorPaths = (input: unknown) => {
  const result = serviceSchema.safeParse(input)
  return result.success ? [] : result.error.issues.map((i) => issuePath(i.path))
}

describe('serviceSchema prices', () => {
  it('stores 49.99 as 4999 cents', () => {
    expect(serviceSchema.parse(base).unitPrice).toBe(4999)
  })

  it.each([
    ['50', 5000],
    ['0.5', 50],
    ['0.05', 5],
    ['1234.10', 123410],
  ])('converts %s to %i cents', (input, cents) => {
    expect(serviceSchema.parse({ ...base, unitPrice: input }).unitPrice).toBe(
      cents,
    )
  })

  it.each(['-1', 'abc', '1.999', '', '1,5', '1e3'])(
    'rejects the price %j on a fixed service',
    (unitPrice) => {
      expect(errorPaths({ ...base, unitPrice })).toContain('unitPrice')
    },
  )

  it('allows an empty default price when the price is set per quote', () => {
    const parsed = serviceSchema.parse({
      ...base,
      pricingMode: 'custom',
      unitPrice: '',
    })
    expect(parsed.unitPrice).toBe(0)
  })

  it('still rejects a malformed default price for per-quote services', () => {
    expect(
      errorPaths({ ...base, pricingMode: 'custom', unitPrice: 'abc' }),
    ).toContain('unitPrice')
  })
})

describe('serviceSchema options and groups', () => {
  it('converts flat options to cents and percentages to basis points', () => {
    const parsed = serviceSchema.parse({
      ...base,
      options: [
        {
          name: 'Source files',
          modifierType: 'flat',
          modifierValue: '5.25',
          group: '',
        },
        {
          name: 'Rush',
          modifierType: 'percent',
          modifierValue: '12.5',
          group: '',
        },
      ],
    })
    expect(parsed.options.map((o) => o.modifierValue)).toEqual([525, 1250])
  })

  it('validates the option value against its type and reports the field', () => {
    expect(
      errorPaths({
        ...base,
        options: [
          {
            name: 'Rush',
            modifierType: 'percent',
            modifierValue: '1.234',
            group: '',
          },
        ],
      }),
    ).toEqual(['options[0].modifierValue'])
  })

  it('rejects duplicate option and group names regardless of case', () => {
    const option = (name: string) => ({
      name,
      modifierType: 'flat',
      modifierValue: '1',
      group: '',
    })
    expect(
      errorPaths({ ...base, options: [option('Rush'), option('rush')] }),
    ).toEqual(['options[1].name'])
    const group = (name: string) => ({
      name,
      selection: 'single',
      required: false,
    })
    expect(
      errorPaths({ ...base, groups: [group('Tier'), group('TIER')] }),
    ).toEqual(['groups[1].name'])
  })

  it('requires an option group to be one of the listed groups', () => {
    const option = {
      name: 'A',
      modifierType: 'flat',
      modifierValue: '1',
      group: 'Missing',
    }
    expect(errorPaths({ ...base, options: [option] })).toEqual([
      'options[0].group',
    ])
    expect(
      serviceSchema.safeParse({
        ...base,
        groups: [{ name: 'missing', selection: 'single', required: true }],
        options: [option],
      }).success,
    ).toBe(true)
  })

  it('rejects unknown fields, including at option and group level', () => {
    expect(serviceSchema.safeParse({ ...base, active: false }).success).toBe(
      false,
    )
    expect(
      serviceSchema.safeParse({
        ...base,
        options: [
          {
            name: 'A',
            modifierType: 'flat',
            modifierValue: '1',
            group: '',
            extra: 1,
          },
        ],
      }).success,
    ).toBe(false)
    expect(
      serviceSchema.safeParse({
        ...base,
        groups: [{ name: 'G', selection: 'single', required: false, x: 1 }],
      }).success,
    ).toBe(false)
  })
})

describe('serviceSchema other fields', () => {
  it('requires a name and a unit label', () => {
    expect(errorPaths({ ...base, name: '  ' })).toContain('name')
    expect(errorPaths({ ...base, unitLabel: '' })).toContain('unitLabel')
  })

  it('converts quantity rules and estimates, treating empty as none', () => {
    const parsed = serviceSchema.parse({
      ...base,
      minQuantity: '2',
      maxQuantity: '10',
      quantityStep: '2',
      estimatedDaysMin: '0.5',
      estimatedDaysMax: '3',
    })
    expect(parsed).toMatchObject({
      minQuantity: 2,
      maxQuantity: 10,
      quantityStep: 2,
      estimatedDaysMin: 0.5,
      estimatedDaysMax: 3,
    })
    const empty = serviceSchema.parse(base)
    expect(empty).toMatchObject({
      maxQuantity: null,
      estimatedDaysMin: null,
      estimatedDaysMax: null,
      categoryId: null,
    })
  })

  it.each([
    [{ minQuantity: '0' }, 'minQuantity'],
    [{ minQuantity: 'x' }, 'minQuantity'],
    [{ quantityStep: '0' }, 'quantityStep'],
    [{ maxQuantity: '0' }, 'maxQuantity'],
    [{ minQuantity: '5', maxQuantity: '4' }, 'maxQuantity'],
    [{ estimatedDaysMin: '-1' }, 'estimatedDaysMin'],
    [{ estimatedDaysMax: '1.55' }, 'estimatedDaysMax'],
    [{ estimatedDaysMin: '3', estimatedDaysMax: '2' }, 'estimatedDaysMax'],
  ])('rejects invalid quantity or estimate %j', (override, path) => {
    expect(errorPaths({ ...base, ...override })).toContain(path)
  })

  it('rejects an unknown billing or pricing mode', () => {
    expect(serviceSchema.safeParse({ ...base, billing: 'daily' }).success).toBe(
      false,
    )
    expect(
      serviceSchema.safeParse({ ...base, pricingMode: 'free' }).success,
    ).toBe(false)
  })

  it('rejects duplicate and self requirements', () => {
    expect(errorPaths({ ...base, requires: ['a', 'a'] })).toEqual(['requires'])
    expect(errorPaths({ ...base, id: 'me', requires: ['me'] })).toEqual([
      'requires',
    ])
  })
})
