import { describe, expect, it } from 'vitest'
import { settingsSchema } from './settings'

const valid = {
  businessName: 'Acme Studio',
  address: '1 Main Street',
  email: 'billing@acme.example',
  replyToEmail: 'hello@acme.example',
  currency: 'USD',
  taxRate: '7.5',
  invoicePrefix: 'INV',
  nextInvoiceNumber: '12',
  bankName: 'First Bank',
  bankBranch: '',
  bankAccountName: 'Acme Studio',
  bankAccountNumber: '12345678',
  bankSwiftCode: '',
  paymentInstructions: 'Pay by bank transfer.',
  paymentTermDays: '14',
  calculatorTitle: 'Get a quote',
  calculatorDescription: '',
  sendReminders: false,
}

const issuesFor = (patch: Record<string, unknown>) => {
  const result = settingsSchema.safeParse({ ...valid, ...patch })
  return result.success ? [] : result.error.issues.map((i) => i.path[0])
}

describe('settings schema', () => {
  it('converts the tax rate to basis points', () => {
    expect(settingsSchema.parse(valid)).toMatchObject({
      taxRate: 750,
      nextInvoiceNumber: 12,
    })
    expect(settingsSchema.parse({ ...valid, taxRate: '15' }).taxRate).toBe(1500)
    expect(settingsSchema.parse({ ...valid, taxRate: '0.05' }).taxRate).toBe(5)
    expect(settingsSchema.parse({ ...valid, taxRate: '100' }).taxRate).toBe(
      10000,
    )
  })

  it.each(['', '-1', '1.5', 'abc', '366', '1000'])(
    'rejects payment term %j',
    (paymentTermDays) => {
      expect(issuesFor({ paymentTermDays })).toEqual(['paymentTermDays'])
    },
  )

  it.each([
    ['0', 0],
    ['30', 30],
    ['365', 365],
  ])('accepts payment term %j', (paymentTermDays, days) => {
    expect(settingsSchema.parse({ ...valid, paymentTermDays })).toMatchObject({
      paymentTermDays: days,
    })
  })

  it.each(['-5', 'abc', '', '100.01', '1.234', '1e2', '5%'])(
    'rejects tax rate %j',
    (taxRate) => {
      expect(issuesFor({ taxRate })).toEqual(['taxRate'])
    },
  )

  it('requires a business name', () => {
    expect(issuesFor({ businessName: '   ' })).toEqual(['businessName'])
  })

  it('accepts an empty email and rejects a malformed one', () => {
    expect(issuesFor({ email: '' })).toEqual([])
    expect(issuesFor({ email: 'not-an-email' })).toEqual(['email'])
  })

  it('accepts an empty reply-to email and rejects a malformed one', () => {
    expect(issuesFor({ replyToEmail: '' })).toEqual([])
    expect(issuesFor({ replyToEmail: 'nope' })).toEqual(['replyToEmail'])
  })

  it('validates currency, prefix and next number', () => {
    expect(issuesFor({ currency: 'usd' })).toEqual(['currency'])
    expect(issuesFor({ invoicePrefix: 'bad prefix' })).toEqual([
      'invoicePrefix',
    ])
    expect(issuesFor({ nextInvoiceNumber: '0' })).toEqual(['nextInvoiceNumber'])
    expect(issuesFor({ nextInvoiceNumber: '1.5' })).toEqual([
      'nextInvoiceNumber',
    ])
  })

  it('rejects unknown fields', () => {
    expect(issuesFor({ extra: 'x' })).toHaveLength(1)
  })
})
