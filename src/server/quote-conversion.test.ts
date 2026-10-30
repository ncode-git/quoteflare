import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb, schema, type Db } from '#/db'
import { createTestD1 } from '#/db/test-db'
import { isCuid } from '#/lib/id'
import { quoteRequestSchema } from '#/lib/quotes'
import { recurringSchema } from '#/lib/recurring'
import { serviceSchema } from '#/lib/services'
import { getInvoice } from './invoices'
import {
  convertQuoteToInvoice,
  getQuote,
  getQuoteSchedulePrefill,
  setQuoteStatus,
  submitQuote,
} from './quotes'
import { saveSchedule } from './recurring'
import { saveService } from './services'

let db: Db
let dispose: () => Promise<void>

beforeAll(async () => {
  const test = await createTestD1()
  db = createDb(test.d1)
  dispose = test.dispose
})

afterAll(() => dispose())

beforeEach(async () => {
  await db.delete(schema.recurringSchedules)
  await db.delete(schema.invoiceItems)
  await db.delete(schema.invoices)
  await db.delete(schema.clients)
  await db.delete(schema.quotes)
  await db.delete(schema.serviceOptions)
  await db.delete(schema.services)
  await db.delete(schema.settings)
  await db.insert(schema.settings).values({
    id: 'main',
    businessName: 'Acme',
    currency: 'LKR',
    taxRateBps: 1000,
    invoicePrefix: 'INV',
    nextInvoiceNumber: 1,
  })
})

const form = {
  name: 'Web',
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
  options: [
    { name: 'Rush', modifierType: 'flat', modifierValue: '20', group: '' },
    {
      name: 'Premium',
      modifierType: 'percent',
      modifierValue: '10',
      group: '',
    },
  ],
}

async function submit(
  email = 'jo@example.com',
  name = 'Jo',
  taxable = true,
  billing = 'one_time',
) {
  const saved = await saveService(
    db,
    serviceSchema.parse({ ...form, taxable, billing }),
  )
  if (!saved.ok) throw new Error(JSON.stringify(saved))
  const options = await db.select().from(schema.serviceOptions)
  const result = await submitQuote(
    db,
    quoteRequestSchema.parse({
      name,
      email,
      turnstileToken: 'token',
      selections: [
        {
          serviceId: saved.id,
          quantity: 2,
          optionIds: options.map((o) => o.id),
        },
      ],
    }),
    () => Promise.resolve(true),
  )
  if (!result.ok) throw new Error(result.error)
  return result.id
}

const convert = (id: string) => convertQuoteToInvoice(db, id, '2026-03-10')

