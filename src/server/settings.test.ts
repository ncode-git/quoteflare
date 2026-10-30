import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createDb, schema, type Db } from '#/db'
import { createTestD1 } from '#/db/test-db'
import { DEFAULT_INVOICE_EMAIL } from '#/lib/email-template'
import { settingsSchema } from '#/lib/settings'
import {
  loadInvoiceEmailTemplate,
  loadSettings,
  readLogo,
  saveInvoiceEmailTemplate,
  saveSettings,
  storeLogo,
} from './settings'

let db: Db
let bucket: R2Bucket
let dispose: () => Promise<void>

beforeAll(async () => {
  const test = await createTestD1()
  db = createDb(test.d1)
  bucket = test.bucket
  dispose = test.dispose
})

afterAll(() => dispose())

const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]
const png = (name = 'logo.png') =>
  new File([new Uint8Array(PNG)], name, { type: 'image/png' })

const input = {
  businessName: 'Acme Studio',
  address: '',
  email: '',
  replyToEmail: 'replies@acme.example',
  currency: 'EUR',
  approvedCurrencies: ['USD', 'GBP'],
  taxRate: '7.25',
  invoicePrefix: 'ACM',
  nextInvoiceNumber: '5',
  bankName: 'First Bank',
  bankBranch: '',
  bankAccountName: 'Acme Studio',
  bankAccountNumber: '12345678',
  bankSwiftCode: '',
  paymentInstructions: 'IBAN 123',
  paymentTermDays: '14',
  calculatorTitle: '',
  calculatorDescription: '',
  sendReminders: false,
}

beforeEach(async () => {
  await db.delete(schema.settings)
  const listed = await bucket.list()
  await Promise.all(listed.objects.map((o) => bucket.delete(o.key)))
})

describe('settings persistence', () => {
  it('returns defaults when no row exists', async () => {
    const loaded = await loadSettings(db)
    expect(loaded.values.businessName).toBe('')
    expect(loaded.logoKey).toBeNull()
  })

  it('creates the row on first save and updates it afterwards', async () => {
    await saveSettings(db, settingsSchema.parse(input))
    await saveSettings(
      db,
      settingsSchema.parse({ ...input, taxRate: '10', businessName: 'Acme 2' }),
    )
    const rows = await db.select().from(schema.settings)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      businessName: 'Acme 2',
      taxRateBps: 1000,
      replyToEmail: 'replies@acme.example',
      currency: 'EUR',
      nextInvoiceNumber: 5,
    })
    expect((await loadSettings(db)).values.taxRate).toBe('10')
  })
})

describe('reminder toggle', () => {
  it('defaults to off and persists when switched on', async () => {
    await saveSettings(db, settingsSchema.parse(input))
    expect((await loadSettings(db)).values.sendReminders).toBe(false)
    await saveSettings(
      db,
      settingsSchema.parse({ ...input, sendReminders: true }),
    )
    expect((await loadSettings(db)).values.sendReminders).toBe(true)
  })

  it('rejects a non-boolean value', () => {
    expect(
      settingsSchema.safeParse({ ...input, sendReminders: 'yes' }).success,
    ).toBe(false)
  })
})

describe('payment term', () => {
  it('persists and loads back', async () => {
    await saveSettings(
      db,
      settingsSchema.parse({ ...input, paymentTermDays: '45' }),
    )
    expect((await loadSettings(db)).values.paymentTermDays).toBe('45')
    const [row] = await db.select().from(schema.settings)
    expect(row.paymentTermDays).toBe(45)
  })
})

