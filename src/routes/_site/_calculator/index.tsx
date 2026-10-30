import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { ArrowRightIcon, PencilRulerIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import {
  evaluate,
  stateForPackage,
  type CalculatorCatalog,
  type CalculatorPackage,
} from '#/lib/calculator'
import { SCRATCH, useCalculator } from './-components/calculator-context'
import { ALL_CATEGORIES, CategoryFilter } from './-components/category-filter'

export const Route = createFileRoute('/_site/_calculator/')({
  component: PackageStep,
})

const describePrice = (
  price: { total: number; recurring: number; partial: boolean },
  money: (minor: number) => string,
) => {
  const parts = []
  if (price.total > 0 || price.recurring === 0) {
    parts.push(money(price.total))
  }
  if (price.recurring > 0) {
    parts.push(`${money(price.recurring)} recurring`)
  }
  return `${price.partial ? 'From ' : ''}${parts.join(' + ')}`
}

type Section = {
  id: string
  name: string | null
  packages: CalculatorPackage[]
}

/**
 * Groups packages under their categories. Packages without a category come
 * last, under "Other" when categories exist and without a heading otherwise.
 */
function groupByCategory(catalog: CalculatorCatalog): Section[] {
  const sections: Section[] = catalog.packageCategories.map((c) => ({
    ...c,
    packages: catalog.packages.filter((p) => p.categoryId === c.id),
  }))
  const loose = catalog.packages.filter(
    (p) => !catalog.packageCategories.some((c) => c.id === p.categoryId),
  )
  const visible = sections.filter((s) => s.packages.length > 0)
  if (loose.length > 0) {
    visible.push({
      id: 'other',
      name: visible.length > 0 ? 'Other' : null,
      packages: loose,
    })
  }
  return visible
}

function PackageStep() {
  const { catalog, state, chosen, choose, money } = useCalculator()
  const navigate = useNavigate()
  const [pending, setPending] = useState<string | null>(null)

  const names = useMemo(
    () => new Map(catalog.services.map((s) => [s.id, s.name])),
    [catalog],
  )
  const [category, setCategory] = useState(ALL_CATEGORIES)
  const sections = useMemo(() => groupByCategory(catalog), [catalog])
  const shown =
    category === ALL_CATEGORIES
      ? sections
      : sections.filter((s) => s.id === category)
  const totals = useMemo(
    () =>
      new Map(
        catalog.packages.map((pkg) => {
          const result = evaluate(catalog, stateForPackage(catalog, pkg))
          return [
            pkg.id,
            {
              total: result.breakdown.total,
              recurring: result.breakdown.recurring.total,
              partial: Object.keys(result.problems).length > 0,
            },
          ]
        }),
      ),
    [catalog],
  )

  const go = (target: string) => {
    if (target !== chosen) choose(target)
    setPending(null)
    void navigate({ to: '/scope' })
  }

  const pick = (target: string) => {
    if (target !== chosen && Object.keys(state).length > 0) setPending(target)
    else go(target)
  }

  return (
    <>
      <div className="grid gap-8">
        <div className="flex w-full justify-end">
          <CategoryFilter
            sections={sections}
            value={category}
            onChange={setCategory}
            label="Filter packages by category"
          />
        </div>

        {shown.map((section) => (
          <section key={section.id} className="grid gap-4">
            {section.name && (
              <h2 className="text-lg font-semibold">{section.name}</h2>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              {section.packages.map((pkg) => {
                const price = totals.get(pkg.id)
                return (
                  <PackageCard
                    key={pkg.id}
                    selected={chosen === pkg.id}
                    title={pkg.name}
                    description={pkg.description}
                    services={pkg.items.map((i) => {
                      const name = names.get(i.serviceId) ?? ''
                      return i.quantity > 1 ? `${name} x${i.quantity}` : name
                    })}
                    price={price && describePrice(price, money)}
                    action="Choose package"
                    onSelect={() => pick(pkg.id)}
                  />
                )
              })}
            </div>
          </section>
        ))}
        <div className="grid gap-4 sm:grid-cols-2">
          <PackageCard
            selected={chosen === SCRATCH}
            title="Start from scratch"
            description="Pick each service yourself."
            action="Choose services"
            icon={<PencilRulerIcon className="size-5" />}
            onSelect={() => pick(SCRATCH)}
          />
        </div>
      </div>

      <Dialog
        open={pending !== null}
        onOpenChange={(o) => !o && setPending(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Replace your selection?</DialogTitle>
            <DialogDescription>
              Choosing a different starting point clears the services you have
              picked so far.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPending(null)}>
              Keep my selection
            </Button>
            <Button onClick={() => pending && go(pending)}>Replace</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function PackageCard({
  selected,
  title,
  description,
  services,
  price,
  action,
  icon,
  onSelect,
}: {
  selected: boolean
  title: string
  description: string
  services?: string[]
  price?: string
  action: string
  icon?: React.ReactNode
  onSelect: () => void
}) {
  return (
    <Card className={cn(selected && 'ring-2 ring-primary')}>
      <CardContent className="flex h-full flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            {icon}
            <h3 className="text-lg font-semibold">{title}</h3>
          </div>
          {description && (
            <p className="text-muted-foreground">{description}</p>
          )}
        </div>
        {services && (
          <ul className="flex list-disc flex-col gap-0.5 pl-5 text-sm">
            {services.map((name, index) => (
              <li key={index}>{name}</li>
            ))}
          </ul>
        )}
        <div className="mt-auto flex items-center justify-between gap-3 pt-2">
          {price ? (
            <div className="flex flex-col text-sm">
              <span className="text-muted-foreground">Estimated </span>
              <span className="font-semibold">{price}</span>
            </div>
          ) : (
            <span />
          )}
        </div>
      </CardContent>
      <CardFooter>
        <Button
          className="w-full"
          variant={selected ? 'default' : 'outline'}
          onClick={onSelect}
        >
          {action}
          <ArrowRightIcon data-icon="inline-end" />
        </Button>
      </CardFooter>
    </Card>
  )
}
