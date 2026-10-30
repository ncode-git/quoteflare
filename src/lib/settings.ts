import { z } from 'zod'
import { percentToBps } from './decimal'

export const DEFAULT_CURRENCY = 'USD'

export const DEFAULT_CALCULATOR_TITLE = 'Price calculator'
export const DEFAULT_CALCULATOR_DESCRIPTION =
  'Work through the steps. The estimate updates as you choose.'

export const LOGO_MAX_BYTES = 1024 * 1024

export const LOGO_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/svg+xml': 'svg',
} as const

export const LOGO_ACCEPT = Object.keys(LOGO_TYPES).join(',')

export const settingsSchema = z.strictObject({
  businessName: z
    .string()
    .trim()
    .min(1, 'Business name is required')
    .max(120, 'Business name must be 120 characters or fewer'),
  address: z
    .string()
    .trim()
    .max(500, 'Address must be 500 characters or fewer'),
  email: z
    .string()
    .trim()
    .max(254, 'Email must be 254 characters or fewer')
    .refine(
      (value) => value === '' || z.email().safeParse(value).success,
      'Enter a valid email address',
    ),
  replyToEmail: z
    .string()
    .trim()
    .max(254, 'Reply-to email must be 254 characters or fewer')
    .refine(
      (value) => value === '' || z.email().safeParse(value).success,
      'Enter a valid email address',
    ),
  currency: z.string().regex(/^[A-Z]{3}$/, 'Use a three-letter currency code'),
  approvedCurrencies: z
    .array(z.string().regex(/^[A-Z]{3}$/, 'Use three-letter currency codes'))
    .max(30, 'Approve 30 currencies or fewer'),
  taxRate: z
    .string()
    .trim()
    .regex(
      /^\d{1,3}(\.\d{1,2})?$/,
      'Enter a percentage from 0 to 100 with up to two decimals',
    )
    .transform(percentToBps)
    .refine((bps) => bps <= 10000, 'Tax rate cannot be more than 100%'),
  invoicePrefix: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]{1,12}$/, 'Use 1 to 12 letters, numbers or hyphens'),
  nextInvoiceNumber: z
    .string()
    .trim()
    .regex(/^\d{1,9}$/, 'Enter a whole number')
    .transform(Number)
    .refine((n) => n >= 1, 'Must be 1 or higher'),
  bankName: z
    .string()
    .trim()
    .max(120, 'Bank name must be 120 characters or fewer'),
  bankBranch: z
    .string()
    .trim()
    .max(120, 'Branch must be 120 characters or fewer'),
  bankAccountName: z
    .string()
    .trim()
    .max(120, 'Account name must be 120 characters or fewer'),
  bankAccountNumber: z
    .string()
    .trim()
    .max(40, 'Account number must be 40 characters or fewer'),
  bankSwiftCode: z
    .string()
    .trim()
    .max(11, 'SWIFT code must be 11 characters or fewer'),
  paymentInstructions: z
    .string()
    .trim()
    .max(2000, 'Payment instructions must be 2000 characters or fewer'),
  paymentTermDays: z
    .string()
    .trim()
    .regex(/^\d{1,3}$/, 'Enter a whole number of days')
    .transform(Number)
    .refine((n) => n <= 365, 'Use 365 days or fewer'),
  calculatorTitle: z
    .string()
    .trim()
    .max(80, 'Title must be 80 characters or fewer'),
  calculatorDescription: z
    .string()
    .trim()
    .max(300, 'Description must be 300 characters or fewer'),
  sendReminders: z.boolean(),
})

export type SettingsFormValues = z.input<typeof settingsSchema>
export type SettingsData = z.output<typeof settingsSchema>
