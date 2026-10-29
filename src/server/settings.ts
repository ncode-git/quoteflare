import { eq } from 'drizzle-orm'
import type { Db } from '#/db'
import { schema } from '#/db'
import {
  DEFAULT_CURRENCY,
  LOGO_MAX_BYTES,
  LOGO_TYPES,
  type SettingsData,
  type SettingsFormValues,
} from '#/lib/settings'
import { bpsToPercent } from '#/lib/decimal'
import { createId } from '#/lib/id'
import { isSafeSvg } from '#/lib/svg'
import { withDefaults, type InvoiceEmailTemplate } from '#/lib/email-template'

const { settings } = schema

export type LogoResult =
  { ok: true; key: string } | { ok: false; error: string }

const emptySettings: SettingsFormValues = {
  businessName: '',
  address: '',
  email: '',
  replyToEmail: '',
  currency: DEFAULT_CURRENCY,
  taxRate: '0',
  invoicePrefix: 'INV',
  nextInvoiceNumber: '1',
  bankName: '',
  bankBranch: '',
  bankAccountName: '',
  bankAccountNumber: '',
  bankSwiftCode: '',
  paymentInstructions: '',
  paymentTermDays: '14',
  calculatorTitle: '',
  calculatorDescription: '',
  sendReminders: false,
}

export async function loadSettings(db: Db) {
  const row = await db.query.settings.findFirst()
  if (!row) return { values: emptySettings, logoKey: null }
  const values: SettingsFormValues = {
    businessName: row.businessName,
    address: row.address,
    email: row.email,
    replyToEmail: row.replyToEmail,
    currency: row.currency,
    taxRate: bpsToPercent(row.taxRateBps),
    invoicePrefix: row.invoicePrefix,
    nextInvoiceNumber: String(row.nextInvoiceNumber),
    bankName: row.bankName,
    bankBranch: row.bankBranch,
    bankAccountName: row.bankAccountName,
    bankAccountNumber: row.bankAccountNumber,
    bankSwiftCode: row.bankSwiftCode,
    paymentInstructions: row.paymentInstructions,
    paymentTermDays: String(row.paymentTermDays),
    calculatorTitle: row.calculatorTitle,
    calculatorDescription: row.calculatorDescription,
    sendReminders: row.sendReminders,
  }
  return { values, logoKey: row.logoKey }
}

/** Public-safe subset of the settings, for pages anyone can open. */
export async function loadBranding(db: Db) {
  const row = await db.query.settings.findFirst()
  return {
    name: row?.businessName.trim() ?? '',
    hasLogo: Boolean(row?.logoKey),
  }
}

export async function saveSettings(db: Db, data: SettingsData) {
  const columns = {
    businessName: data.businessName,
    address: data.address,
    email: data.email,
    replyToEmail: data.replyToEmail,
    currency: data.currency,
    taxRateBps: data.taxRate,
    invoicePrefix: data.invoicePrefix,
    nextInvoiceNumber: data.nextInvoiceNumber,
    bankName: data.bankName,
    bankBranch: data.bankBranch,
    bankAccountName: data.bankAccountName,
    bankAccountNumber: data.bankAccountNumber,
    bankSwiftCode: data.bankSwiftCode,
    paymentInstructions: data.paymentInstructions,
    paymentTermDays: data.paymentTermDays,
    calculatorTitle: data.calculatorTitle,
    calculatorDescription: data.calculatorDescription,
    sendReminders: data.sendReminders,
  }
  await db
    .insert(settings)
    .values({ id: 'main', ...columns })
    .onConflictDoUpdate({ target: settings.id, set: columns })
}

const startsWith = (bytes: Uint8Array, magic: number[]) =>
  magic.every((b, i) => bytes[i] === b)

function matchesType(type: string, bytes: Uint8Array) {
  if (type === 'image/png') {
    return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  }
  if (type === 'image/jpeg') return startsWith(bytes, [0xff, 0xd8, 0xff])
  const head = new TextDecoder().decode(bytes.subarray(0, 2048))
  return /<svg[\s>]/i.test(head)
}

const formatSize = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

export async function storeLogo(
  db: Db,
  bucket: R2Bucket | undefined,
  file: File,
): Promise<LogoResult> {
  if (!bucket) {
    return {
      ok: false,
      error: 'Logo storage is not set up on this deployment.',
    }
  }
  if (file.size > LOGO_MAX_BYTES) {
    return {
      ok: false,
      error: `The logo must be 1 MB or smaller. This file is ${formatSize(file.size)}.`,
    }
  }
  const ext = LOGO_TYPES[file.type as keyof typeof LOGO_TYPES]
  if (!ext) {
    return { ok: false, error: 'The logo must be a PNG, JPG or SVG image.' }
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytes.byteLength > LOGO_MAX_BYTES) {
    return { ok: false, error: 'The logo must be 1 MB or smaller.' }
  }
  if (!matchesType(file.type, bytes)) {
    return { ok: false, error: 'The file contents do not match its type.' }
  }
  if (
    file.type === 'image/svg+xml' &&
    !isSafeSvg(new TextDecoder().decode(bytes))
  ) {
    return {
      ok: false,
      error: 'The SVG contains scripts or embedded content. Remove them.',
    }
  }

  const current = await db.query.settings.findFirst()
  if (!current) {
    return {
      ok: false,
      error: 'Save your business details before adding a logo.',
    }
  }

  const key = `logo/${createId()}.${ext}`
  await bucket.put(key, bytes, { httpMetadata: { contentType: file.type } })
  await db.update(settings).set({ logoKey: key }).where(eq(settings.id, 'main'))
  if (current.logoKey) await bucket.delete(current.logoKey)
  return { ok: true, key }
}

export async function readLogo(
  db: Db,
  bucket: R2Bucket | undefined,
  request: Request,
) {
  if (!bucket) return new Response('Not found', { status: 404 })
  const row = await db.query.settings.findFirst()
  const object = row?.logoKey ? await bucket.get(row.logoKey) : null
  if (!object) return new Response('Not found', { status: 404 })

  const headers = new Headers({
    'Content-Type':
      object.httpMetadata?.contentType ?? 'application/octet-stream',
    ETag: object.httpEtag,
    'Cache-Control': 'public, max-age=0, must-revalidate',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy':
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
  })
  if (request.headers.get('If-None-Match') === object.httpEtag) {
    return new Response(null, { status: 304, headers })
  }
  return new Response(object.body, { headers })
}

export async function loadInvoiceEmailTemplate(
  db: Db,
): Promise<InvoiceEmailTemplate> {
  const row = await db.query.settings.findFirst()
  return withDefaults({
    subject: row?.invoiceEmailSubject ?? '',
    body: row?.invoiceEmailBody ?? '',
    button: row?.invoiceEmailButton ?? '',
  })
}

/** Needs an existing settings row, which the business details form creates. */
export async function saveInvoiceEmailTemplate(
  db: Db,
  template: InvoiceEmailTemplate,
): Promise<boolean> {
  const updated = await db
    .update(settings)
    .set({
      invoiceEmailSubject: template.subject,
      invoiceEmailBody: template.body,
      invoiceEmailButton: template.button,
    })
    .where(eq(settings.id, 'main'))
    .returning({ id: settings.id })
  return updated.length > 0
}
