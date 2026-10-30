import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb, schema, type Db } from '#/db'
import { createTestD1 } from '#/db/test-db'
import { createId, isCuid } from '#/lib/id'
import { serviceSchema } from '#/lib/services'
import { loadCalculatorCatalog } from './calculator'
import {
  listCategories,
  listServices,
  reorderServices,
  saveCategories,
  saveService,
  setServiceActive,
  setServiceDependencies,
} from './services'

let db: Db
let dispose: () => Promise<void>

beforeAll(async () => {
  const test = await createTestD1()
  db = createDb(test.d1)
  dispose = test.dispose
})

afterAll(() => dispose())

beforeEach(async () => {
  await db.delete(schema.serviceDependencies)
  await db.delete(schema.serviceOptions)
  await db.delete(schema.serviceOptionGroups)
  await db.delete(schema.services)
  await db.delete(schema.serviceCategories)
})

const form = {
  name: 'Service',
  description: '',
  note: '',
  unitLabel: 'unit',
  unitPrice: '10',
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
  requires: [] as string[],
  groups: [] as unknown[],
  options: [] as unknown[],
}

const parse = (input: Record<string, unknown>) =>
  serviceSchema.parse({ ...form, ...input })

const create = async (name: string, extra: Record<string, unknown> = {}) => {
  const result = await saveService(db, parse({ name, ...extra }))
  if (!result.ok) throw new Error(`create failed: ${JSON.stringify(result)}`)
  return result.id
}

const flat = (name: string, value: string, group = '') => ({
  name,
  modifierType: 'flat',
  modifierValue: value,
  group,
})

const names = async (status: 'active' | 'archived' | 'all' = 'all') =>
  (await listServices(db, status)).map((s) => s.name)

