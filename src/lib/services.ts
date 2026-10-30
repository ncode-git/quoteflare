import { z } from 'zod'
import { decimalToMinor, percentToBps } from './decimal'

const SERVICE_STATUS_FILTERS = ['active', 'archived', 'all'] as const
export type ServiceStatusFilter = (typeof SERVICE_STATUS_FILTERS)[number]

export const PRICING_MODES = ['fixed', 'custom'] as const
export const BILLINGS = [
  'one_time',
  'weekly',
  'monthly',
  'quarterly',
  'yearly',
] as const
export const OPTION_SELECTIONS = ['single', 'multiple'] as const

export const PRICING_MODE_LABELS: Record<
  (typeof PRICING_MODES)[number],
  string
> = {
  fixed: 'Fixed price',
  custom: 'Set per quote',
}

export const BILLING_LABELS: Record<(typeof BILLINGS)[number], string> = {
  one_time: 'One time',
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  yearly: 'Yearly',
}

export const SELECTION_LABELS: Record<
  (typeof OPTION_SELECTIONS)[number],
  string
> = {
  single: 'Choose one',
  multiple: 'Choose any',
}

export const MAX_OPTIONS_PER_SERVICE = 20
export const MAX_GROUPS_PER_SERVICE = 10
const MAX_DEPENDENCIES_PER_SERVICE = 30
export const MAX_CATEGORIES = 50

const MONEY_PATTERN = /^\d{1,9}(\.\d{1,2})?$/
const PERCENT_PATTERN = /^\d{1,4}(\.\d{1,2})?$/
const INTEGER_PATTERN = /^\d{1,6}$/
const DAYS_PATTERN = /^\d{1,3}(\.\d)?$/

const optionSchema = z
  .strictObject({
    id: z.string().optional(),
    name: z
      .string()
      .trim()
      .min(1, 'Option name is required')
      .max(80, 'Option name must be 80 characters or fewer'),
    modifierType: z.enum(['flat', 'percent']),
    modifierValue: z.string().trim(),
    group: z.string().trim().max(80),
  })
  .superRefine((option, ctx) => {
    const flat = option.modifierType === 'flat'
    if ((flat ? MONEY_PATTERN : PERCENT_PATTERN).test(option.modifierValue)) {
      return
    }
    ctx.addIssue({
      code: 'custom',
      path: ['modifierValue'],
      message: flat
        ? 'Enter an amount like 49.99'
        : 'Enter a percentage from 0 to 9999.99',
    })
  })
  .transform((option) => ({
    ...option,
    modifierValue:
      option.modifierType === 'flat'
        ? decimalToMinor(option.modifierValue)
        : percentToBps(option.modifierValue),
  }))

const groupSchema = z.strictObject({
  id: z.string().optional(),
  name: z
    .string()
    .trim()
    .min(1, 'Group name is required')
    .max(80, 'Group name must be 80 characters or fewer'),
  selection: z.enum(OPTION_SELECTIONS),
  required: z.boolean(),
})

const optionalInteger = (value: string) => (value === '' ? null : Number(value))

