import { useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { Link, useNavigate, useRouter } from '@tanstack/react-router'
import { PlusIcon, Trash2Icon } from 'lucide-react'
import BackButton from '@/components/common/back-button'
import PageHeader from '@/components/common/page-header'
import { SearchSelect } from '@/components/common/search-select'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { bpsToPercent, formatMinor, minorToDecimal } from '#/lib/decimal'
import {
  advanceFor,
  MAX_INVOICE_ITEMS,
  addDays,
  emptyInvoiceItem,
  invoiceItemSchema,
  invoiceSchema,
  previewTotals,
  todayIso,
  type InvoiceFormValues,
} from '#/lib/invoices'
import type { InvoiceDetail } from '#/server/invoices'
import {
  getInvoiceFormContext,
  saveInvoiceAction,
} from '#/server/invoices-actions'
import { InvoiceStatusActions } from './invoice-status-actions'
import { InvoiceTotalsList } from '@/components/common/invoice-totals-list'
import { toast } from 'sonner'
import { callAction, toastFormErrors } from '#/lib/action-errors'
import { cn } from '@/lib/utils'

type Context = Awaited<ReturnType<typeof getInvoiceFormContext>>

const initialValues = (
  context: Context,
  invoice: InvoiceDetail | null,
): InvoiceFormValues => {
  if (!invoice) {
    const issueDate = todayIso()
    return {
      clientId: '',
      issueDate,
      dueDate: addDays(issueDate, context.paymentTermDays),
      taxRate: bpsToPercent(context.taxRateBps),
      discount: '0',
      advance: '',
      notes: '',
      paymentLink: '',
      items: [{ ...emptyInvoiceItem }],
    }
  }
  return {
    id: invoice.invoice.id,
    clientId: invoice.invoice.clientId,
    issueDate: invoice.invoice.issueDate,
    dueDate: invoice.invoice.dueDate,
    taxRate: bpsToPercent(invoice.invoice.taxRateBps),
    discount: minorToDecimal(invoice.invoice.discount),
    advance: invoice.invoice.advanceBps
      ? bpsToPercent(invoice.invoice.advanceBps)
      : '',
    notes: invoice.invoice.notes,
    paymentLink: invoice.invoice.paymentLink,
    items: invoice.items.map((item) => ({
      description: item.description,
      quantity: String(item.quantity),
      unitPrice: minorToDecimal(item.unitPrice),
      taxable: item.taxable,
    })),
  }
}

export function InvoiceEditor({
  context,
  invoice,
}: {
  context: Context
  invoice: InvoiceDetail | null
}) {
  const router = useRouter()
  const navigate = useNavigate()
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({})
  const currency = invoice?.invoice.currency ?? context.currency
  const money = (minor: number) => formatMinor(minor, currency)

  const clients = context.clients.some((c) => c.id === invoice?.client.id)
    ? context.clients
    : invoice
      ? [...context.clients, invoice.client]
      : context.clients

  const form = useForm({
    defaultValues: initialValues(context, invoice),
    validators: { onSubmit: invoiceSchema },
    onSubmit: async ({ value, formApi }) => {
      setServerErrors({})
      const result = await callAction(
        () => saveInvoiceAction({ data: value }),
        'Could not save the invoice. Try again.',
      )
      if (!result) return
      if (!result.ok) {
        setServerErrors(result.errors)
        toastFormErrors(result.errors)
        return
      }
      if (invoice) {
        formApi.reset(value)
        toast.success('Invoice saved.')
        await router.invalidate()
        return
      }
      await navigate({
        to: '/admin/invoices/$invoiceId',
        params: { invoiceId: result.id },
      })
    },
  })

  const withServerError = (
    key: string,
    errors: Array<{ message?: string } | undefined>,
  ) =>
    serverErrors[key] ? [...errors, { message: serverErrors[key] }] : errors

  const textField = (
    name: 'issueDate' | 'dueDate' | 'taxRate' | 'discount' | 'advance',
    label: string,
    props: React.ComponentProps<typeof Input> = {},
  ) => (
    <form.Field name={name}>
      {(field) => {
        const errors = withServerError(name, field.state.meta.errors)
        const invalid = errors.length > 0
        return (
          <Field data-invalid={invalid}>
            <FieldLabel htmlFor={`invoice-${name}`}>{label}</FieldLabel>
            <Input
              id={`invoice-${name}`}
              name={name}
              value={field.state.value}
              aria-invalid={invalid}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
              {...props}
            />
            {invalid && <FieldError errors={errors} />}
          </Field>
        )
      }}
    </form.Field>
  )

  return (
    <form
      noValidate
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault()
        void form.handleSubmit()
      }}
    >
      <PageHeader
        back={
          <BackButton link={<Link to="/admin/invoices" />}>
            Back to invoices
          </BackButton>
        }
        title={invoice ? invoice.invoice.number : 'New invoice'}
        description={
          invoice
            ? 'Draft invoice. Changes apply when you save.'
            : 'The invoice number is assigned when you first save.'
        }
      >
        {invoice && (
          <form.Subscribe selector={(s) => s.isDirty}>
            {(dirty) => (
              <InvoiceStatusActions
                invoiceId={invoice.invoice.id}
                status={invoice.invoice.status}
                disabled={dirty}
              />
            )}
          </form.Subscribe>
        )}
        <form.Subscribe selector={(s) => s.isSubmitting}>
          {(submitting) => (
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Saving...' : 'Save invoice'}
            </Button>
          )}
        </form.Subscribe>
      </PageHeader>

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Details</CardTitle>
            </CardHeader>
            <CardContent>
              <FieldGroup className="md:grid md:grid-cols-2">
                <form.Field name="clientId">
                  {(field) => {
                    const errors = withServerError(
                      'clientId',
                      field.state.meta.errors,
                    )
                    const invalid = errors.length > 0
                    return (
                      <Field data-invalid={invalid} className="md:col-span-2">
                        <FieldLabel htmlFor="invoice-clientId">
                          Client
                        </FieldLabel>
                        <SearchSelect
                          id="invoice-clientId"
                          value={field.state.value}
                          invalid={invalid}
                          placeholder="Choose a client"
                          emptyText="No clients found."
                          options={clients.map((c) => ({
                            value: c.id,
                            label: c.company
                              ? `${c.name} (${c.company})`
                              : c.name,
                          }))}
                          onValueChange={field.handleChange}
                        />
                        {invalid && <FieldError errors={errors} />}
                      </Field>
                    )
                  }}
                </form.Field>
                {textField('issueDate', 'Issue date', { type: 'date' })}
                {textField('dueDate', 'Due date', { type: 'date' })}
                {textField('taxRate', 'Tax rate (%)', { inputMode: 'decimal' })}
                {textField('discount', `Discount (${currency})`, {
                  inputMode: 'decimal',
                })}
                {textField('advance', 'Advance (%), optional', {
                  inputMode: 'decimal',
                  placeholder: 'No advance',
                })}
                <form.Field name="paymentLink">
                  {(field) => {
                    const errors = withServerError(
                      'paymentLink',
                      field.state.meta.errors,
                    )
                    const invalid = errors.length > 0
                    return (
                      <Field data-invalid={invalid} className="md:col-span-2">
                        <FieldLabel htmlFor="invoice-payment-link">
                          Payment link, optional
                        </FieldLabel>
                        <Input
                          id="invoice-payment-link"
                          name="paymentLink"
                          type="url"
                          inputMode="url"
                          maxLength={2000}
                          placeholder="https:// PayHere, Stripe or Payoneer link"
                          value={field.state.value ?? ''}
                          aria-invalid={invalid}
                          onBlur={field.handleBlur}
                          onChange={(e) => field.handleChange(e.target.value)}
                        />
                        {invalid && <FieldError errors={errors} />}
                      </Field>
                    )
                  }}
                </form.Field>
                <form.Field name="notes">
                  {(field) => {
                    const errors = withServerError(
                      'notes',
                      field.state.meta.errors,
                    )
                    const invalid = errors.length > 0
                    return (
                      <Field data-invalid={invalid} className="md:col-span-2">
                        <FieldLabel htmlFor="invoice-notes">
                          Notes, optional
                        </FieldLabel>
                        <Textarea
                          id="invoice-notes"
                          name="notes"
                          rows={3}
                          maxLength={2000}
                          placeholder="Shown on the invoice below the totals"
                          value={field.state.value ?? ''}
                          aria-invalid={invalid}
                          onBlur={field.handleBlur}
                          onChange={(e) => field.handleChange(e.target.value)}
                        />
                        {invalid && <FieldError errors={errors} />}
                      </Field>
                    )
                  }}
                </form.Field>
              </FieldGroup>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Line items</CardTitle>
              <CardDescription>
                Add lines by hand or start from one of your services.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form.Field name="items" mode="array">
                {(itemsField) => {
                  const listErrors = withServerError(
                    'items',
                    itemsField.state.meta.errors,
                  )
                  const atLimit =
                    itemsField.state.value.length >= MAX_INVOICE_ITEMS
                  return (
                    <div className="flex flex-col gap-4">
                      {itemsField.state.value.map((_, index) => (
                        <div
                          key={index}
                          className="grid grid-cols-[5rem_minmax(0,1fr)_auto_auto] items-start gap-3 rounded-lg border p-3"
                          data-testid="invoice-line"
                        >
                          {(
                            [
                              ['description', 'Description', {}],
                              [
                                'quantity',
                                'Qty',
                                { inputMode: 'numeric' as const },
                              ],
                              [
                                'unitPrice',
                                'Unit price',
                                { inputMode: 'decimal' as const },
                              ],
                            ] as const
                          ).map(([key, label, props]) => (
                            <form.Field
                              key={key}
                              name={`items[${index}].${key}`}
                            >
                              {(field) => {
                                const errors = withServerError(
                                  `items.${index}.${key}`,
                                  field.state.meta.errors,
                                )
                                const invalid = errors.length > 0
                                return (
                                  <Field
                                    data-invalid={invalid}
                                    className={cn(
                                      key === 'description' && 'col-span-full',
                                    )}
                                  >
                                    <FieldLabel
                                      htmlFor={`invoice-item-${index}-${key}`}
                                    >
                                      {label}
                                    </FieldLabel>
                                    <Input
                                      id={`invoice-item-${index}-${key}`}
                                      placeholder={label}
                                      value={field.state.value}
                                      aria-invalid={invalid}
                                      onBlur={field.handleBlur}
                                      onChange={(e) =>
                                        field.handleChange(e.target.value)
                                      }
                                      {...props}
                                    />
                                    {invalid && <FieldError errors={errors} />}
                                  </Field>
                                )
                              }}
                            </form.Field>
                          ))}
                          <form.Subscribe
                            selector={(s) => s.values.items[index]}
                          >
                            {(item) => {
                              const quantity =
                                invoiceItemSchema.shape.quantity.safeParse(
                                  item?.quantity,
                                )
                              const price =
                                invoiceItemSchema.shape.unitPrice.safeParse(
                                  item?.unitPrice,
                                )
                              return (
                                <Field>
                                  <FieldLabel>Amount</FieldLabel>
                                  <p className="flex h-8 items-center justify-end text-sm tabular-nums">
                                    {quantity.success && price.success
                                      ? money(quantity.data * price.data)
                                      : '-'}
                                  </p>
                                </Field>
                              )
                            }}
                          </form.Subscribe>
                          <Field>
                            <FieldLabel aria-hidden className="invisible">
                              Remove
                            </FieldLabel>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              aria-label={`Remove line ${index + 1}`}
                              onClick={() => itemsField.removeValue(index)}
                            >
                              <Trash2Icon />
                            </Button>
                          </Field>
                          <form.Field name={`items[${index}].taxable`}>
                            {(field) => (
                              <Field
                                orientation="horizontal"
                                className="col-span-full"
                              >
                                <Checkbox
                                  id={`invoice-item-${index}-taxable`}
                                  checked={field.state.value ?? true}
                                  onCheckedChange={(checked) =>
                                    field.handleChange(checked)
                                  }
                                />
                                <FieldLabel
                                  htmlFor={`invoice-item-${index}-taxable`}
                                >
                                  Taxable
                                </FieldLabel>
                              </Field>
                            )}
                          </form.Field>
                        </div>
                      ))}
                      {listErrors.length > 0 && (
                        <FieldError errors={listErrors} />
                      )}
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          disabled={atLimit}
                          onClick={() =>
                            itemsField.pushValue({ ...emptyInvoiceItem })
                          }
                        >
                          <PlusIcon />
                          Add line
                        </Button>
                        <SearchSelect
                          aria-label="Add from a service"
                          value={null}
                          disabled={atLimit || context.services.length === 0}
                          placeholder="Add from a service"
                          emptyText="No services found."
                          contentClassName="min-w-72"
                          options={context.services.map((s) => ({
                            value: s.id,
                            label: `${s.name} (${money(s.unitPrice)})`,
                          }))}
                          onValueChange={(serviceId) => {
                            const service = context.services.find(
                              (s) => s.id === serviceId,
                            )
                            if (!service || atLimit) return
                            itemsField.pushValue({
                              description: service.name,
                              quantity: String(service.minQuantity),
                              unitPrice: minorToDecimal(service.unitPrice),
                              taxable: service.taxable,
                            })
                          }}
                        />
                      </div>
                    </div>
                  )
                }}
              </form.Field>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Totals</CardTitle>
          </CardHeader>
          <CardContent>
            <form.Subscribe selector={(s) => s.values}>
              {(values) => {
                const bps = Number(values.taxRate) * 100
                const totals = previewTotals(values)
                const advance = invoiceSchema.shape.advance.safeParse(
                  values.advance,
                )
                return (
                  <InvoiceTotalsList
                    totals={totals}
                    currency={currency}
                    taxRateBps={Number.isFinite(bps) ? Math.round(bps) : 0}
                    advance={advanceFor(
                      totals.total,
                      advance.success ? advance.data : null,
                      invoice?.invoice.advancePaidAt ?? null,
                    )}
                  />
                )
              }}
            </form.Subscribe>
          </CardContent>
        </Card>
      </div>
    </form>
  )
}
