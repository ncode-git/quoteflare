import { Outlet } from '@tanstack/react-router'
import PageHeader from '@/components/common/page-header'
import type { CalculatorCatalog } from '#/lib/calculator'
import { CalculatorProvider, useCalculator } from './calculator-context'
import { StepFooter } from './step-footer'
import { StepNav } from './step-nav'
import { Summary } from './summary'

function Shell({ title, description }: PageText) {
  const { catalog, evaluation } = useCalculator()
  return (
    <div className="flex flex-col gap-8">
      <div className="container">
        <PageHeader title={title} description={description} />
      </div>
      <StepNav />
      <div className="container pb-20 lg:pb-0">
        <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-10">
          <div className="flex min-w-0 flex-col gap-8 empty:hidden">
            <Outlet />
            <StepFooter />
          </div>
          <Summary
            breakdown={evaluation.breakdown}
            taxRateBps={catalog.taxRateBps}
          />
        </div>
      </div>
    </div>
  )
}

type PageText = { title: string; description: string }

export function CalculatorLayout({
  catalog,
  title,
  description,
}: PageText & { catalog: CalculatorCatalog }) {
  return (
    <CalculatorProvider catalog={catalog}>
      <Shell title={title} description={description} />
    </CalculatorProvider>
  )
}
