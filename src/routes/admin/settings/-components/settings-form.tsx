import { useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { useRouter } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import {
  MultiSelect,
  MultiSelectContent,
  MultiSelectItem,
  MultiSelectTrigger,
  MultiSelectValue,
} from '@/components/ui/multi-select'
import { SearchSelect } from '@/components/common/search-select'
import { Textarea } from '@/components/ui/textarea'
import { CURRENCY_OPTIONS } from '#/lib/currencies'
import {
  DEFAULT_CALCULATOR_DESCRIPTION,
  DEFAULT_CALCULATOR_TITLE,
  settingsSchema,
  type SettingsFormValues,
} from '#/lib/settings'
import { updateSettings } from '#/server/settings-actions'
import { toast } from 'sonner'
import { callAction, toastFormErrors } from '#/lib/action-errors'

type FieldName = Exclude<
  keyof SettingsFormValues,
  'sendReminders' | 'approvedCurrencies'
>

function RequiredMark() {
  return (
    <span aria-hidden="true" className="text-red-500">
      *
    </span>
  )
}

export function SettingsForm({ initial }: { initial: SettingsFormValues }) {
  const router = useRouter()
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({})

  const form = useForm({
    defaultValues: initial,
    validators: { onSubmit: settingsSchema },
    onSubmit: async ({ value }) => {
      setServerErrors({})
      const result = await callAction(
        () => updateSettings({ data: value }),
        'Could not save the settings. Try again.',
      )
      if (!result) return
      if (result.ok) {
        toast.success('Settings saved.')
        await router.invalidate()
        return
      }
      setServerErrors(result.errors)
      toastFormErrors(result.errors)
    },
  })

  const fieldErrors = (
    name: string,
    errors: Array<{ message?: string } | undefined>,
  ) =>
    serverErrors[name] ? [...errors, { message: serverErrors[name] }] : errors

  const currencyOptions = CURRENCY_OPTIONS.map((c) => ({
    value: c.code,
    label: `${c.code} - ${c.name}`,
  }))

  const text = (
    name: FieldName,
    label: string,
    props: React.ComponentProps<typeof Input> = {},
    description?: string,
  ) => (
    <form.Field name={name}>
      {(field) => {
        const errors = fieldErrors(field.name, field.state.meta.errors)
        const invalid = errors.length > 0
        return (
          <Field data-invalid={invalid}>
            <FieldLabel htmlFor={field.name}>
              {label}
              {props.required && <RequiredMark />}
            </FieldLabel>
            <Input
              id={field.name}
              name={field.name}
              value={field.state.value}
              aria-invalid={invalid}
              onBlur={field.handleBlur}
              onChange={(e) => field.handleChange(e.target.value)}
              {...props}
            />
            {description && <FieldDescription>{description}</FieldDescription>}
            {invalid && <FieldError errors={errors} />}
          </Field>
        )
      }}
    </form.Field>
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Business details</CardTitle>
        <CardDescription>
          Manage how your business appears on invoices, and where clients pay
          you.
        </CardDescription>
      </CardHeader>
      <form
        noValidate
        className="flex flex-col gap-(--card-spacing)"
        onSubmit={(e) => {
          e.preventDefault()
          void form.handleSubmit()
        }}
      >
        <CardContent>
          <FieldGroup>
            <FieldSet className="rounded-lg border p-4">
              <FieldLegend>Business</FieldLegend>
              <FieldDescription>
                Your name and contact details as they appear on invoices.
              </FieldDescription>
              <FieldGroup className="md:grid md:grid-cols-2">
                {text('businessName', 'Business name', {
                  required: true,
                  autoComplete: 'organization',
                  placeholder: 'Acme Studio',
                })}
                {text('email', 'Email', {
                  type: 'email',
                  autoComplete: 'email',
                  placeholder: 'hello@acme.example',
                })}
                {text(
                  'replyToEmail',
                  'Reply-to email',
                  { type: 'email', placeholder: 'billing@acme.example' },
                  'Replies to invoice emails go here.',
                )}
                <form.Field name="address">
                  {(field) => {
                    const errors = fieldErrors(
                      field.name,
                      field.state.meta.errors,
                    )
                    const invalid = errors.length > 0
                    return (
                      <Field data-invalid={invalid} className="md:col-span-2">
                        <FieldLabel htmlFor="address">Address</FieldLabel>
                        <Textarea
                          id="address"
                          name="address"
                          rows={3}
                          placeholder={'12 Example Street\nSpringfield\nUSA'}
                          value={field.state.value}
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
            </FieldSet>
            <FieldSet className="rounded-lg border p-4">
              <FieldLegend>Public calculator</FieldLegend>
              <FieldDescription>
                The heading and browser tab title on the page clients use to
                build an estimate.
              </FieldDescription>
              <FieldGroup>
                {text(
                  'calculatorTitle',
                  'Title',
                  { placeholder: DEFAULT_CALCULATOR_TITLE },
                  'Leave empty to use the default.',
                )}
                <form.Field name="calculatorDescription">
                  {(field) => {
                    const errors = fieldErrors(
                      field.name,
                      field.state.meta.errors,
                    )
                    const invalid = errors.length > 0
                    return (
                      <Field data-invalid={invalid}>
                        <FieldLabel htmlFor="calculatorDescription">
                          Description
                        </FieldLabel>
                        <Textarea
                          id="calculatorDescription"
                          name="calculatorDescription"
                          rows={2}
                          placeholder={DEFAULT_CALCULATOR_DESCRIPTION}
                          value={field.state.value}
                          aria-invalid={invalid}
                          onBlur={field.handleBlur}
                          onChange={(e) => field.handleChange(e.target.value)}
                        />
                        <FieldDescription>
                          Shown under the title and used as the search result
                          description. Leave empty to use the default.
                        </FieldDescription>
                        {invalid && <FieldError errors={errors} />}
                      </Field>
                    )
                  }}
                </form.Field>
              </FieldGroup>
            </FieldSet>
            <FieldSet className="rounded-lg border p-4">
              <FieldLegend>Invoicing</FieldLegend>
              <FieldDescription>
                Defaults applied to new invoices.
              </FieldDescription>
              <FieldGroup className="md:grid md:grid-cols-2">
                <form.Field name="currency">
                  {(field) => (
                    <Field>
                      <FieldLabel htmlFor="currency">
                        Base currency
                        <RequiredMark />
                      </FieldLabel>
                      <SearchSelect
                        id="currency"
                        value={field.state.value}
                        options={currencyOptions}
                        placeholder="Search currencies"
                        emptyText="No currency found."
                        onValueChange={field.handleChange}
                      />
                      <FieldDescription>
                        Prices, invoices and quotes are in this currency.
                      </FieldDescription>
                    </Field>
                  )}
                </form.Field>
                <form.Subscribe selector={(s) => s.values.currency}>
                  {(base) => (
                    <form.Field name="approvedCurrencies">
                      {(field) => (
                        <Field>
                          <FieldLabel htmlFor="approvedCurrencies">
                            Approved currencies
                          </FieldLabel>
                          <MultiSelect
                            values={field.state.value.filter((c) => c !== base)}
                            onValuesChange={field.handleChange}
                          >
                            <MultiSelectTrigger
                              id="approvedCurrencies"
                              className="w-full"
                            >
                              <MultiSelectValue
                                placeholder="None"
                                overflowBehavior="cutoff"
                              />
                            </MultiSelectTrigger>
                            <MultiSelectContent
                              search={{
                                placeholder: 'Search currencies',
                                emptyMessage: 'No currency found.',
                              }}
                            >
                              {CURRENCY_OPTIONS.filter(
                                (c) => c.code !== base,
                              ).map((c) => (
                                <MultiSelectItem
                                  key={c.code}
                                  value={c.code}
                                  badgeLabel={c.code}
                                  keywords={[c.name]}
                                >
                                  {c.code} - {c.name}
                                </MultiSelectItem>
                              ))}
                            </MultiSelectContent>
                          </MultiSelect>
                          <FieldDescription>
                            Clients can view the calculator estimate in these
                            currencies, converted at the daily rate from
                            Frankfurter. Quotes stay in the base currency.
                          </FieldDescription>
                        </Field>
                      )}
                    </form.Field>
                  )}
                </form.Subscribe>
                {text(
                  'taxRate',
                  'Tax rate (%)',
                  { required: true, inputMode: 'decimal', placeholder: '15' },
                  'Default for new invoices, for example 15 or 7.5.',
                )}
                {text('invoicePrefix', 'Invoice prefix', {
                  required: true,
                  placeholder: 'INV',
                })}
                {text(
                  'nextInvoiceNumber',
                  'Next invoice number',
                  { required: true, inputMode: 'numeric', placeholder: '1' },
                  'Lowering this below a number already issued will cause a duplicate.',
                )}
                {text(
                  'paymentTermDays',
                  'Payment term (days)',
                  { required: true, inputMode: 'numeric', placeholder: '14' },
                  'Days between the issue date and the due date on recurring invoices.',
                )}
                <form.Field name="sendReminders">
                  {(field) => (
                    <Field orientation="horizontal" className="md:col-span-2">
                      <Checkbox
                        id="sendReminders"
                        name="sendReminders"
                        checked={field.state.value}
                        onCheckedChange={(checked) =>
                          field.handleChange(checked === true)
                        }
                      />
                      <div className="flex flex-col gap-1">
                        <FieldLabel htmlFor="sendReminders">
                          Send automatic reminders
                        </FieldLabel>
                        <FieldDescription>
                          Emails the client 3 days before the due date and 3 and
                          10 days after it, once each.
                        </FieldDescription>
                      </div>
                    </Field>
                  )}
                </form.Field>
              </FieldGroup>
            </FieldSet>
            <FieldSet className="rounded-lg border p-4">
              <FieldLegend>Bank details</FieldLegend>
              <FieldDescription>
                Shown to clients on the invoice so they know where to pay.
              </FieldDescription>
              <FieldGroup className="md:grid md:grid-cols-2">
                {text('bankName', 'Bank name', {
                  placeholder: 'Commercial Bank',
                })}
                {text('bankBranch', 'Branch', { placeholder: 'Main Street' })}
                {text('bankAccountName', 'Account name', {
                  placeholder: 'Acme Studio (Pvt) Ltd',
                })}
                {text('bankAccountNumber', 'Account number', {
                  inputMode: 'numeric',
                  placeholder: '1234567890',
                })}
                {text(
                  'bankSwiftCode',
                  'SWIFT code',
                  { placeholder: 'CCEYLKLX' },
                  'Optional. Needed for payments from abroad.',
                )}
                <form.Field name="paymentInstructions">
                  {(field) => {
                    const errors = fieldErrors(
                      field.name,
                      field.state.meta.errors,
                    )
                    const invalid = errors.length > 0
                    return (
                      <Field data-invalid={invalid} className="md:col-span-2">
                        <FieldLabel htmlFor="paymentInstructions">
                          Payment instructions
                        </FieldLabel>
                        <Textarea
                          id="paymentInstructions"
                          name="paymentInstructions"
                          rows={4}
                          placeholder="Please use the invoice number as the payment reference."
                          value={field.state.value}
                          aria-invalid={invalid}
                          onBlur={field.handleBlur}
                          onChange={(e) => field.handleChange(e.target.value)}
                        />
                        <FieldDescription>
                          Shown on each invoice below the bank details, for
                          example a payment reference.
                        </FieldDescription>
                        {invalid && <FieldError errors={errors} />}
                      </Field>
                    )
                  }}
                </form.Field>
              </FieldGroup>
            </FieldSet>
          </FieldGroup>
        </CardContent>
        <CardFooter className="gap-3">
          <form.Subscribe selector={(s) => s.isSubmitting}>
            {(submitting) => (
              <Button type="submit" disabled={submitting}>
                {submitting ? 'Saving...' : 'Save settings'}
              </Button>
            )}
          </form.Subscribe>
        </CardFooter>
      </form>
    </Card>
  )
}
