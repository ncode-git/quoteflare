import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import type { Db } from '#/db'
import { schema } from '#/db'
import { createId } from '#/lib/id'
import type { ServiceData, ServiceStatusFilter } from '#/lib/services'

const {
  services,
  serviceOptions,
  serviceOptionGroups,
  serviceCategories,
  serviceDependencies,
} = schema

export type ServiceRow = {
  id: string
  categoryId: string | null
  categoryName: string | null
  name: string
  description: string
  note: string
  unitLabel: string
  unitPrice: number
  pricingMode: 'fixed' | 'custom'
  billing: 'one_time' | 'weekly' | 'monthly' | 'quarterly' | 'yearly'
  minQuantity: number
  maxQuantity: number | null
  quantityStep: number
  taxable: boolean
  estimatedDaysMin: number | null
  estimatedDaysMax: number | null
  active: boolean
  isPrivate: boolean
  sortOrder: number
  requires: { id: string; name: string }[]
  groups: {
    id: string
    name: string
    selection: 'single' | 'multiple'
    required: boolean
  }[]
  options: {
    id: string
    groupId: string | null
    name: string
    modifierType: 'flat' | 'percent'
    modifierValue: number
  }[]
}

export type CategoryRow = { id: string; name: string }

export type SaveServiceResult =
  { ok: true; id: string } | { ok: false; errors: Record<string, string> }

const order = [asc(services.sortOrder), asc(services.id)]

const batch = (db: Db, statements: BatchItem<'sqlite'>[]) =>
  db.batch(statements as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]])

export async function listCategories(db: Db): Promise<CategoryRow[]> {
  return db
    .select({ id: serviceCategories.id, name: serviceCategories.name })
    .from(serviceCategories)
    .orderBy(asc(serviceCategories.sortOrder), asc(serviceCategories.id))
}

export async function listServices(
  db: Db,
  status: ServiceStatusFilter,
): Promise<ServiceRow[]> {
  const rows = await db
    .select()
    .from(services)
    .where(
      status === 'all' ? undefined : eq(services.active, status === 'active'),
    )
    .orderBy(...order)
  if (rows.length === 0) return []

  const ids = rows.map((r) => r.id)
  const [categories, options, groups, dependencies, allNames] =
    await Promise.all([
      listCategories(db),
      db
        .select()
        .from(serviceOptions)
        .where(
          and(
            inArray(serviceOptions.serviceId, ids),
            eq(serviceOptions.active, true),
          ),
        )
        .orderBy(sql`${serviceOptions}.rowid`),
      db
        .select()
        .from(serviceOptionGroups)
        .where(inArray(serviceOptionGroups.serviceId, ids))
        .orderBy(
          asc(serviceOptionGroups.sortOrder),
          asc(serviceOptionGroups.id),
        ),
      db
        .select()
        .from(serviceDependencies)
        .where(inArray(serviceDependencies.serviceId, ids))
        .orderBy(sql`${serviceDependencies}.rowid`),
      db.select({ id: services.id, name: services.name }).from(services),
    ])
  const categoryName = new Map(categories.map((c) => [c.id, c.name]))
  const serviceName = new Map(allNames.map((s) => [s.id, s.name]))

  return rows.map((row) => ({
    id: row.id,
    categoryId: row.categoryId,
    categoryName: row.categoryId
      ? (categoryName.get(row.categoryId) ?? null)
      : null,
    name: row.name,
    description: row.description,
    note: row.note,
    unitLabel: row.unitLabel,
    unitPrice: row.unitPrice,
    pricingMode: row.pricingMode,
    billing: row.billing,
    minQuantity: row.minQuantity,
    maxQuantity: row.maxQuantity,
    quantityStep: row.quantityStep,
    taxable: row.taxable,
    estimatedDaysMin: row.estimatedDaysMin,
    estimatedDaysMax: row.estimatedDaysMax,
    active: row.active,
    isPrivate: row.isPrivate,
    sortOrder: row.sortOrder,
    requires: dependencies
      .filter((d) => d.serviceId === row.id)
      .map((d) => ({
        id: d.requiredServiceId,
        name: serviceName.get(d.requiredServiceId) ?? '',
      })),
    groups: groups
      .filter((g) => g.serviceId === row.id)
      .map((g) => ({
        id: g.id,
        name: g.name,
        selection: g.selection,
        required: g.required,
      })),
    options: options
      .filter((o) => o.serviceId === row.id)
      .map((o) => ({
        id: o.id,
        groupId: o.groupId,
        name: o.name,
        modifierType: o.modifierType,
        modifierValue: o.modifierValue,
      })),
  }))
}

/**
 * Walks the existing edges plus the proposed ones. A cycle exists when a
 * required service can already reach the service being saved.
 */
