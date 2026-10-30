import { Link, useLocation } from '@tanstack/react-router'
import { ArrowRightIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import { bpsToPercent } from '#/lib/decimal'
import type { PricingBreakdown } from '#/lib/pricing'
import { BILLING_LABELS } from '#/lib/services'
import { useCalculator } from './calculator-context'
import { CurrencyPicker } from './currency-picker'

function Row({
  label,
  value,
  strong,
}: {
  label: string
  value: string
  strong?: boolean
}) {
  return (
    <div
      className={cn(
        'flex justify-between gap-4',
        strong ? 'text-lg font-semibold' : 'text-sm',
      )}
    >
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

export function Summary({
  breakdown,
  taxRateBps,
}: {
  breakdown: PricingBreakdown
  taxRateBps: number
}) {
  const { money, catalog, displayCurrency } = useCalculator()
  const { recurring } = breakdown
  const hasRecurring = recurring.lines.length > 0
  const { pathname } = useLocation()
  const onScope = pathname.replace(/(.)\/$/, '$1') === '/scope'

  return (
    <>
      <aside id="summary" className="lg:sticky lg:top-30 lg:self-start">
        <Card className="[--card-spacing:--spacing(5)]">
          <CardHeader>
            <CardTitle>Your estimate</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <CurrencyPicker />
            <dl className="flex flex-col gap-2">
              {breakdown.lines.map((line) => (
                <div
                  key={line.serviceId}
                  className="flex justify-between gap-4 text-sm text-muted-foreground"
                >
                  <dt>
                    {line.name}
                    {line.quantity > 1 && ` x ${line.quantity}`}
                  </dt>
                  <dd>{money(line.amount)}</dd>
                </div>
              ))}
              {breakdown.lines.length === 0 && !hasRecurring && (
                <p className="text-sm text-muted-foreground">
                  Nothing selected yet.
                </p>
              )}
            </dl>
            <Separator />
            <dl className="flex flex-col gap-2">
              <Row label="Subtotal" value={money(breakdown.subtotal)} />
              <Row
                label={`Tax (${bpsToPercent(taxRateBps)}%)`}
                value={money(breakdown.taxAmount)}
              />
              <Row label="Total" value={money(breakdown.total)} strong />
            </dl>
            {hasRecurring && (
              <>
                <Separator />
                <dl className="flex flex-col gap-2">
                  <p className="text-sm font-medium">Recurring charges</p>
                  {recurring.lines.map((line) => (
                    <div
                      key={line.serviceId}
                      className="flex justify-between gap-4 text-sm text-muted-foreground"
                    >
                      <dt>
                        {line.name} (
                        {BILLING_LABELS[line.billing].toLowerCase()})
                        {line.quantity > 1 && ` x ${line.quantity}`}
                      </dt>
                      <dd>{money(line.amount)}</dd>
                    </div>
                  ))}
                  <Row
                    label="Recurring tax"
                    value={money(recurring.taxAmount)}
                  />
                  <Row label="Recurring total" value={money(recurring.total)} />
                </dl>
              </>
            )}
            {displayCurrency !== catalog.currency && (
              <p className="text-xs text-muted-foreground">
                Converted from {catalog.currency} at today&apos;s rate. Your
                quote is issued in {catalog.currency}.
              </p>
            )}
            {onScope && (
              <Button nativeButton={false} render={<Link to="/review" />}>
                Review quote
                <ArrowRightIcon />
              </Button>
            )}
          </CardContent>
        </Card>
      </aside>
      <a
        href="#summary"
        className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-between border-t bg-background px-4 py-3 lg:hidden"
      >
        <span className="text-sm text-muted-foreground">Total</span>
        <span className="text-lg font-semibold">{money(breakdown.total)}</span>
      </a>
    </>
  )
}
