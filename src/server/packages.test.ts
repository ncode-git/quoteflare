import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb, schema, type Db } from '#/db'
import { createTestD1 } from '#/db/test-db'
import { createId } from '#/lib/id'
import { packageSchema } from '#/lib/packages'
import {
  listPackageCategories,
  listPackages,
  reorderPackages,
  savePackage,
  savePackageCategories,
  setPackageActive,
} from './packages'

let db: Db
let dispose: () => Promise<void>

beforeAll(async () => {
  const test = await createTestD1()
  db = createDb(test.d1)
  dispose = test.dispose
})

afterAll(() => dispose())

const serviceId = createId()
const otherServiceId = createId()
const optionId = createId()

beforeEach(async () => {
  await db.delete(schema.packageItems)
  await db.delete(schema.packages)
  await db.delete(schema.packageCategories)
  await db.delete(schema.serviceOptions)
  await db.delete(schema.services)
  await db.insert(schema.services).values([
    { id: serviceId, name: 'Logo', unitPrice: 1000 },
    { id: otherServiceId, name: 'Site', unitPrice: 2000 },
  ])
  await db.insert(schema.serviceOptions).values({
    id: optionId,
    serviceId,
    name: 'Rush',
    modifierType: 'flat',
    modifierValue: 500,
  })
})

const parse = (input: unknown) => packageSchema.parse(input)

const form = (items: unknown[], name = 'Starter', categoryId = '') => ({
  name,
  description: 'desc',
  categoryId,
  isPrivate: false,
  items,
})

describe('packageSchema', () => {
  it('requires a service and a whole quantity', () => {
    expect(packageSchema.safeParse(form([])).success).toBe(false)
    expect(
      packageSchema.safeParse(
        form([{ serviceId, quantity: '0', optionIds: [] }]),
      ).success,
    ).toBe(false)
  })

  it('rejects the same service twice', () => {
    const item = { serviceId, quantity: '1', optionIds: [] }
    expect(packageSchema.safeParse(form([item, item])).success).toBe(false)
  })
})

describe('savePackage', () => {
  it('saves items with quantities and options in order', async () => {
    const result = await savePackage(
      db,
      parse(
        form([
          { serviceId: otherServiceId, quantity: '2', optionIds: [] },
          { serviceId, quantity: '1', optionIds: [optionId] },
        ]),
      ),
    )
    expect(result.ok).toBe(true)
    const [pkg] = await listPackages(db)
    expect(pkg.items.map((i) => [i.serviceName, i.quantity])).toEqual([
      ['Site', 2],
      ['Logo', 1],
    ])
    expect(pkg.items[1].optionIds).toEqual([optionId])
  })

  it('replaces items on update', async () => {
    const created = await savePackage(
      db,
      parse(form([{ serviceId, quantity: '1', optionIds: [] }])),
    )
    if (!created.ok) throw new Error('save failed')
    await savePackage(
      db,
      parse({
        id: created.id,
        ...form([{ serviceId: otherServiceId, quantity: '3', optionIds: [] }]),
      }),
    )
    const packages = await listPackages(db)
    expect(packages).toHaveLength(1)
    expect(packages[0].items).toHaveLength(1)
    expect(packages[0].items[0].serviceName).toBe('Site')
  })

  it('rejects an option that belongs to another service', async () => {
    const result = await savePackage(
      db,
      parse(
        form([
          { serviceId: otherServiceId, quantity: '1', optionIds: [optionId] },
        ]),
      ),
    )
    expect(result).toEqual({
      ok: false,
      errors: { 'items[0].optionIds': 'An option was not found.' },
    })
  })

  it('rejects an unknown service and an unknown package', async () => {
    const unknownService = await savePackage(
      db,
      parse(form([{ serviceId: 'nope', quantity: '1', optionIds: [] }])),
    )
    expect(unknownService.ok).toBe(false)
    const unknownPackage = await savePackage(
      db,
      parse({
        id: 'nope',
        ...form([{ serviceId, quantity: '1', optionIds: [] }]),
      }),
    )
    expect(unknownPackage.ok).toBe(false)
  })
})

describe('setPackageActive and reorderPackages', () => {
  it('archives a package and hides it from the active list', async () => {
    const created = await savePackage(
      db,
      parse(form([{ serviceId, quantity: '1', optionIds: [] }])),
    )
    if (!created.ok) throw new Error('save failed')
    expect(await setPackageActive(db, created.id, false)).toBe(true)
    expect(await listPackages(db, 'active')).toHaveLength(0)
    expect(await listPackages(db, 'all')).toHaveLength(1)
    expect(await setPackageActive(db, 'nope', true)).toBe(false)
  })

  it('reorders packages', async () => {
    const item = { serviceId, quantity: '1', optionIds: [] }
    const a = await savePackage(db, parse(form([item], 'A')))
    const b = await savePackage(db, parse(form([item], 'B')))
    if (!a.ok || !b.ok) throw new Error('save failed')
    expect((await listPackages(db)).map((p) => p.name)).toEqual(['A', 'B'])
    await reorderPackages(db, [b.id, a.id])
    expect((await listPackages(db)).map((p) => p.name)).toEqual(['B', 'A'])
  })
})

describe('package categories', () => {
  const item = { serviceId, quantity: '1', optionIds: [] }

  const makeCategories = async (...names: string[]) => {
    await savePackageCategories(
      db,
      names.map((name) => ({ name })),
    )
    return listPackageCategories(db)
  }

  it('saves categories in order and renames them', async () => {
    const [first, second] = await makeCategories('Starter', 'Retainers')
    expect([first.name, second.name]).toEqual(['Starter', 'Retainers'])
    await savePackageCategories(db, [
      { id: second.id, name: 'Monthly' },
      { id: first.id, name: 'Starter' },
    ])
    expect((await listPackageCategories(db)).map((c) => c.name)).toEqual([
      'Monthly',
      'Starter',
    ])
  })

  it('assigns a category and lists its name', async () => {
    const [category] = await makeCategories('Starter')
    const result = await savePackage(
      db,
      parse(form([item], 'Basic', category.id)),
    )
    expect(result.ok).toBe(true)
    const [pkg] = await listPackages(db)
    expect(pkg.categoryId).toBe(category.id)
    expect(pkg.categoryName).toBe('Starter')
  })

  it('stores no category for an empty id', async () => {
    await savePackage(db, parse(form([item])))
    const [pkg] = await listPackages(db)
    expect(pkg.categoryId).toBeNull()
    expect(pkg.categoryName).toBeNull()
  })

  it('rejects a category that does not exist', async () => {
    const result = await savePackage(
      db,
      parse(form([item], 'Basic', createId())),
    )
    expect(result).toEqual({
      ok: false,
      errors: { categoryId: 'This category no longer exists.' },
    })
  })

  it('blocks removing a category that still has packages', async () => {
    const [category] = await makeCategories('Starter')
    await savePackage(db, parse(form([item], 'Basic', category.id)))
    const result = await savePackageCategories(db, [])
    expect(result).toEqual({
      ok: false,
      errors: {
        form: '"Starter" still has packages. Move them to another category first.',
      },
    })
    expect(await listPackageCategories(db)).toHaveLength(1)
  })

  it('removes an unused category', async () => {
    await makeCategories('Starter')
    expect(await savePackageCategories(db, [])).toEqual({ ok: true })
    expect(await listPackageCategories(db)).toEqual([])
  })

  it('rejects an unknown category id', async () => {
    const result = await savePackageCategories(db, [
      { id: createId(), name: 'Ghost' },
    ])
    expect(result.ok).toBe(false)
  })
})
