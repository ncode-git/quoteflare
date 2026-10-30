import {
  DEFAULT_CALCULATOR_DESCRIPTION,
  DEFAULT_CALCULATOR_TITLE,
  DEFAULT_CURRENCY,
} from '#/lib/settings'
import type { Db } from '#/db'
import type { CalculatorCatalog } from '#/lib/calculator'
import { fetchRates } from './exchange-rates'
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
  // Private services and packages stay out of the public catalog. The quote
  // endpoints validate against this catalog, so they reject private ids too.
  const currency = settings?.currency ?? DEFAULT_CURRENCY
  const rates = await fetchRates(currency, settings?.approvedCurrencies ?? [])
  const publicServices = services.filter((s) => !s.isPrivate)
  const publicPackages = packages.filter((p) => !p.isPrivate)
  const activeIds = new Set(publicServices.map((s) => s.id))

  return {
    businessName: settings?.businessName ?? '',
    pageTitle: settings?.calculatorTitle || DEFAULT_CALCULATOR_TITLE,
    pageDescription:
      settings?.calculatorDescription || DEFAULT_CALCULATOR_DESCRIPTION,
    currency,
    rates,
    taxRateBps: settings?.taxRateBps ?? 0,
    categories,
    packageCategories,
    packages: publicPackages
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
    services: publicServices.map((s) => ({
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