export function createsCycle(
  edges: { serviceId: string; requiredServiceId: string }[],
  serviceId: string,
  requiredIds: string[],
) {
  const next = new Map<string, string[]>()
  for (const e of edges) {
    if (e.serviceId === serviceId) continue
    next.set(e.serviceId, [
      ...(next.get(e.serviceId) ?? []),
      e.requiredServiceId,
    ])
  }
  const seen = new Set<string>()
  const stack = [...requiredIds]
  while (stack.length > 0) {
    const current = stack.pop()!
    if (current === serviceId) return true
    if (seen.has(current)) continue
    seen.add(current)
    stack.push(...(next.get(current) ?? []))
  }
  return false
}

async function checkDependencies(
  db: Db,
  serviceId: string,
  requiredIds: string[],
): Promise<string | null> {
  if (requiredIds.length === 0) return null
  if (requiredIds.includes(serviceId)) return 'A service cannot require itself.'
  const found = await db
    .select({ id: services.id })
    .from(services)
    .where(inArray(services.id, requiredIds))
  if (found.length !== new Set(requiredIds).size) {
    return 'A required service no longer exists.'
  }
  const edges = await db.select().from(serviceDependencies)
  return createsCycle(edges, serviceId, requiredIds)
    ? 'These requirements would make services depend on each other in a loop.'
    : null
}

const dependencyStatements = (
  db: Db,
  serviceId: string,
  requiredIds: string[],
) => [
  db
    .delete(serviceDependencies)
    .where(eq(serviceDependencies.serviceId, serviceId)),
  ...requiredIds.map((requiredServiceId) =>
    db.insert(serviceDependencies).values({ serviceId, requiredServiceId }),
  ),
]

