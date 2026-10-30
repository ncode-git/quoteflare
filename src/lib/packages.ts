import { z } from 'zod'

export const MAX_ITEMS_PER_PACKAGE = 30

const QUANTITY_PATTERN = /^\d{1,6}$/

const itemSchema = z.strictObject({
  serviceId: z.string().min(1, 'Choose a service'),
  quantity: z
    .string()
    .trim()
    .regex(QUANTITY_PATTERN, 'Enter a whole number of 1 or more')
    .refine((q) => Number(q) >= 1, 'Enter a whole number of 1 or more'),
  optionIds: z.array(z.string().min(1)).max(50),
})

export const packageSchema = z
  .strictObject({
    id: z.string().optional(),
    name: z
      .string()
      .trim()
      .min(1, 'Name is required')
      .max(80, 'Name must be 80 characters or fewer'),
    description: z
      .string()
      .trim()
      .max(500, 'Description must be 500 characters or fewer'),
    categoryId: z.string().trim(),
    isPrivate: z.boolean(),
    items: z
      .array(itemSchema)
      .min(1, 'Add at least one service')
      .max(
        MAX_ITEMS_PER_PACKAGE,
        `Add at most ${MAX_ITEMS_PER_PACKAGE} services`,
      ),
  })
  .superRefine((value, ctx) => {
    const seen = new Set<string>()
    value.items.forEach((item, index) => {
      if (seen.has(item.serviceId)) {
        ctx.addIssue({
          code: 'custom',
          path: ['items', index, 'serviceId'],
          message: 'This service is already in the package',
        })
      }
      seen.add(item.serviceId)
    })
  })
  .transform((value) => ({
    ...value,
    categoryId: value.categoryId === '' ? null : value.categoryId,
    items: value.items.map((item) => ({
      ...item,
      quantity: Number(item.quantity),
    })),
  }))

export type PackageFormValues = z.input<typeof packageSchema>
export type PackageData = z.output<typeof packageSchema>