describe('converting a quote to an invoice', () => {
  it('creates a draft invoice that matches the quote and marks it converted', async () => {
    const quoteId = await submit()
    const quote = await getQuote(db, quoteId)
    const result = await convert(quoteId)
    if (!result.ok) throw new Error(result.error)
    expect(result.created).toBe(true)
    expect(isCuid(result.invoiceId)).toBe(true)

    const detail = await getInvoice(db, result.invoiceId)
    expect(detail?.invoice).toMatchObject({
      number: 'INV-2026-0001',
      status: 'draft',
      issueDate: '2026-03-10',
      dueDate: '2026-03-24',
      currency: 'LKR',
      taxRateBps: 1000,
      discount: 0,
      sourceQuoteId: quoteId,
    })
    expect(
      detail?.items.map((i) => [i.description, i.quantity, i.unitPrice]),
    ).toEqual([
      ['Web', 2, 10000],
      ['Web: Rush', 1, 2000],
      ['Web: Premium', 1, 2000],
    ])
    expect(detail?.totals.total).toBe(quote?.total)
    expect((await getQuote(db, quoteId))?.status).toBe('converted')
    const [settings] = await db.select().from(schema.settings)
    expect(settings.nextInvoiceNumber).toBe(2)
  })

  it('sets the due date from the payment term in settings', async () => {
    await db.update(schema.settings).set({ paymentTermDays: 30 })
    const result = await convert(await submit())
    if (!result.ok) throw new Error(result.error)
    const detail = await getInvoice(db, result.invoiceId)
    expect(detail?.invoice.dueDate).toBe('2026-04-09')
  })

  it('keeps non-taxable services out of the invoice tax base', async () => {
    const quoteId = await submit('jo@example.com', 'Jo', false)
    const quote = await getQuote(db, quoteId)
    expect(quote?.breakdown?.taxAmount).toBe(0)
    const result = await convert(quoteId)
    if (!result.ok) throw new Error(result.error)
    const detail = await getInvoice(db, result.invoiceId)
    expect(detail?.items.every((i) => !i.taxable)).toBe(true)
    expect(detail?.totals).toMatchObject({ taxAmount: 0, total: quote?.total })
  })

  it('creates a client from the contact details when the email is new', async () => {
    const quoteId = await submit('new@example.com', 'New Person')
    const result = await convert(quoteId)
    if (!result.ok) throw new Error(result.error)
    const clients = await db.select().from(schema.clients)
    expect(clients).toHaveLength(1)
    expect(clients[0]).toMatchObject({
      name: 'New Person',
      email: 'new@example.com',
      archived: false,
    })
    expect(isCuid(clients[0].id)).toBe(true)
    expect((await getInvoice(db, result.invoiceId))?.client.id).toBe(
      clients[0].id,
    )
  })

  it('reuses a client with the same email regardless of case', async () => {
    await db
      .insert(schema.clients)
      .values({ id: 'c1', name: 'Existing', email: 'JO@Example.com' })
    const result = await convert(await submit('jo@example.com'))
    if (!result.ok) throw new Error(result.error)
    expect(await db.select().from(schema.clients)).toHaveLength(1)
    expect((await getInvoice(db, result.invoiceId))?.client.id).toBe('c1')
  })

  it('returns the existing invoice on a second conversion', async () => {
    const quoteId = await submit()
    const first = await convert(quoteId)
    const second = await convert(quoteId)
    if (!first.ok || !second.ok) throw new Error('conversion failed')
    expect(second).toEqual({
      ok: true,
      invoiceId: first.invoiceId,
      created: false,
    })
    expect(await db.select().from(schema.invoices)).toHaveLength(1)
    expect((await db.select().from(schema.settings))[0].nextInvoiceNumber).toBe(
      2,
    )
  })

  it('creates one invoice when two conversions run at once', async () => {
    const quoteId = await submit()
    const results = await Promise.all([convert(quoteId), convert(quoteId)])
    expect(results.every((r) => r.ok)).toBe(true)
    expect(await db.select().from(schema.invoices)).toHaveLength(1)
    expect(await db.select().from(schema.clients)).toHaveLength(1)
    expect((await db.select().from(schema.settings))[0].nextInvoiceNumber).toBe(
      2,
    )
  })

  it('refuses a dismissed quote until it is reopened', async () => {
    const quoteId = await submit()
    await setQuoteStatus(db, quoteId, 'dismissed')
    const refused = await convert(quoteId)
    expect(refused.ok).toBe(false)
    expect(await db.select().from(schema.invoices)).toHaveLength(0)
    await setQuoteStatus(db, quoteId, 'new')
    expect((await convert(quoteId)).ok).toBe(true)
  })

  it('refuses an archived matching client and writes nothing', async () => {
    await db.insert(schema.clients).values({
      id: 'c1',
      name: 'Gone',
      email: 'jo@example.com',
      archived: true,
    })
    const quoteId = await submit()
    const result = await convert(quoteId)
    expect(result.ok).toBe(false)
    expect(await db.select().from(schema.invoices)).toHaveLength(0)
    expect((await getQuote(db, quoteId))?.status).toBe('new')
  })

  it('rejects an unknown quote and missing settings', async () => {
    expect((await convert('missing')).ok).toBe(false)
    const quoteId = await submit()
    await db.delete(schema.settings)
    expect((await convert(quoteId)).ok).toBe(false)
    expect(
      await db
        .select()
        .from(schema.invoices)
        .where(eq(schema.invoices.sourceQuoteId, quoteId)),
    ).toHaveLength(0)
  })
})

describe('converting a quote with an advance', () => {
  it('keeps every item and records the advance on the invoice', async () => {
    const quoteId = await submit()
    const quote = await getQuote(db, quoteId)
    const result = await convertQuoteToInvoice(db, quoteId, '2026-03-10', 40)
    if (!result.ok) throw new Error(result.error)
    const detail = await getInvoice(db, result.invoiceId)
    expect(detail?.invoice.advanceBps).toBe(4000)
    expect(detail?.items).toHaveLength(3)
    expect(detail?.totals.total).toBe(quote?.total)
  })

  it('leaves the advance empty by default', async () => {
    const result = await convert(await submit())
    if (!result.ok) throw new Error(result.error)
    expect((await getInvoice(db, result.invoiceId))?.invoice.advanceBps).toBe(
      null,
    )
  })
})

