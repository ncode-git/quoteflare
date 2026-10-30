import { z } from 'zod'
import type { Db } from '#/db'
import {
  BILLINGS,
  OPTION_SELECTIONS,
  PRICING_MODES,
  serviceSchema,
  type ServiceFormValues,
} from '#/lib/services'
import { packageSchema, type PackageFormValues } from '#/lib/packages'
import {
  listPackageCategories,
  listPackages,
  savePackage,
  savePackageCategories,
} from './packages'
import {
  createsCycle,
  listCategories,
  listServices,
  saveCategories,
  saveService,
  setServiceDependencies,
} from './services'

const amount = z.union([z.string(), z.number()]).transform(String)
const name = z.string().trim().min(1)

const importServiceSchema = z.strictObject({
  name,
  description: z.string().default(''),
  note: z.string().default(''),
  unitLabel: z.string().default('unit'),
  price: amount.default('0'),
  pricingMode: z.enum(PRICING_MODES).default('fixed'),
  billing: z.enum(BILLINGS).default('one_time'),
  category: z.string().trim().optional(),
  minQuantity: amount.default('1'),
  maxQuantity: amount.optional(),
  quantityStep: amount.default('1'),
  taxable: z.boolean().default(true),
  estimatedDays: z.tuple([z.number(), z.number()]).optional(),
  requires: z.array(name).default([]),
  optionGroups: z
    .array(
      z.strictObject({
        name,
        selection: z.enum(OPTION_SELECTIONS).default('multiple'),
        required: z.boolean().default(false),
      }),
    )
    .default([]),
  options: z
    .array(
      z.strictObject({
        name,
        type: z.enum(['flat', 'percent']).default('flat'),
        value: amount,
        group: z.string().trim().optional(),
      }),
    )
    .default([]),
})

const importPackageSchema = z.strictObject({
  name,
  description: z.string().default(''),
  category: z.string().trim().optional(),
  items: z
    .array(
      z.strictObject({
        service: name,
        quantity: amount.default('1'),
        options: z.array(name).default([]),
      }),
    )
    .min(1),
})

const servicesImportSchema = z.strictObject({
  categories: z.array(name).default([]),
  services: z.array(importServiceSchema).min(1).max(500),
  packageCategories: z.array(name).default([]),
  packages: z.array(importPackageSchema).max(50).default([]),
})

export type ImportReport = {
  created: string[]
  skipped: string[]
  categoriesCreated: string[]
  packageCategoriesCreated: string[]
  packagesCreated: string[]
  packagesSkipped: string[]
}

export class ImportError extends Error {}

const key = (value: string) => value.toLowerCase()

