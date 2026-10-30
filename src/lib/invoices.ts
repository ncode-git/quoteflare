import { z } from 'zod'
import { invoiceStatuses, type InvoiceStatus } from '#/db/schema'
import { decimalToMinor, percentToBps } from './decimal'
import { calculatePrice, type PricingService } from './pricing'

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  paid: 'Paid',
  overdue: 'Overdue',
  void: 'Void',
}

export const INVOICE_STATUS_OPTIONS = invoiceStatuses.map((value) => ({
  value,
  label: INVOICE_STATUS_LABELS[value],
}))

export const INVOICE_TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  draft: ['sent', 'void'],
  sent: ['paid', 'overdue', 'void'],
  overdue: ['paid', 'void'],
  paid: ['sent'],
  void: [],
}

export const EMAILABLE_STATUSES: InvoiceStatus[] = ['draft', 'sent', 'overdue']

export const canTransition = (from: InvoiceStatus, to: InvoiceStatus) =>
  INVOICE_TRANSITIONS[from].includes(to)

export const invoiceStatusChangeSchema = z.strictObject({
  id: z.string().min(1).max(64),
  status: z.enum(invoiceStatuses),
})

export const advancePaidSchema = z.strictObject({
  id: z.string().min(1).max(64),
  paid: z.boolean(),
})

export const invoiceIdSchema = z.strictObject({
  id: z.string().min(1).max(64),
})

export const MAX_INVOICE_ITEMS = 50
export const MIN_ADVANCE_PERCENT = 1
export const MAX_ADVANCE_PERCENT = 99

export const toIsoDate = (date: Date) => date.toISOString().slice(0, 10)

const isRealDate = (value: string) => {
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.getTime()) && toIsoDate(date) === value
}

export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a date')
  .refine(isRealDate, 'Enter a valid date')

const moneySchema = (max: number, label: string) =>
  z
    .string()
    .trim()
    .regex(
      new RegExp(`^\\d{1,${max}}(\\.\\d{1,2})?$`),
      `${label} must be a number with up to two decimals`,
    )
    .transform(decimalToMinor)

export const invoiceItemSchema = z.strictObject({
  description: z
    .string()
    .trim()
    .min(1, 'Description is required')
    .max(500, 'Description must be 500 characters or fewer'),
  quantity: z
    .string()
    .trim()
    .regex(/^\d{1,4}$/, 'Enter a whole number')
    .transform(Number)
    .refine((n) => n >= 1, 'Must be 1 or higher'),
  unitPrice: moneySchema(8, 'Unit price'),
  taxable: z.boolean().default(true),
})

export const invoiceSchema = z
  .strictObject({
    id: z.string().min(1).max(64).optional(),
    clientId: z.string().min(1, 'Choose a client').max(64),
    issueDate: dateSchema,
    dueDate: dateSchema,
    taxRate: z
      .string()
      .trim()
      .regex(
        /^\d{1,3}(\.\d{1,2})?$/,
        'Enter a percentage from 0 to 100 with up to two decimals',
      )
      .transform(percentToBps)
      .refine((bps) => bps <= 10000, 'Tax rate cannot be more than 100%'),
    discount: moneySchema(9, 'Discount'),
    // Percentage billed up front. Empty means no advance.
    advance: z
      .string()
      .trim()
      .default('')
      .refine(
        (value) =>
          value === '' ||
          (/^\d{1,2}(\.\d{1,2})?$/.test(value) &&
            Number(value) >= MIN_ADVANCE_PERCENT &&
            Number(value) <= MAX_ADVANCE_PERCENT),
        `Enter a percentage from ${MIN_ADVANCE_PERCENT} to ${MAX_ADVANCE_PERCENT}, or leave it empty`,
      )
      .transform((value) => (value === '' ? null : percentToBps(value))),
    notes: z
      .string()
      .trim()
      .max(2000, 'Notes must be 2000 characters or fewer')
      .default(''),
    paymentLink: z
      .string()
      .trim()
      .max(2000, 'Payment link must be 2000 characters or fewer')
      .refine((value) => {
        if (value === '') return true
        try {
          return new URL(value).protocol === 'https:'
        } catch {
          return false
        }
      }, 'Enter a full link starting with https://')
      .default(''),
    items: z
      .array(invoiceItemSchema)
      .min(1, 'Add at least one line item')
      .max(MAX_INVOICE_ITEMS, `Use ${MAX_INVOICE_ITEMS} line items or fewer`),
  })
  .refine((invoice) => invoice.dueDate >= invoice.issueDate, {
    path: ['dueDate'],
    message: 'Due date cannot be before the issue date',
  })