export async function setServiceDependencies(
  db: Db,
  serviceId: string,
  requiredIds: string[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const error = await checkDependencies(db, serviceId, requiredIds)
  if (error) return { ok: false, error }
  await batch(db, dependencyStatements(db, serviceId, requiredIds))
  return { ok: true }
}

export async function saveService(
  db: Db,
  data: ServiceData,
): Promise<SaveServiceResult> {
  const fields = {
    categoryId: data.categoryId,
    name: data.name,
    description: data.description,
    note: data.note,
    unitLabel: data.unitLabel,
    unitPrice: data.unitPrice,
    pricingMode: data.pricingMode,
    billing: data.billing,
    minQuantity: data.minQuantity,
    maxQuantity: data.maxQuantity,
    quantityStep: data.quantityStep,
    taxable: data.taxable,
    isPrivate: data.isPrivate,
    estimatedDaysMin: data.estimatedDaysMin,
    estimatedDaysMax: data.estimatedDaysMax,
  }
  const fail = (key: string, message: string): SaveServiceResult => ({
    ok: false,
    errors: { [key]: message },
  })

  if (data.categoryId) {
    const category = await db
      .select({ id: serviceCategories.id })
      .from(serviceCategories)
      .where(eq(serviceCategories.id, data.categoryId))
    if (category.length === 0) {
      return fail('categoryId', 'This category no longer exists.')
    }
  }

  const serviceId = data.id ?? createId()
  const dependencyError = await checkDependencies(db, serviceId, data.requires)
  if (dependencyError) return fail('requires', dependencyError)

  const currentGroups: { id: string }[] = []
  const currentOptions: { id: string; active: boolean }[] = []
  if (data.id) {
    const existing = await db
      .select({ id: services.id })
      .from(services)
      .where(eq(services.id, serviceId))
    if (existing.length === 0) {
      return fail('form', 'This service no longer exists.')
    }
    currentGroups.push(
      ...(await db
        .select({ id: serviceOptionGroups.id })
        .from(serviceOptionGroups)
        .where(eq(serviceOptionGroups.serviceId, serviceId))),
    )
    currentOptions.push(
      ...(await db
        .select({ id: serviceOptions.id, active: serviceOptions.active })
        .from(serviceOptions)
        .where(eq(serviceOptions.serviceId, serviceId))),
    )
  }

  const ownGroupIds = new Set(currentGroups.map((g) => g.id))
  const foreignGroup = data.groups.findIndex(
    (g) => g.id && !ownGroupIds.has(g.id),
  )
  if (foreignGroup !== -1) {
    return fail(`groups[${foreignGroup}].name`, 'This group was not found.')
  }
  const ownOptionIds = new Set(currentOptions.map((o) => o.id))
  const foreignOption = data.options.findIndex(
    (o) => o.id && !ownOptionIds.has(o.id),
  )
  if (foreignOption !== -1) {
    return fail(`options[${foreignOption}].name`, 'This option was not found.')
  }

  const groupIds = new Map(
    data.groups.map((g) => [g.name.toLowerCase(), g.id ?? createId()]),
  )
  const groupStatements = data.groups.map((g, index) => {
    const groupId = groupIds.get(g.name.toLowerCase())!
    const values = {
      name: g.name,
      selection: g.selection,
      required: g.required,
      sortOrder: index,
    }
    return g.id
      ? db
          .update(serviceOptionGroups)
          .set(values)
          .where(eq(serviceOptionGroups.id, groupId))
      : db
          .insert(serviceOptionGroups)
          .values({ id: groupId, serviceId, ...values })
  })

  const optionColumns = (o: ServiceData['options'][number]) => ({
    name: o.name,
    modifierType: o.modifierType,
    modifierValue: o.modifierValue,
    groupId: o.group ? (groupIds.get(o.group.toLowerCase()) ?? null) : null,
  })
  const keptOptionIds = data.options.flatMap((o) => (o.id ? [o.id] : []))
  const droppedOptions = currentOptions.filter(
    (o) => o.active && !keptOptionIds.includes(o.id),
  )
  const keptGroupIds = new Set(groupIds.values())
  const removedGroupIds = currentGroups
    .map((g) => g.id)
    .filter((id) => !keptGroupIds.has(id))

  const serviceStatement = data.id
    ? db.update(services).set(fields).where(eq(services.id, serviceId))
    : db.insert(services).values({
        id: serviceId,
        ...fields,
        sortOrder: sql`(select coalesce(max(${services.sortOrder}), -1) + 1 from ${services})`,
      })

  await batch(db, [
    serviceStatement,
    ...groupStatements,
    ...droppedOptions.map((o) =>
      db
        .update(serviceOptions)
        .set({ active: false })
        .where(eq(serviceOptions.id, o.id)),
    ),
    ...data.options.map((o) =>
      o.id
        ? db
            .update(serviceOptions)
            .set({ ...optionColumns(o), active: true })
            .where(eq(serviceOptions.id, o.id))
        : db.insert(serviceOptions).values({ serviceId, ...optionColumns(o) }),
    ),
    ...(removedGroupIds.length > 0
      ? [
          db
            .update(serviceOptions)
            .set({ groupId: null })
            .where(inArray(serviceOptions.groupId, removedGroupIds)),
          db
            .delete(serviceOptionGroups)
            .where(inArray(serviceOptionGroups.id, removedGroupIds)),
        ]
      : []),
    ...dependencyStatements(db, serviceId, data.requires),
  ])
  return { ok: true, id: serviceId }
}

export type SaveCategoriesResult =
  { ok: true } | { ok: false; errors: Record<string, string> }

export async function saveCategories(
  db: Db,
  categories: { id?: string; name: string }[],
): Promise<SaveCategoriesResult> {
  const current = await db.select().from(serviceCategories)
  const known = new Set(current.map((c) => c.id))
  const unknown = categories.findIndex((c) => c.id && !known.has(c.id))
  if (unknown !== -1) {
    return {
      ok: false,
      errors: {
        [`categories[${unknown}].name`]: 'This category was not found.',
      },
    }
  }

  const keptIds = new Set(categories.flatMap((c) => (c.id ? [c.id] : [])))
  const removed = current.filter((c) => !keptIds.has(c.id))
  if (removed.length > 0) {
    const used = await db
      .select({ categoryId: services.categoryId })
      .from(services)
      .where(
        inArray(
          services.categoryId,
          removed.map((c) => c.id),
        ),
      )
    const usedIds = new Set(used.map((u) => u.categoryId))
    const blocked = removed.find((c) => usedIds.has(c.id))
    if (blocked) {
      return {
        ok: false,
        errors: {
          form: `"${blocked.name}" still has services. Move them to another category first.`,
        },
      }
    }
  }

  const statements: BatchItem<'sqlite'>[] = [
    ...(removed.length > 0
      ? [
          db.delete(serviceCategories).where(
            inArray(
              serviceCategories.id,
              removed.map((c) => c.id),
            ),
          ),
        ]
      : []),
    ...categories.map((c, index) =>
      c.id
        ? db
            .update(serviceCategories)
            .set({ name: c.name, sortOrder: index })
            .where(eq(serviceCategories.id, c.id))
        : db
            .insert(serviceCategories)
            .values({ name: c.name, sortOrder: index }),
    ),
  ]
  if (statements.length > 0) await batch(db, statements)
  return { ok: true }
}

export async function setServiceActive(db: Db, id: string, active: boolean) {
  const updated = await db
    .update(services)
    .set({ active })
    .where(eq(services.id, id))
    .returning({ id: services.id })
  return updated.length > 0
}

export type ReorderResult = { ok: true } | { ok: false; error: string }

/**
 * `ids` is the visible subset in its new order. The services outside that
 * subset keep their positions, and every service is renumbered 0..n-1 so
 * ties left by earlier inserts cannot make a move a no-op.
 */
export async function reorderServices(
  db: Db,
  ids: string[],
): Promise<ReorderResult> {
  if (new Set(ids).size !== ids.length) {
    return { ok: false, error: 'The list contains a duplicate service.' }
  }
  const all = await db
    .select({ id: services.id })
    .from(services)
    .orderBy(...order)
  const known = new Set(all.map((s) => s.id))
  if (ids.some((id) => !known.has(id))) {
    return { ok: false, error: 'A service in the list no longer exists.' }
  }

  const moving = new Set(ids)
  const queue = [...ids]
  const next = all.map((s) => (moving.has(s.id) ? queue.shift()! : s.id))

  await batch(
    db,
    next.map((id, index) =>
      db.update(services).set({ sortOrder: index }).where(eq(services.id, id)),
    ),
  )
  return { ok: true }
}
