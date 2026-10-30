import { createFileRoute, notFound } from '@tanstack/react-router'
import { getPublicInvoiceAction } from '#/server/invoices-actions'
import { PrinterIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatDate } from '@/lib/format'
import { formatMinor } from '#/lib/decimal'
import { INVOICE_STATUS_LABELS } from '#/lib/invoices'
import { InvoiceTotalsList } from '@/components/common/invoice-totals-list'

export const Route = createFileRoute('/i/$token/')({
  loader: async ({ params }) => {
    const invoice = await getPublicInvoiceAction({ data: params.token })
    if (!invoice) throw notFound()
    return invoice
  },
  head: () => ({
    meta: [
      { title: 'Invoice' },
      { name: 'robots', content: 'noindex, nofollow' },
    ],
  }),
  notFoundComponent: () => (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-2 p-6 text-center">
      <h1 className="text-xl font-semibold">Invoice not found</h1>
      <p className="text-muted-foreground">
        This link is not valid. Check it with the sender.
      </p>
    </main>
  ),
  component: PublicInvoicePage,
})

function PublicInvoicePage() {
  const data = Route.useLoaderData()
  const { invoice, client, business, items, totals, advance } = data
  const money = (minor: number) => formatMinor(minor, invoice.currency)
  const bankRows = (
    [
      ['Bank', business.bank.name],
      ['Branch', business.bank.branch],
      ['Account name', business.bank.accountName],
      ['Account number', business.bank.accountNumber],
      ['SWIFT code', business.bank.swiftCode],
    ] as const
  ).filter(([, value]) => value)

  return (
    <main
      data-print-root
      className="mx-auto flex max-w-3xl flex-col gap-8 p-4 sm:p-8"
    >
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          {business.hasLogo && (
            <img
              src="/files/logo"
              alt={business.name}
              className="mb-2 max-h-16 w-auto self-start"
            />
          )}
          <h2 className="text-lg font-semibold">{business.name}</h2>
          <p className="text-sm whitespace-pre-line text-muted-foreground">
            {business.address}
          </p>
          <p className="text-sm text-muted-foreground">{business.email}</p>
        </div>
        <div className="flex flex-col gap-1 sm:items-end">
          <h1 className="text-2xl font-semibold">Invoice {invoice.number}</h1>
          <Button
            data-print-hide
            variant="outline"
            size="sm"
            className="mb-1 sm:self-end"
            onClick={() => window.print()}
          >
            <PrinterIcon data-icon="inline-start" />
            Download PDF
          </Button>
          <Badge variant={invoice.status === 'paid' ? 'secondary' : 'outline'}>
            {INVOICE_STATUS_LABELS[invoice.status]}
          </Badge>
        </div>
      </header>

      <section className="grid gap-6 sm:grid-cols-2">
        <div className="flex flex-col gap-1 text-sm">
          <h3 className="text-muted-foreground">Billed to</h3>
          <p className="font-medium">{client.name}</p>
          {client.company && <p>{client.company}</p>}
          {client.address && (
            <p className="whitespace-pre-line">{client.address}</p>
          )}
          {client.email && <p>{client.email}</p>}
        </div>
        <dl className="flex flex-col gap-1 text-sm sm:items-end">
          <div className="flex gap-2">
            <dt className="text-muted-foreground">Issued</dt>
            <dd>{formatDate(`${invoice.issueDate}T00:00:00`)}</dd>
          </div>
          <div className="flex gap-2">
            <dt className="text-muted-foreground">Due</dt>
            <dd>{formatDate(`${invoice.dueDate}T00:00:00`)}</dd>
          </div>
        </dl>
      </section>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Description</TableHead>
            <TableHead className="text-right">Qty</TableHead>
            <TableHead className="text-right">Unit price</TableHead>
            <TableHead className="text-right">Amount</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((item) => (
            <TableRow key={item.id}>
              <TableCell className="whitespace-normal">
                {item.description}
              </TableCell>
              <TableCell className="text-right">{item.quantity}</TableCell>
              <TableCell className="text-right tabular-nums">
                {money(item.unitPrice)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {money(item.quantity * item.unitPrice)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <div data-print-keep className="sm:ml-auto sm:w-72">
        <InvoiceTotalsList
          totals={totals}
          currency={invoice.currency}
          taxRateBps={invoice.taxRateBps}
          advance={advance}
        />
      </div>

      {invoice.paymentLink && invoice.status !== 'paid' && (
        <section data-print-keep className="flex flex-col gap-2 text-sm">
          <h3 className="font-medium">Pay online</h3>
          <Button
            className="self-start"
            render={
              <a
                href={invoice.paymentLink}
                target="_blank"
                rel="noopener noreferrer"
              />
            }
          >
            Pay now
          </Button>
        </section>
      )}

      {invoice.notes && (
        <section data-print-keep className="flex flex-col gap-1 text-sm">
          <h3 className="font-medium">Notes</h3>
          <p className="whitespace-pre-line text-muted-foreground">
            {invoice.notes}
          </p>
        </section>
      )}

      {bankRows.length > 0 && (
        <section data-print-keep className="flex flex-col gap-1 text-sm">
          <h3 className="font-medium">Bank details</h3>
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
            {bankRows.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      {business.paymentInstructions && (
        <section data-print-keep className="flex flex-col gap-1 text-sm">
          <h3 className="font-medium">Payment instructions</h3>
          <p className="whitespace-pre-line text-muted-foreground">
            {business.paymentInstructions}
          </p>
        </section>
      )}
    </main>
  )
}