describe('saving services', () => {
  it('stores the price in cents with two options', async () => {
    const id = await create('Web', {
      unitPrice: '49.99',
      options: [
        flat('Source', '5'),
        {
          name: 'Rush',
          modifierType: 'percent',
          modifierValue: '25',
          group: '',
        },
      ],
    })
    const [row] = await listServices(db, 'all')
    expect(row).toMatchObject({ id, unitPrice: 4999, active: true })
    expect(
      row.options.map((o) => [o.name, o.modifierType, o.modifierValue]),
    ).toEqual([
      ['Source', 'flat', 500],
      ['Rush', 'percent', 2500],
    ])
  })

  it('appends new services after the existing ones', async () => {
    await create('A')
    await create('B')
    await create('C')
    const rows = await listServices(db, 'all')
    expect(rows.map((r) => [r.name, r.sortOrder])).toEqual([
      ['A', 0],
      ['B', 1],
      ['C', 2],
    ])
  })

  it('round-trips every pricing, quantity and estimate field', async () => {
    const categories = await saveCategories(db, [{ name: 'Support' }])
    expect(categories.ok).toBe(true)
    const [category] = await listCategories(db)

    await create('Retainer', {
      description: 'Monthly upkeep',
      note: 'Billed in advance',
      unitLabel: 'month',
      unitPrice: '35',
      billing: 'monthly',
      categoryId: category.id,
      minQuantity: '3',
      maxQuantity: '12',
      quantityStep: '3',
      taxable: false,
      estimatedDaysMin: '0.5',
      estimatedDaysMax: '2',
    })
    const [row] = await listServices(db, 'all')
    expect(row).toMatchObject({
      categoryId: category.id,
      categoryName: 'Support',
      note: 'Billed in advance',
      billing: 'monthly',
      pricingMode: 'fixed',
      minQuantity: 3,
      maxQuantity: 12,
      quantityStep: 3,
      taxable: false,
      estimatedDaysMin: 0.5,
      estimatedDaysMax: 2,
    })
  })

  it('stores a per-quote service with a zero default price', async () => {
    await create('API integration', { pricingMode: 'custom', unitPrice: '' })
    const [row] = await listServices(db, 'all')
    expect(row).toMatchObject({ pricingMode: 'custom', unitPrice: 0 })
  })

  it('creates every row with a CUID', async () => {
    const id = await create('Web', {
      groups: [{ name: 'Tier', selection: 'single', required: true }],
      options: [flat('Basic', '1', 'Tier')],
      requires: [await create('Base')],
    })
    await saveCategories(db, [{ name: 'Cat' }])
    const ids = [
      id,
      ...(await db.select().from(schema.serviceOptions)).map((r) => r.id),
      ...(await db.select().from(schema.serviceOptionGroups)).map((r) => r.id),
      ...(await db.select().from(schema.serviceDependencies)).map((r) => r.id),
      ...(await db.select().from(schema.serviceCategories)).map((r) => r.id),
    ]
    expect(ids).toHaveLength(5)
    for (const value of ids) expect(isCuid(value)).toBe(true)
  })

  it('updates fields, edits an option, adds one and archives a removed one', async () => {
    const id = await create('Web', {
      options: [flat('One', '1'), flat('Two', '2')],
    })
    const [before] = await listServices(db, 'all')
    const [one] = before.options

    const result = await saveService(
      db,
      parse({
        id,
        name: 'Web 2',
        unitPrice: '60.50',
        options: [
          {
            id: one.id,
            name: 'One+',
            modifierType: 'percent',
            modifierValue: '10',
            group: '',
          },
          flat('Three', '3'),
        ],
      }),
    )
    expect(result.ok).toBe(true)

    const [after] = await listServices(db, 'all')
    expect(after).toMatchObject({ name: 'Web 2', unitPrice: 6050 })
    expect(after.options.map((o) => [o.name, o.modifierValue])).toEqual([
      ['One+', 1000],
      ['Three', 300],
    ])
    const stored = await db.select().from(schema.serviceOptions)
    expect(stored).toHaveLength(3)
    expect(stored.find((o) => o.name === 'Two')?.active).toBe(false)
  })

  it('rejects an option id that belongs to another service', async () => {
    const a = await create('A', { options: [flat('X', '1')] })
    const b = await create('B')
    const [rowA] = await listServices(db, 'all')
    const result = await saveService(
      db,
      parse({
        id: b,
        options: [{ ...flat('Stolen', '1'), id: rowA.options[0].id }],
      }),
    )
    expect(result.ok).toBe(false)
    const [stored] = await db.select().from(schema.serviceOptions)
    expect(stored).toMatchObject({ serviceId: a, name: 'X' })
  })

  it('reports a missing service on update', async () => {
    const result = await saveService(db, parse({ id: createId() }))
    expect(result).toEqual({
      ok: false,
      errors: { form: 'This service no longer exists.' },
    })
  })

  it('rejects an unknown category without writing', async () => {
    const result = await saveService(
      db,
      parse({ name: 'X', categoryId: createId() }),
    )
    expect(result).toEqual({
      ok: false,
      errors: { categoryId: 'This category no longer exists.' },
    })
    expect(await names()).toEqual([])
  })
})

describe('option groups', () => {
  it('stores groups and attaches options to them', async () => {
    await create('Support', {
      groups: [
        { name: 'Tier', selection: 'single', required: true },
        { name: 'Extras', selection: 'multiple', required: false },
      ],
      options: [
        flat('Basic', '0', 'Tier'),
        flat('Premium', '20', 'Tier'),
        flat('Phone line', '5', 'Extras'),
        flat('Loose add-on', '1'),
      ],
    })
    const [row] = await listServices(db, 'all')
    expect(row.groups.map((g) => [g.name, g.selection, g.required])).toEqual([
      ['Tier', 'single', true],
      ['Extras', 'multiple', false],
    ])
    const groupName = (id: string | null) =>
      row.groups.find((g) => g.id === id)?.name ?? null
    expect(row.options.map((o) => [o.name, groupName(o.groupId)])).toEqual([
      ['Basic', 'Tier'],
      ['Premium', 'Tier'],
      ['Phone line', 'Extras'],
      ['Loose add-on', null],
    ])
  })

  it('renames a group in place and ungroups options when a group is removed', async () => {
    const id = await create('Support', {
      groups: [
        { name: 'Tier', selection: 'single', required: false },
        { name: 'Extras', selection: 'multiple', required: false },
      ],
      options: [flat('A', '1', 'Tier'), flat('B', '2', 'Extras')],
    })
    const [before] = await listServices(db, 'all')
    const tier = before.groups[0]

    const result = await saveService(
      db,
      parse({
        id,
        groups: [
          { id: tier.id, name: 'Level', selection: 'single', required: true },
        ],
        options: before.options.map((o) => ({
          id: o.id,
          name: o.name,
          modifierType: o.modifierType,
          modifierValue: String(o.modifierValue / 100),
          group: o.name === 'A' ? 'Level' : '',
        })),
      }),
    )
    expect(result.ok).toBe(true)

    const [after] = await listServices(db, 'all')
    expect(after.groups).toEqual([
      { id: tier.id, name: 'Level', selection: 'single', required: true },
    ])
    expect(after.options.map((o) => [o.name, o.groupId])).toEqual([
      ['A', tier.id],
      ['B', null],
    ])
    expect(await db.select().from(schema.serviceOptionGroups)).toHaveLength(1)
  })

  it('rejects a group id from another service', async () => {
    await create('A', {
      groups: [{ name: 'G', selection: 'single', required: false }],
    })
    const b = await create('B')
    const [rowA] = await listServices(db, 'all')
    const result = await saveService(
      db,
      parse({
        id: b,
        groups: [
          {
            id: rowA.groups[0].id,
            name: 'G',
            selection: 'single',
            required: false,
          },
        ],
      }),
    )
    expect(result.ok).toBe(false)
    expect(await db.select().from(schema.serviceOptionGroups)).toHaveLength(1)
  })
})