describe('prefilling a recurring schedule from a quote', () => {
  const prefill = (id: string, interval: 'monthly' | 'yearly' = 'monthly') =>
    getQuoteSchedulePrefill(db, id, interval, '2026-03-10')

  it('maps the recurring lines and options for the matching client', async () => {
    const client = 'client-1'
    await db.insert(schema.clients).values({
      id: client,
      name: 'Jo Ltd',
      email: 'JO@example.com',
    })
    const quoteId = await submit('jo@example.com', 'Jo', true, 'monthly')
    const result = await prefill(quoteId)
    expect(result?.clientMissing).toBe(false)
    expect(result?.values).toEqual({
      clientId: client,
      interval: 'monthly',
      nextRunDate: '2026-03-10',
      autoSend: false,
      items: [
        {
          description: 'Web',
          quantity: '2',
          unitPrice: '100.00',
          taxable: true,
        },
        {
          description: 'Web: Rush',
          quantity: '1',
          unitPrice: '20.00',
          taxable: true,
        },
        {
          description: 'Web: Premium',
          quantity: '1',
          unitPrice: '20.00',
          taxable: true,
        },
      ],
    })
  })

  it('flags a missing client and leaves the choice empty', async () => {
    const quoteId = await submit('jo@example.com', 'Jo', true, 'monthly')
    const result = await prefill(quoteId)
    expect(result?.clientMissing).toBe(true)
    expect(result?.values.clientId).toBe('')
  })

  it('ignores archived clients', async () => {
    await db.insert(schema.clients).values({
      id: 'old',
      name: 'Jo Ltd',
      email: 'jo@example.com',
      archived: true,
    })
    const quoteId = await submit('jo@example.com', 'Jo', true, 'monthly')
    expect((await prefill(quoteId))?.clientMissing).toBe(true)
  })

  it('returns null for an interval the quote does not bill', async () => {
    const quoteId = await submit('jo@example.com', 'Jo', true, 'monthly')
    expect(await prefill(quoteId, 'yearly')).toBeNull()
    expect(await prefill('missing')).toBeNull()
  })
})

describe('saving a schedule prefilled from a quote', () => {
  const save = async (quoteId: string, clientId = '') => {
    const prefill = await getQuoteSchedulePrefill(
      db,
      quoteId,
      'monthly',
      '2026-03-10',
    )
    return saveSchedule(
      db,
      recurringSchema.parse({ ...prefill?.values, clientId, quoteId }),
    )
  }

  it('creates the client from the quote contact and links the schedule', async () => {
    const quoteId = await submit('new@example.com', 'Nia', true, 'monthly')
    const result = await save(quoteId)
    if (!result.ok) throw new Error(result.error)
    const [client] = await db.select().from(schema.clients)
    expect(client).toMatchObject({ name: 'Nia', email: 'new@example.com' })
    const [schedule] = await db.select().from(schema.recurringSchedules)
    expect(schedule).toMatchObject({ id: result.id, clientId: client.id })
  })

  it('reuses an existing client with the same email', async () => {
    await db
      .insert(schema.clients)
      .values({ id: 'c1', name: 'Jo Ltd', email: 'JO@example.com' })
    const quoteId = await submit('jo@example.com', 'Jo', true, 'monthly')
    const result = await save(quoteId)
    expect(result.ok).toBe(true)
    expect(await db.select().from(schema.clients)).toHaveLength(1)
    const [schedule] = await db.select().from(schema.recurringSchedules)
    expect(schedule.clientId).toBe('c1')
  })

  it('refuses an archived client and creates nothing', async () => {
    await db.insert(schema.clients).values({
      id: 'old',
      name: 'Jo Ltd',
      email: 'jo@example.com',
      archived: true,
    })
    const quoteId = await submit('jo@example.com', 'Jo', true, 'monthly')
    expect((await save(quoteId)).ok).toBe(false)
    expect(await db.select().from(schema.recurringSchedules)).toHaveLength(0)
  })

  it('still requires a client without a quote', () => {
    const parsed = recurringSchema.safeParse({
      clientId: '',
      interval: 'monthly',
      nextRunDate: '2026-03-10',
      autoSend: false,
      items: [{ description: 'x', quantity: '1', unitPrice: '1' }],
    })
    expect(parsed.success).toBe(false)
  })
})
