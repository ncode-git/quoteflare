import { describe, expect, it } from 'vitest'
import {
  deselectService,
  dependentsOf,
  evaluate,
  selectService,
  stateForPackage,
  type CalculatorCatalog,
  type CalculatorService,
} from './calculator'

const base: CalculatorService = {
  id: 'a',
  name: 'A',
  categoryId: null,
  description: '',
  note: '',
  unitLabel: 'unit',
  unitPrice: 10000,
  pricingMode: 'fixed',
  billing: 'one_time',
  minQuantity: 1,
  maxQuantity: null,
  quantityStep: 1,
  taxable: true,
  estimatedDaysMin: null,
  estimatedDaysMax: null,
  requires: [],
  groups: [],
  options: [],
}

const catalog = (
  services: CalculatorService[],
  taxRateBps = 1000,
): CalculatorCatalog => ({
  categories: [],
  packageCategories: [],
  services,
  packages: [],
  currency: 'USD',
  taxRateBps,
  rates: {},
})

describe('selectService', () => {
  const chain = catalog([
    { ...base, id: 'a', requires: ['b'] },
    { ...base, id: 'b', requires: ['c'] },
    { ...base, id: 'c' },
  ])

  it('selects transitive dependencies', () => {
    expect(Object.keys(selectService(chain, {}, 'a')).sort()).toEqual([
      'a',
      'b',
      'c',
    ])
  })

  it('keeps existing choices on a dependency', () => {
    const state = selectService(chain, {}, 'c')
    state.c.quantity = '4'
    expect(selectService(chain, state, 'a').c.quantity).toBe('4')
  })

  it('reports selected dependents', () => {
    const state = selectService(chain, {}, 'a')
    expect(dependentsOf(chain, state, 'a')).toEqual([])
    expect(dependentsOf(chain, state, 'b').map((s) => s.id)).toEqual(['a'])
    expect(dependentsOf(chain, state, 'c').map((s) => s.id)).toEqual(['b'])
    expect(Object.keys(deselectService(state, 'a'))).not.toContain('a')
  })
})

describe('evaluate', () => {
  const c = catalog([
    {
      ...base,
      id: 'design',
      unitPrice: 15050,
      groups: [{ id: 'g', name: 'Speed', selection: 'single', required: true }],
      options: [
        {
          id: 'rush',
          name: 'Rush',
          groupId: 'g',
          modifierType: 'percent',
          modifierValue: 2500,
          active: true,
        },
      ],
    },
    { ...base, id: 'hosting', unitPrice: 999, billing: 'monthly' },
    { ...base, id: 'logo', unitPrice: 2000, taxable: false },
  ])

  it('prices two designs with a percent option and 10% tax', () => {
    const state = selectService(c, {}, 'design')
    state.design.quantity = '2'
    state.design.optionIds = ['rush']
    const { breakdown, problems } = evaluate(c, state)
    expect(problems).toEqual({})
    expect(breakdown.subtotal).toBe(37625)
    expect(breakdown.taxAmount).toBe(3763)
    expect(breakdown.total).toBe(41388)
  })

  it('leaves out a line with a missing required option and keeps the rest', () => {
    let state = selectService(c, {}, 'design')
    state = selectService(c, state, 'logo')
    state.logo.quantity = '3'
    const { breakdown, problems } = evaluate(c, state)
    expect(problems.design).toEqual([
      'Choose an option in each required group.',
    ])
    expect(breakdown.subtotal).toBe(6000)
    expect(breakdown.taxAmount).toBe(0)
    expect(breakdown.total).toBe(6000)
  })

  it('keeps recurring lines out of the one-time total', () => {
    const { breakdown } = evaluate(c, selectService(c, {}, 'hosting'))
    expect(breakdown.total).toBe(0)
    expect(breakdown.recurring.subtotal).toBe(999)
    expect(breakdown.recurring.taxAmount).toBe(100)
    expect(breakdown.recurring.total).toBe(1099)
  })

  it('flags bad quantities and prices', () => {
    const custom = catalog([
      {
        ...base,
        id: 'k',
        pricingMode: 'custom',
        unitPrice: 1000,
        minQuantity: 2,
        quantityStep: 2,
      },
    ])
    const state = selectService(custom, {}, 'k')
    state.k.quantity = '3'
    expect(evaluate(custom, state).problems.k).toEqual([
      'The quantity does not fit the allowed steps.',
    ])
    state.k.quantity = 'abc'
    expect(evaluate(custom, state).problems.k).toEqual([
      'Enter a whole number of 1 or more.',
    ])
    state.k.quantity = '4'
    expect(evaluate(custom, state).breakdown.subtotal).toBe(4000)
  })

  it('returns zeros for an empty selection', () => {
    const { breakdown } = evaluate(c, {})
    expect([breakdown.subtotal, breakdown.taxAmount, breakdown.total]).toEqual([
      0, 0, 0,
    ])
  })
})

describe('stateForPackage', () => {
  const withOptions = catalog([
    {
      ...base,
      id: 'a',
      requires: ['b'],
      options: [
        {
          id: 'o1',
          groupId: null,
          name: 'O1',
          modifierType: 'flat',
          modifierValue: 500,
          active: true,
        },
      ],
    },
    { ...base, id: 'b' },
  ])

  it('applies quantities and options and pulls in requirements', () => {
    const state = stateForPackage(withOptions, {
      id: 'p',
      categoryId: null,
      name: 'P',
      description: '',
      items: [{ serviceId: 'a', quantity: 3, optionIds: ['o1'] }],
    })
    expect(state.a).toMatchObject({ quantity: '3', optionIds: ['o1'] })
    expect(state.b.quantity).toBe('1')
  })

  it('skips services and options that are gone', () => {
    const state = stateForPackage(withOptions, {
      id: 'p',
      categoryId: null,
      name: 'P',
      description: '',
      items: [
        { serviceId: 'gone', quantity: 1, optionIds: [] },
        { serviceId: 'b', quantity: 2, optionIds: ['missing'] },
      ],
    })
    expect(Object.keys(state)).toEqual(['b'])
    expect(state.b).toMatchObject({ quantity: '2', optionIds: [] })
  })
})