export async function importServices(
  db: Db,
  input: unknown,
  { dryRun = false }: { dryRun?: boolean } = {},
): Promise<ImportReport> {
  const parsed = servicesImportSchema.safeParse(input)
  if (!parsed.success) {
    const issues = parsed.error.issues.map(
      (i) => `${i.path.join('.') || 'file'}: ${i.message}`,
    )
    throw new ImportError(`The file is not valid.\n${issues.join('\n')}`)
  }
  const {
    categories: listed,
    services: incoming,
    packageCategories: listedPackageCategories,
    packages: incomingPackages,
  } = parsed.data

  const names = new Set<string>()
  for (const service of incoming) {
    if (names.has(key(service.name))) {
      throw new ImportError(`"${service.name}" appears twice in the file.`)
    }
    names.add(key(service.name))
  }

  const existing = await listServices(db, 'all')
  const existingByName = new Map(existing.map((s) => [key(s.name), s]))
  const skipped = incoming
    .filter((s) => existingByName.has(key(s.name)))
    .map((s) => s.name)
  const fresh = incoming.filter((s) => !existingByName.has(key(s.name)))

  const known = new Set([...existingByName.keys(), ...names])
  for (const service of fresh) {
    const missing = service.requires.find((r) => !known.has(key(r)))
    if (missing) {
      throw new ImportError(
        `"${service.name}" requires "${missing}", which is not in the file or the database.`,
      )
    }
  }

  const edges = existing.flatMap((s) =>
    s.requires.map((r) => ({
      serviceId: key(s.name),
      requiredServiceId: key(r.name),
    })),
  )
  for (const service of fresh) {
    const requiredIds = service.requires.map(key)
    if (createsCycle(edges, key(service.name), requiredIds)) {
      throw new ImportError(
        `The requirements of "${service.name}" would make services depend on each other in a loop.`,
      )
    }
    edges.push(
      ...requiredIds.map((requiredServiceId) => ({
        serviceId: key(service.name),
        requiredServiceId,
      })),
    )
  }

  const currentCategories = await listCategories(db)
  const categoryNames = new Map(currentCategories.map((c) => [key(c.name), c]))
  const wanted = [
    ...listed,
    ...fresh.flatMap((s) => (s.category ? [s.category] : [])),
  ]
  const newCategories = [
    ...new Map(
      wanted.filter((c) => !categoryNames.has(key(c))).map((c) => [key(c), c]),
    ).values(),
  ]

  const toForm = (
    service: (typeof fresh)[number],
    categoryId: string,
  ): ServiceFormValues => ({
    name: service.name,
    description: service.description,
    note: service.note,
    unitLabel: service.unitLabel,
    unitPrice: service.price,
    pricingMode: service.pricingMode,
    billing: service.billing,
    categoryId,
    minQuantity: service.minQuantity,
    maxQuantity: service.maxQuantity ?? '',
    quantityStep: service.quantityStep,
    taxable: service.taxable,
    isPrivate: false,
    estimatedDaysMin: service.estimatedDays
      ? String(service.estimatedDays[0])
      : '',
    estimatedDaysMax: service.estimatedDays
      ? String(service.estimatedDays[1])
      : '',
    requires: [],
    groups: service.optionGroups,
    options: service.options.map((o) => ({
      name: o.name,
      modifierType: o.type,
      modifierValue: o.value,
      group: o.group ?? '',
    })),
  })

  for (const service of fresh) {
    const result = serviceSchema.safeParse(toForm(service, ''))
    if (!result.success) {
      const issues = result.error.issues.map(
        (i) => `${i.path.join('.') || 'service'}: ${i.message}`,
      )
      throw new ImportError(
        `"${service.name}" is not valid.\n${issues.join('\n')}`,
      )
    }
  }

  const packageNames = new Set<string>()
  for (const pkg of incomingPackages) {
    if (packageNames.has(key(pkg.name))) {
      throw new ImportError(`Package "${pkg.name}" appears twice in the file.`)
    }
    packageNames.add(key(pkg.name))
  }
  const existingPackages = await listPackages(db, 'all')
  const existingPackageNames = new Set(existingPackages.map((p) => key(p.name)))
  const freshPackages = incomingPackages.filter(
    (p) => !existingPackageNames.has(key(p.name)),
  )

  const optionNames = new Map<string, Set<string>>([
    ...existing.map(
      (s) => [key(s.name), new Set(s.options.map((o) => key(o.name)))] as const,
    ),
    ...fresh.map(
      (s) => [key(s.name), new Set(s.options.map((o) => key(o.name)))] as const,
    ),
  ])
  const currentPackageCategories = await listPackageCategories(db)
  const packageCategoryNames = new Map(
    currentPackageCategories.map((c) => [key(c.name), c]),
  )
  const newPackageCategories = [
    ...new Map(
      [
        ...listedPackageCategories,
        ...freshPackages.flatMap((p) => (p.category ? [p.category] : [])),
      ]
        .filter((c) => !packageCategoryNames.has(key(c)))
        .map((c) => [key(c), c]),
    ).values(),
  ]

  // Services are keyed by name here and swapped for ids once they exist.
  const toPackageForm = (
    pkg: (typeof freshPackages)[number],
    serviceKey: (name: string) => string,
    optionKey: (service: string, option: string) => string,
    categoryId: string,
  ): PackageFormValues => ({
    name: pkg.name,
    description: pkg.description,
    categoryId,
    isPrivate: false,
    items: pkg.items.map((i) => ({
      serviceId: serviceKey(i.service),
      quantity: i.quantity,
      optionIds: i.options.map((o) => optionKey(i.service, o)),
    })),
  })
  for (const pkg of freshPackages) {
    for (const item of pkg.items) {
      const options = optionNames.get(key(item.service))
      if (!options) {
        throw new ImportError(
          `Package "${pkg.name}" uses "${item.service}", which is not in the file or the database.`,
        )
      }
      const missing = item.options.find((o) => !options.has(key(o)))
      if (missing) {
        throw new ImportError(
          `Package "${pkg.name}" uses option "${missing}", which "${item.service}" does not have.`,
        )
      }
    }
    const result = packageSchema.safeParse(
      toPackageForm(
        pkg,
        key,
        (service, option) => `${key(service)}:${option}`,
        '',
      ),
    )
    if (!result.success) {
      const issues = result.error.issues.map(
        (i) => `${i.path.join('.') || 'package'}: ${i.message}`,
      )
      throw new ImportError(
        `Package "${pkg.name}" is not valid.\n${issues.join('\n')}`,
      )
    }
  }

  const report: ImportReport = {
    created: fresh.map((s) => s.name),
    skipped,
    categoriesCreated: newCategories,
    packageCategoriesCreated: newPackageCategories,
    packagesCreated: freshPackages.map((p) => p.name),
    packagesSkipped: incomingPackages
      .filter((p) => existingPackageNames.has(key(p.name)))
      .map((p) => p.name),
  }
  if (dryRun) return report

  if (newCategories.length > 0) {
    const saved = await saveCategories(db, [
      ...currentCategories,
      ...newCategories.map((categoryName) => ({ name: categoryName })),
    ])
    if (!saved.ok) throw new ImportError(Object.values(saved.errors).join(' '))
  }
  const categoryIds = new Map(
    (await listCategories(db)).map((c) => [key(c.name), c.id]),
  )

  const createdIds = new Map<string, string>()
  for (const service of fresh) {
    const categoryId = service.category
      ? (categoryIds.get(key(service.category)) ?? '')
      : ''
    const saved = await saveService(
      db,
      serviceSchema.parse(toForm(service, categoryId)),
    )
    if (!saved.ok) {
      throw new ImportError(
        `"${service.name}": ${Object.values(saved.errors).join(' ')}`,
      )
    }
    createdIds.set(key(service.name), saved.id)
  }

  const idByName = new Map([
    ...existing.map((s) => [key(s.name), s.id] as const),
    ...createdIds,
  ])
  for (const service of fresh) {
    if (service.requires.length === 0) continue
    const result = await setServiceDependencies(
      db,
      createdIds.get(key(service.name))!,
      service.requires.map((r) => idByName.get(key(r))!),
    )
    if (!result.ok) throw new ImportError(`"${service.name}": ${result.error}`)
  }

  if (newPackageCategories.length > 0) {
    const saved = await savePackageCategories(db, [
      ...currentPackageCategories,
      ...newPackageCategories.map((categoryName) => ({ name: categoryName })),
    ])
    if (!saved.ok) throw new ImportError(Object.values(saved.errors).join(' '))
  }
  const packageCategoryIds = new Map(
    (await listPackageCategories(db)).map((c) => [key(c.name), c.id]),
  )

  if (freshPackages.length > 0) {
    const optionIds = new Map(
      (await listServices(db, 'all')).flatMap((s) =>
        s.options.map((o) => [`${key(s.name)}:${key(o.name)}`, o.id] as const),
      ),
    )
    for (const pkg of freshPackages) {
      const saved = await savePackage(
        db,
        packageSchema.parse(
          toPackageForm(
            pkg,
            (service) => idByName.get(key(service))!,
            (service, option) =>
              optionIds.get(`${key(service)}:${key(option)}`)!,
            pkg.category
              ? (packageCategoryIds.get(key(pkg.category)) ?? '')
              : '',
          ),
        ),
      )
      if (!saved.ok) {
        throw new ImportError(
          `Package "${pkg.name}": ${Object.values(saved.errors).join(' ')}`,
        )
      }
    }
  }

  return report
}
