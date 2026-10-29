import { createFileRoute } from '@tanstack/react-router'
import { getCalculatorCatalog } from '#/server/calculator-actions'
import { CalculatorLayout } from './-components/calculator-layout'

export const Route = createFileRoute('/_site/_calculator')({
  loader: () => getCalculatorCatalog(),
  head: ({ loaderData }) => ({
    meta: [
      { title: loaderData?.pageTitle },
      { name: 'description', content: loaderData?.pageDescription },
    ],
  }),
  component: CalculatorRoute,
})

function CalculatorRoute() {
  const catalog = Route.useLoaderData()
  return (
    <CalculatorLayout
      catalog={catalog}
      title={catalog.pageTitle}
      description={catalog.pageDescription}
    />
  )
}