describe('categories', () => {
  it('creates, renames and reorders', async () => {
    await saveCategories(db, [{ name: 'A' }, { name: 'B' }, { name: 'C' }])
    const [a, b, c] = await listCategories(db)
    expect([a.name, b.name, c.name]).toEqual(['A', 'B', 'C'])

    await saveCategories(db, [c, { id: a.id, name: 'A2' }, b])
    expect((await listCategories(db)).map((x) => x.name)).toEqual([
      'C',
      'A2',
      'B',
    ])
  })

  it('deletes an empty category and blocks one that still has services', async () => {
    await saveCategories(db, [{ name: 'Used' }, { name: 'Empty' }])
    const [used, empty] = await listCategories(db)
    await create('Svc', { categoryId: used.id })

    const blocked = await saveCategories(db, [empty])
    expect(blocked).toEqual({
      ok: false,
      errors: {
        form: '"Used" still has services. Move them to another category first.',
      },
    })
    expect(await listCategories(db)).toHaveLength(2)

    expect(await saveCategories(db, [used])).toEqual({ ok: true })
    expect((await listCategories(db)).map((c) => c.name)).toEqual(['Used'])
  })

  it('rejects an unknown category id', async () => {
    const result = await saveCategories(db, [{ id: createId(), name: 'X' }])
    expect(result.ok).toBe(false)
  })
})

describe('dependencies', () => {
  it('stores and lists required services', async () => {
    const base = await create('Base')
    await create('Addon', { requires: [base] })
    const rows = await listServices(db, 'all')
    expect(rows.find((r) => r.name === 'Addon')?.requires).toEqual([
      { id: base, name: 'Base' },
    ])
    expect(rows.find((r) => r.name === 'Base')?.requires).toEqual([])
  })

  it('replaces requirements on update', async () => {
    const a = await create('A')
    const b = await create('B')
    const c = await create('C', { requires: [a] })
    await saveService(db, parse({ id: c, name: 'C', requires: [b] }))
    const row = (await listServices(db, 'all')).find((r) => r.id === c)
    expect(row?.requires.map((r) => r.name)).toEqual(['B'])
  })

  it('rejects a direct loop and leaves the services unchanged', async () => {
    const a = await create('A')
    const b = await create('B', { requires: [a] })
    const result = await saveService(
      db,
      parse({ id: a, name: 'A', requires: [b] }),
    )
    expect(result.ok).toBe(false)
    expect(await db.select().from(schema.serviceDependencies)).toHaveLength(1)
  })

  it('rejects a longer loop', async () => {
    const a = await create('A')
    const b = await create('B', { requires: [a] })
    const c = await create('C', { requires: [b] })
    const result = await setServiceDependencies(db, a, [c])
    expect(result.ok).toBe(false)
  })

  it('rejects a self requirement and an unknown service', async () => {
    const a = await create('A')
    expect((await setServiceDependencies(db, a, [a])).ok).toBe(false)
    expect((await setServiceDependencies(db, a, [createId()])).ok).toBe(false)
    expect(await db.select().from(schema.serviceDependencies)).toHaveLength(0)
  })

  it('keeps requirements when a service is archived', async () => {
    const base = await create('Base')
    const addon = await create('Addon', { requires: [base] })
    await setServiceActive(db, base, false)
    const row = (await listServices(db, 'all')).find((r) => r.id === addon)
    expect(row?.requires).toHaveLength(1)
  })
})

