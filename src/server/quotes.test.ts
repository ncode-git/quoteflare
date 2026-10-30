import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb, schema, type Db } from '#/db'
import { createTestD1 } from '#/db/test-db'
import { isCuid } from '#/lib/id'
import { quoteRequestSchema } from '#/lib/quotes'
import { serviceSchema } from '#/lib/services'
import { getQuote, listQuotes, setQuoteStatus, submitQuote } from './quotes'
import { saveService } from './services'
import { verifyTurnstile } from './turnstile'

let db: Db
let dispose: () => Promise<void>

beforeAll(async () => {
  const test = await createTestD1()
  db = createDb(test.d1)
  dispose = test.dispose
})

afterAll(() => dispose())

beforeEach(async () => {
  await db.delete(schema.quotes)
  await db.delete(schema.serviceDependencies)
  await db.delete(schema.serviceOptions)
  await db.delete(schema.serviceOptionGroups)
  await db.delete(schema.services)
  await db.delete(schema.settings)
  await db.insert(schema.settings).values({
    id: 'main',
    businessName: 'Acme',
    currency: 'LKR',
    taxRateBps: 1000,
  })
})

const form = {
  name: 'Service',
  description: '',
  note: '',
  unitLabel: 'unit',
  unitPrice: '100',
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

const create = async (name: string, extra: Record<string, unknown> = {}) => {
  const result = await saveService(
    db,
    serviceSchema.parse({ ...form, name, ...extra }),
  )
  if (!result.ok) throw new Error(JSON.stringify(result))
  return result.id
}

const request = (selections: unknown[], extra: Record<string, unknown> = {}) =>
  quoteRequestSchema.parse({
    name: 'Jo',
    email: 'jo@example.com',
    message: 'Hello',
    turnstileToken: 'token',
    selections,
    ...extra,
  })

const human = () => Promise.resolve(true)

describe('submitting a quote', () => {
  it('stores the server-calculated total and a CUID', async () => {
    const id = await create('Web')
    const result = await submitQuote(
      db,
      request([{ serviceId: id, quantity: 2, optionIds: [] }]),
      human,
    )
    expect(result.ok).toBe(true)
    const [row] = await listQuotes(db, 'all')
    expect(isCuid(row.id)).toBe(true)
    expect(row).toMatchObject({
      contactName: 'Jo',
      contactEmail: 'jo@example.com',
      message: 'Hello',
      status: 'new',
      currency: 'LKR',
      total: 22000,
    })
    expect(row.breakdown?.lines[0]).toMatchObject({
      name: 'Web',
      amount: 20000,
    })
  })

  it('ignores a total sent by the browser', async () => {
    const id = await create('Web')
    const result = await submitQuote(
      db,
      {
        ...request([{ serviceId: id, quantity: 1, optionIds: [] }]),
        total: 1,
      } as ReturnType<typeof request>,
      human,
    )
    expect(result.ok).toBe(true)
    expect((await listQuotes(db, 'all'))[0].total).toBe(11000)
  })

  it('rejects client prices and uses the catalog price', async () => {
    const fixed = await create('Web')
    const custom = await create('Custom', { pricingMode: 'custom' })
    for (const serviceId of [fixed, custom]) {
      const line = { serviceId, quantity: 1, optionIds: [] }
      expect(() => request([{ ...line, priceOverride: 1 }])).toThrow()
      await submitQuote(db, request([line]), human)
    }
    expect((await listQuotes(db, 'all')).map((q) => q.total)).toEqual([
      11000, 11000,
    ])
  })

  it('rejects when the human check fails and stores nothing', async () => {
    const id = await create('Web')
    const result = await submitQuote(
      db,
      request([{ serviceId: id, quantity: 1, optionIds: [] }]),
      () => Promise.resolve(false),
    )
    expect(result.ok).toBe(false)
    expect(await listQuotes(db, 'all')).toHaveLength(0)
  })

  it('rejects archived and unknown services', async () => {
    const id = await create('Web', {})
    await db.update(schema.services).set({ active: false })
    for (const serviceId of [id, 'missing']) {
      const result = await submitQuote(
        db,
        request([{ serviceId, quantity: 1, optionIds: [] }]),
        human,
      )
      expect(result.ok).toBe(false)
    }
    expect(await listQuotes(db, 'all')).toHaveLength(0)
  })

  it('rejects a service whose requirement is missing', async () => {
    const base = await create('Base')
    const top = await create('Top', { requires: [base] })
    const result = await submitQuote(
      db,
      request([{ serviceId: top, quantity: 1, optionIds: [] }]),
      human,
    )
    expect(result).toMatchObject({ ok: false })
    const both = await submitQuote(
      db,
      request([
        { serviceId: top, quantity: 1, optionIds: [] },
        { serviceId: base, quantity: 1, optionIds: [] },
      ]),
      human,
    )
    expect(both.ok).toBe(true)
  })

  it('rejects quantities outside the rules', async () => {
    const id = await create('Web', { maxQuantity: '3' })
    const result = await submitQuote(
      db,
      request([{ serviceId: id, quantity: 4, optionIds: [] }]),
      human,
    )
    expect(result.ok).toBe(false)
  })
})

describe('quote request validation', () => {
  const ok = {
    name: 'Jo',
    email: 'jo@example.com',
    turnstileToken: 't',
    selections: [{ serviceId: 'a', quantity: 1, optionIds: [] }],
  }

  it('requires name, valid email, token and a selection', () => {
    expect(quoteRequestSchema.safeParse(ok).success).toBe(true)
    for (const bad of [
      { ...ok, name: ' ' },
      { ...ok, email: 'nope' },
      { ...ok, turnstileToken: '' },
      { ...ok, selections: [] },
      { ...ok, selections: [{ serviceId: 'a', quantity: 0, optionIds: [] }] },
      { ...ok, message: 'x'.repeat(2001) },
      { ...ok, total: 1 },
      {
        ...ok,
        selections: [{ serviceId: 'a', quantity: 1, optionIds: [], price: 1 }],
      },
    ]) {
      expect(quoteRequestSchema.safeParse(bad).success).toBe(false)
    }
  })
})

describe('quote status', () => {
  it('dismisses and reopens but never changes a converted quote', async () => {
    const id = await create('Web')
    await submitQuote(
      db,
      request([{ serviceId: id, quantity: 1, optionIds: [] }]),
      human,
    )
    const quote = (await listQuotes(db, 'all'))[0]
    expect(await setQuoteStatus(db, quote.id, 'dismissed')).toBe(true)
    expect((await listQuotes(db, 'dismissed')).length).toBe(1)
    expect((await listQuotes(db, 'new')).length).toBe(0)
    expect(await setQuoteStatus(db, quote.id, 'new')).toBe(true)
    await db
      .update(schema.quotes)
      .set({ status: 'converted' })
      .where(eq(schema.quotes.id, quote.id))
    expect(await setQuoteStatus(db, quote.id, 'dismissed')).toBe(false)
    expect((await getQuote(db, quote.id))?.status).toBe('converted')
    expect(await setQuoteStatus(db, 'missing', 'new')).toBe(false)
  })
})

describe('turnstile verification', () => {
  const respond = (body: unknown, status = 200) =>
    (() =>
      Promise.resolve(
        new Response(JSON.stringify(body), { status }),
      )) as unknown as typeof fetch

  it('accepts only a successful verdict', async () => {
    expect(
      await verifyTurnstile('s', 't', undefined, respond({ success: true })),
    ).toBe(true)
    expect(
      await verifyTurnstile('s', 't', undefined, respond({ success: false })),
    ).toBe(false)
    expect(await verifyTurnstile('s', 't', undefined, respond({}, 500))).toBe(
      false,
    )
  })

  it('fails closed without a secret or when the request throws', async () => {
    expect(
      await verifyTurnstile(
        undefined,
        't',
        undefined,
        respond({ success: true }),
      ),
    ).toBe(false)
    const boom = (() =>
      Promise.reject(new Error('down'))) as unknown as typeof fetch
    expect(await verifyTurnstile('s', 't', undefined, boom)).toBe(false)
  })
})