describe('logo storage', () => {
  beforeEach(() => saveSettings(db, settingsSchema.parse(input)))

  it('stores a valid logo in R2 and records its key', async () => {
    const result = await storeLogo(db, bucket, png())
    expect(result.ok).toBe(true)
    const { logoKey } = await loadSettings(db)
    expect(logoKey).toMatch(/^logo\/[a-z0-9]{24}\.png$/)
    const object = await bucket.get(logoKey!)
    expect(object?.httpMetadata?.contentType).toBe('image/png')
  })

  it('rejects a file over 1 MB without storing it', async () => {
    const big = new File([new Uint8Array(2 * 1024 * 1024)], 'big.png', {
      type: 'image/png',
    })
    const result = await storeLogo(db, bucket, big)
    expect(result).toEqual({
      ok: false,
      error: 'The logo must be 1 MB or smaller. This file is 2.0 MB.',
    })
    expect((await bucket.list()).objects).toHaveLength(0)
    expect((await loadSettings(db)).logoKey).toBeNull()
  })

  it('rejects unsupported types and mismatched contents', async () => {
    const gif = new File([new Uint8Array(PNG)], 'a.gif', { type: 'image/gif' })
    expect((await storeLogo(db, bucket, gif)).ok).toBe(false)
    const fake = new File([new TextEncoder().encode('hello')], 'a.png', {
      type: 'image/png',
    })
    expect((await storeLogo(db, bucket, fake)).ok).toBe(false)
    const html = new File(['<html><script>1</script></html>'], 'a.svg', {
      type: 'image/svg+xml',
    })
    expect((await storeLogo(db, bucket, html)).ok).toBe(false)
    expect((await bucket.list()).objects).toHaveLength(0)
  })

  it('rejects an SVG with scripts or event handlers', async () => {
    for (const body of [
      '<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>',
      '<svg xmlns="http://www.w3.org/2000/svg" onload="x()"/>',
    ]) {
      const file = new File([body], 'a.svg', { type: 'image/svg+xml' })
      expect((await storeLogo(db, bucket, file)).ok).toBe(false)
    }
  })

  it('accepts an SVG and removes the previous logo object', async () => {
    await storeLogo(db, bucket, png())
    const first = (await loadSettings(db)).logoKey!
    const svg = new File(
      ['<svg xmlns="http://www.w3.org/2000/svg"/>'],
      'a.svg',
      {
        type: 'image/svg+xml',
      },
    )
    expect((await storeLogo(db, bucket, svg)).ok).toBe(true)
    const second = (await loadSettings(db)).logoKey!
    expect(second).toMatch(/\.svg$/)
    expect(await bucket.head(first)).toBeNull()
    expect((await bucket.list()).objects).toHaveLength(1)
  })

  it('refuses a logo before settings exist', async () => {
    await db.delete(schema.settings)
    expect((await storeLogo(db, bucket, png())).ok).toBe(false)
    expect((await bucket.list()).objects).toHaveLength(0)
  })

  it('streams the logo with safe headers and honours If-None-Match', async () => {
    const missing = await readLogo(
      db,
      bucket,
      new Request('http://x/files/logo'),
    )
    expect(missing.status).toBe(404)

    await storeLogo(db, bucket, png())
    const response = await readLogo(
      db,
      bucket,
      new Request('http://x/files/logo'),
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('image/png')
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array(PNG),
    )

    const etag = response.headers.get('ETag')!
    const cached = await readLogo(
      db,
      bucket,
      new Request('http://x/files/logo', {
        headers: { 'If-None-Match': etag },
      }),
    )
    expect(cached.status).toBe(304)
  })
})

describe('invoice email template', () => {
  const template = { subject: 'Hi {{number}}', body: 'Pay up', button: 'Open' }

  it('loads the default text when nothing is saved', async () => {
    expect(await loadInvoiceEmailTemplate(db)).toEqual(DEFAULT_INVOICE_EMAIL)
  })

  it('refuses to save before the settings row exists', async () => {
    expect(await saveInvoiceEmailTemplate(db, template)).toBe(false)
  })

  it('saves and loads the template, and is untouched by business details saves', async () => {
    await saveSettings(db, settingsSchema.parse(input))
    expect(await saveInvoiceEmailTemplate(db, template)).toBe(true)
    await saveSettings(db, settingsSchema.parse({ ...input, taxRate: '1' }))
    expect(await loadInvoiceEmailTemplate(db)).toEqual(template)
  })
})