describe('archiving and filtering', () => {
  it('hides archived services by default and shows them with a filter', async () => {
    const a = await create('A')
    await create('B')
    expect(await setServiceActive(db, a, false)).toBe(true)

    expect(await names('active')).toEqual(['B'])
    expect(await names('archived')).toEqual(['A'])
    expect(await names('all')).toEqual(['A', 'B'])

    await setServiceActive(db, a, true)
    expect(await names('active')).toHaveLength(2)
  })

  it('keeps the row and its options when archiving', async () => {
    const id = await create('A', { options: [flat('X', '1')] })
    await setServiceActive(db, id, false)
    const [row] = await listServices(db, 'archived')
    expect(row.options).toHaveLength(1)
  })

  it('returns false for an unknown service', async () => {
    expect(await setServiceActive(db, createId(), false)).toBe(false)
  })
})

describe('reordering', () => {
  it('persists the new order', async () => {
    const a = await create('A')
    const b = await create('B')
    const c = await create('C')
    expect(await reorderServices(db, [c, a, b])).toEqual({ ok: true })
    expect(await names()).toEqual(['C', 'A', 'B'])
  })

  it('reorders a filtered subset and leaves hidden services in place', async () => {
    const a = await create('A')
    const b = await create('B')
    const c = await create('C')
    const d = await create('D')
    await setServiceActive(db, b, false)

    await reorderServices(db, [d, c, a])
    expect(await names()).toEqual(['D', 'B', 'C', 'A'])
  })

  it('works when every service has the same sort order', async () => {
    const ids = [createId(), createId(), createId()]
    await db.insert(schema.services).values(
      ids.map((id, i) => ({
        id,
        name: `S${i}`,
        unitPrice: 100,
        sortOrder: 0,
      })),
    )
    const before = (await listServices(db, 'all')).map((s) => s.id)
    const swapped = [before[1], before[0], before[2]]
    await reorderServices(db, swapped)
    expect((await listServices(db, 'all')).map((s) => s.id)).toEqual(swapped)
  })

  it('rejects duplicates and unknown ids without writing', async () => {
    const a = await create('A')
    const b = await create('B')
    expect((await reorderServices(db, [a, a])).ok).toBe(false)
    expect((await reorderServices(db, [b, createId()])).ok).toBe(false)
    expect(await names()).toEqual(['A', 'B'])
  })
})

describe('private services', () => {
  it('defaults to public and saves the flag', async () => {
    const a = await create('A')
    const b = await create('B', { isPrivate: true })
    const rows = await listServices(db, 'all')
    expect(rows.find((r) => r.id === a)?.isPrivate).toBe(false)
    expect(rows.find((r) => r.id === b)?.isPrivate).toBe(true)
  })

  it('keeps private services and packages out of the public catalog', async () => {
    await create('Public')
    const hidden = await create('Hidden', { isPrivate: true })
    await db.insert(schema.packages).values([
      { id: createId(), name: 'Open pack' },
      { id: createId(), name: 'Secret pack', isPrivate: true },
    ])
    const packageIds = (await db.select().from(schema.packages)).map(
      (p) => p.id,
    )
    await db.insert(schema.packageItems).values(
      packageIds.map((packageId) => ({
        packageId,
        serviceId: hidden,
        quantity: 1,
        optionIds: [],
      })),
    )

    const catalog = await loadCalculatorCatalog(db)
    expect(catalog.services.map((s) => s.name)).toEqual(['Public'])
    expect(catalog.packages).toEqual([])
    expect((await listServices(db, 'active')).map((s) => s.name)).toEqual([
      'Public',
      'Hidden',
    ])
  })
})