export type InvoiceFormValues = z.input<typeof invoiceSchema>
export type InvoiceData = z.output<typeof invoiceSchema>

export const emptyInvoiceItem: InvoiceFormValues['items'][number] = {
  description: '',
  quantity: '1',
  unitPrice: '',
  taxable: true,
}

export type InvoiceTotals = {
  subtotal: number
  discountAmount: number
  taxAmount: number
  total: number
}

type TotalsItem = { quantity: number; unitPrice: number; taxable?: boolean }

/** Prices invoice lines with the shared pricing function. Every line is a one-time, fixed-price line, taxable unless flagged otherwise. */
export function computeInvoiceTotals(
  items: TotalsItem[],
  taxRateBps: number,
  discount: number,
): InvoiceTotals {
  const services: PricingService[] = items.map((item, index) => ({
    id: String(index),
    name: `Line ${index + 1}`,
    unitPrice: item.unitPrice,
    pricingMode: 'fixed',
    billing: 'one_time',
    minQuantity: 1,
    maxQuantity: null,
    quantityStep: 1,
    taxable: item.taxable ?? true,
    groups: [],
    options: [],
  }))
  const result = calculatePrice({
    services,
    selections: items.map((item, index) => ({
      serviceId: String(index),
      quantity: item.quantity,
      optionIds: [],
    })),
    taxRateBps,
    discount,
  })
  if (!result.ok) {
    throw new Error(
      `Invoice totals could not be calculated: ${result.errors.map((e) => e.code).join(', ')}`,
    )
  }
  const { subtotal, discountAmount, taxAmount, total } = result
  return { subtotal, discountAmount, taxAmount, total }
}

/** Totals for a form that may be half filled in. Rows that do not parse are skipped. */
export function previewTotals(values: InvoiceFormValues): InvoiceTotals {
  const items = values.items.flatMap((item) => {
    const quantity = invoiceItemSchema.shape.quantity.safeParse(item.quantity)
    const unitPrice = invoiceItemSchema.shape.unitPrice.safeParse(
      item.unitPrice,
    )
    return quantity.success && unitPrice.success
      ? [
          {
            quantity: quantity.data,
            unitPrice: unitPrice.data,
            taxable: item.taxable ?? true,
          },
        ]
      : []
  })
  const taxRate = invoiceSchema.shape.taxRate.safeParse(values.taxRate)
  const discount = invoiceSchema.shape.discount.safeParse(values.discount)
  return computeInvoiceTotals(
    items,
    taxRate.success ? taxRate.data : 0,
    discount.success ? discount.data : 0,
  )
}

export type InvoiceAdvance = {
  bps: number
  paidAt: string | null
  advanceAmount: number
  balanceAmount: number
}

export function advanceFor(
  total: number,
  advanceBps: number | null,
  advancePaidAt: string | null,
): InvoiceAdvance | null {
  if (!advanceBps) return null
  const advanceAmount = Math.round((total * advanceBps) / 10000)
  return {
    bps: advanceBps,
    paidAt: advancePaidAt,
    advanceAmount,
    balanceAmount: total - advanceAmount,
  }
}

/** What the client still owes: the advance until it is paid, then the balance. */
export function amountDue(
  total: number,
  advanceBps: number | null,
  advancePaidAt: string | null,
): number {
  const advance = advanceFor(total, advanceBps, advancePaidAt)
  if (!advance) return total
  return advance.paidAt ? advance.balanceAmount : advance.advanceAmount
}

export const addDays = (date: string, days: number) => {
  const next = new Date(`${date}T00:00:00Z`)
  next.setUTCDate(next.getUTCDate() + days)
  return toIsoDate(next)
}

export const todayIso = () => {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}