export const serviceSchema = z
  .strictObject({
    id: z.string().optional(),
    name: z
      .string()
      .trim()
      .min(1, 'Name is required')
      .max(120, 'Name must be 120 characters or fewer'),
    description: z
      .string()
      .trim()
      .max(500, 'Description must be 500 characters or fewer'),
    note: z.string().trim().max(200, 'Note must be 200 characters or fewer'),
    unitLabel: z
      .string()
      .trim()
      .min(1, 'Unit label is required')
      .max(30, 'Unit label must be 30 characters or fewer'),
    unitPrice: z.string().trim(),
    pricingMode: z.enum(PRICING_MODES),
    billing: z.enum(BILLINGS),
    categoryId: z.string().trim(),
    minQuantity: z.string().trim(),
    maxQuantity: z.string().trim(),
    quantityStep: z.string().trim(),
    taxable: z.boolean(),
    isPrivate: z.boolean(),
    estimatedDaysMin: z.string().trim(),
    estimatedDaysMax: z.string().trim(),
    requires: z
      .array(z.string().min(1))
      .max(
        MAX_DEPENDENCIES_PER_SERVICE,
        `A service can require at most ${MAX_DEPENDENCIES_PER_SERVICE} others`,
      ),
    groups: z
      .array(groupSchema)
      .max(
        MAX_GROUPS_PER_SERVICE,
        `A service can have at most ${MAX_GROUPS_PER_SERVICE} option groups`,
      ),
    options: z
      .array(optionSchema)
      .max(
        MAX_OPTIONS_PER_SERVICE,
        `A service can have at most ${MAX_OPTIONS_PER_SERVICE} options`,
      ),
  })
  .superRefine((service, ctx) => {
    const issue = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message })

    if (service.unitPrice === '' && service.pricingMode === 'fixed') {
      issue(['unitPrice'], 'Enter a price like 49.99')
    } else if (
      service.unitPrice !== '' &&
      !MONEY_PATTERN.test(service.unitPrice)
    ) {
      issue(['unitPrice'], 'Enter a price like 49.99')
    }

    const min = INTEGER_PATTERN.test(service.minQuantity)
      ? Number(service.minQuantity)
      : null
    if (min === null || min < 1) {
      issue(['minQuantity'], 'Enter a whole number, 1 or higher')
    }
    if (
      !INTEGER_PATTERN.test(service.quantityStep) ||
      Number(service.quantityStep) < 1
    ) {
      issue(['quantityStep'], 'Enter a whole number, 1 or higher')
    }
    if (service.maxQuantity !== '') {
      if (!INTEGER_PATTERN.test(service.maxQuantity)) {
        issue(['maxQuantity'], 'Enter a whole number or leave it empty')
      } else if (min !== null && Number(service.maxQuantity) < min) {
        issue(['maxQuantity'], 'Maximum cannot be below the minimum')
      }
    }

    for (const field of ['estimatedDaysMin', 'estimatedDaysMax'] as const) {
      if (service[field] !== '' && !DAYS_PATTERN.test(service[field])) {
        issue([field], 'Enter days like 2 or 0.5')
      }
    }
    if (
      DAYS_PATTERN.test(service.estimatedDaysMin) &&
      DAYS_PATTERN.test(service.estimatedDaysMax) &&
      Number(service.estimatedDaysMax) < Number(service.estimatedDaysMin)
    ) {
      issue(['estimatedDaysMax'], 'Maximum cannot be below the minimum')
    }

    if (new Set(service.requires).size !== service.requires.length) {
      issue(['requires'], 'Each required service can be listed once')
    }
    if (service.id && service.requires.includes(service.id)) {
      issue(['requires'], 'A service cannot require itself')
    }

    const groupNames = new Set<string>()
    service.groups.forEach((group, index) => {
      const key = group.name.toLowerCase()
      if (groupNames.has(key)) {
        issue(['groups', index, 'name'], 'Group names must be different')
      }
      groupNames.add(key)
    })

    const optionNames = new Set<string>()
    service.options.forEach((option, index) => {
      const key = option.name.toLowerCase()
      if (optionNames.has(key)) {
        issue(['options', index, 'name'], 'Option names must be different')
      }
      optionNames.add(key)
      if (option.group && !groupNames.has(option.group.toLowerCase())) {
        issue(['options', index, 'group'], 'Choose one of the listed groups')
      }
    })
  })
  .transform((service) => ({
    ...service,
    unitPrice: service.unitPrice === '' ? 0 : decimalToMinor(service.unitPrice),
    categoryId: service.categoryId === '' ? null : service.categoryId,
    minQuantity: Number(service.minQuantity),
    maxQuantity: optionalInteger(service.maxQuantity),
    quantityStep: Number(service.quantityStep),
    estimatedDaysMin:
      service.estimatedDaysMin === '' ? null : Number(service.estimatedDaysMin),
    estimatedDaysMax:
      service.estimatedDaysMax === '' ? null : Number(service.estimatedDaysMax),
  }))

export type ServiceFormValues = z.input<typeof serviceSchema>
export type ServiceData = z.output<typeof serviceSchema>

export const categoriesSchema = z
  .strictObject({
    categories: z
      .array(
        z.strictObject({
          id: z.string().optional(),
          name: z
            .string()
            .trim()
            .min(1, 'Category name is required')
            .max(80, 'Category name must be 80 characters or fewer'),
        }),
      )
      .max(MAX_CATEGORIES, `At most ${MAX_CATEGORIES} categories`),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>()
    value.categories.forEach((category, index) => {
      const key = category.name.toLowerCase()
      if (seen.has(key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['categories', index, 'name'],
          message: 'Category names must be different',
        })
      }
      seen.add(key)
    })
  })

export type CategoriesFormValues = z.input<typeof categoriesSchema>

export const reorderSchema = z.strictObject({
  ids: z.array(z.string().min(1)).min(1).max(500),
})

export const serviceFilterSchema = z.strictObject({
  status: z.enum(SERVICE_STATUS_FILTERS),
})

export const toggleSchema = z.strictObject({
  id: z.string().min(1),
  active: z.boolean(),
})

export const issuePath = (path: PropertyKey[]) =>
  path.reduce<string>(
    (out, part) =>
      typeof part === 'number'
        ? `${out}[${part}]`
        : out
          ? `${out}.${String(part)}`
          : String(part),
    '',
  )
