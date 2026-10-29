import {
  DEFAULT_CALCULATOR_DESCRIPTION,
  DEFAULT_CALCULATOR_TITLE,
  DEFAULT_CURRENCY,
} from '#/lib/settings'
import type { Db } from '#/db'
import type { CalculatorCatalog } from '#/lib/calculator'
import { listPackageCategories, listPackages } from './packages'
import { listCategories, listServices } from './services'

export async function loadCalculatorCatalog(db: Db): Promise<
  CalculatorCatalog & {
    businessName: string
    pageTitle: string
    pageDescription: string
  }
> {
  const [services, categories, packageCategories, packages, settings] =
    await Promise.all([
      listServices(db, 'active'),
      listCategories(db),
      listPackageCategories(db),
      listPackages(db, 'active'),
      db.query.settings.findFirst(),
    ])
  const activeIds = new Set(services.map((s) => s.id))

  return {
    businessName: settings?.businessName ?? '',
    pageTitle: settings?.calculatorTitle || DEFAULT_CALCULATOR_TITLE,
    pageDescription:
      settings?.calculatorDescription || DEFAULT_CALCULATOR_DESCRIPTION,
    currency: settings?.currency ?? DEFAULT_CURRENCY,
    taxRateBps: settings?.taxRateBps ?? 0,
    categories,
    packageCategories,
    packages: packages
      .map((p) => ({
        id: p.id,
        categoryId: p.categoryId,
        name: p.name,
        description: p.description,
        items: p.items
          .filter((i) => activeIds.has(i.serviceId))
          .map((i) => ({
            serviceId: i.serviceId,
            quantity: i.quantity,
            optionIds: i.optionIds,
          })),
      }))
      .filter((p) => p.items.length > 0),
    services: services.map((s) => ({
      id: s.id,
      name: s.name,
      categoryId: s.categoryId,
      description: s.description,
      note: s.note,
      unitLabel: s.unitLabel,
      unitPrice: s.unitPrice,
      pricingMode: s.pricingMode,
      billing: s.billing,
      minQuantity: s.minQuantity,
      maxQuantity: s.maxQuantity,
      quantityStep: s.quantityStep,
      taxable: s.taxable,
      estimatedDaysMin: s.estimatedDaysMin,
      estimatedDaysMax: s.estimatedDaysMax,
      requires: s.requires.map((r) => r.id).filter((id) => activeIds.has(id)),
      groups: s.groups,
      options: s.options.map((o) => ({ ...o, active: true })),
    })),
  }
}
