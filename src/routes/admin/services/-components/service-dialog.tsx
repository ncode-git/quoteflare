import { useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { useRouter } from '@tanstack/react-router'
import { PlusIcon, Trash2Icon } from 'lucide-react'
import { SearchSelect } from '@/components/common/search-select'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { bpsToPercent, minorToDecimal } from '#/lib/decimal'
import {
  BILLING_LABELS,
  MAX_GROUPS_PER_SERVICE,
  MAX_OPTIONS_PER_SERVICE,
  PRICING_MODE_LABELS,
  SELECTION_LABELS,
  serviceSchema,
  type ServiceFormValues,
} from '#/lib/services'
import type { CategoryRow, ServiceRow } from '#/server/services'
import { saveServiceAction } from '#/server/services-actions'
import { toast } from 'sonner'
import { callAction, toastFormErrors } from '#/lib/action-errors'

export type ServiceChoice = { id: string; name: string; active: boolean }

const NONE = 'none'

const emptyValues: ServiceFormValues = {
  name: '',
  description: '',
  note: '',
  unitLabel: 'unit',
  unitPrice: '',
  pricingMode: 'fixed',
  billing: 'one_time',
  categoryId: '',
  minQuantity: '1',
  maxQuantity: '',
  quantityStep: '1',
  taxable: true,
  isPrivate: false,
  estimatedDaysMin: '',
  estimatedDaysMax: '',
  requires: [],
  groups: [],
  options: [],
}

const optionalNumber = (value: number | null) =>
  value === null ? '' : String(value)

const toFormValues = (service: ServiceRow): ServiceFormValues => ({
  id: service.id,
  name: service.name,
  description: service.description,
  note: service.note,
  unitLabel: service.unitLabel,
  unitPrice: minorToDecimal(service.unitPrice),
  pricingMode: service.pricingMode,
  billing: service.billing,
  categoryId: service.categoryId ?? '',
  minQuantity: String(service.minQuantity),
  maxQuantity: optionalNumber(service.maxQuantity),
  quantityStep: String(service.quantityStep),
  taxable: service.taxable,
  isPrivate: service.isPrivate,
  estimatedDaysMin: optionalNumber(service.estimatedDaysMin),
  estimatedDaysMax: optionalNumber(service.estimatedDaysMax),
  requires: service.requires.map((r) => r.id),
  groups: service.groups.map((g) => ({
    id: g.id,
    name: g.name,
    selection: g.selection,
    required: g.required,
  })),
  options: service.options.map((o) => ({
    id: o.id,
    name: o.name,
    modifierType: o.modifierType,
    modifierValue:
      o.modifierType === 'flat'
        ? minorToDecimal(o.modifierValue)
        : bpsToPercent(o.modifierValue),
    group: service.groups.find((g) => g.id === o.groupId)?.name ?? '',
  })),
})

const TYPE_LABELS = { flat: 'Flat amount', percent: 'Percentage' } as const

type TextField =
  | 'name'
  | 'description'
  | 'note'
  | 'unitLabel'
  | 'unitPrice'
  | 'minQuantity'
  | 'maxQuantity'
  | 'quantityStep'
  | 'estimatedDaysMin'
  | 'estimatedDaysMax'

type ChoiceField = 'pricingMode' | 'billing' | 'categoryId'

export function ServiceDialog({
  editing,
  currency,
  categories,
  choices,
  onClose,
}: {
  editing: ServiceRow | 'new' | null
  currency: string
  categories: CategoryRow[]
  choices: ServiceChoice[]
  onClose: () => void
}) {
  return (
    <Dialog open={editing !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        {editing !== null && (
          <ServiceForm
            key={editing === 'new' ? 'new' : editing.id}
            initial={editing === 'new' ? emptyValues : toFormValues(editing)}
            currency={currency}
            categories={categories}
            choices={choices}
            onDone={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function ServiceForm({
  initial,
  currency,
  categories,
  choices,
  onDone,
}: {
  initial: ServiceFormValues
  currency: string
  categories: CategoryRow[]
  choices: ServiceChoice[]
  onDone: () => void
}) {
  const router = useRouter()
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({})

  const form = useForm({
    defaultValues: initial,
    validators: { onSubmit: serviceSchema },
    onSubmit: async ({ value }) => {
      setServerErrors({})
      const result = await callAction(
        () => saveServiceAction({ data: value }),
        'Could not save the service. Try again.',
      )
      if (!result) return
      if (result.ok) {
        toast.success('Service saved.')
        await router.invalidate()
        onDone()
        return
      }
      setServerErrors(result.errors)
      toastFormErrors(result.errors)
    },
  })

  const withServerErrors = (
    name: string,
    errors: Array<{ message?: string } | undefined>,
  ) =>
    serverErrors[name] ? [...errors, { message: serverErrors[name] }] : errors

  const text = (
    name: TextField,
    label: string,
    props: React.ComponentProps<typeof Input> = {},
    description?: string,
  ) => (
    <form.Field name={name}>
      {(field) => {
        const errors = withServerErrors(field.name, field.state.meta.errors)
        const invalid = errors.length > 0
        return (
          <Field data-invalid={invalid}>
            <FieldLabel htmlFor={`service-${name}`}>{label}</FieldLabel>
            <Input
              id={`service-${name}`}
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

  const choice = (
    name: ChoiceField,
    label: string,
    items: Record<string, string>,
  ) => (
    <form.Field name={name}>
      {(field) => {
        const errors = withServerErrors(field.name, field.state.meta.errors)
        const value = field.state.value || NONE
        return (
          <Field data-invalid={errors.length > 0}>
            <FieldLabel htmlFor={`service-${name}`}>{label}</FieldLabel>
            <Select
              value={value}
              onValueChange={(v) =>
                v && field.handleChange((v === NONE ? '' : v) as never)
              }
            >
              <SelectTrigger id={`service-${name}`} className="w-full">
                <SelectValue>{items[value]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {Object.entries(items).map(([key, itemLabel]) => (
                  <SelectItem key={key} value={key}>
                    {itemLabel}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.length > 0 && <FieldError errors={errors} />}
          </Field>
        )
      }}
    </form.Field>
  )

  const categoryItems: Record<string, string> = {
    [NONE]: 'No category',
    ...Object.fromEntries(categories.map((c) => [c.id, c.name])),
  }
  const otherServices = choices.filter((c) => c.id !== initial.id)

  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        void form.handleSubmit()
      }}
    >
      <DialogHeader>
        <DialogTitle>{initial.id ? 'Edit service' : 'New service'}</DialogTitle>
        <DialogDescription>
          Prices are in {currency}. Removed options are archived, so existing
          quotes keep them.
        </DialogDescription>
      </DialogHeader>

      <FieldGroup>
        <div className="grid gap-4 sm:grid-cols-2">
          {text('name', 'Name')}
          <form.Field name="categoryId">
            {(field) => (
              <Field>
                <FieldLabel htmlFor="service-categoryId">Category</FieldLabel>
                <SearchSelect
                  id="service-categoryId"
                  value={field.state.value || NONE}
                  placeholder="Choose a category"
                  emptyText="No categories found."
                  options={Object.entries(categoryItems).map(
                    ([value, label]) => ({ value, label }),
                  )}
                  onValueChange={(v) => field.handleChange(v === NONE ? '' : v)}
                />
              </Field>
            )}
          </form.Field>
        </div>
        {text('description', 'Description')}
        {text(
          'note',
          'Note',
          { placeholder: 'Requires a Resend account' },
          'A short caveat shown next to the service.',
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          {choice('pricingMode', 'Pricing', PRICING_MODE_LABELS)}
          {choice('billing', 'Billing', BILLING_LABELS)}
          {text(
            'unitPrice',
            'Unit price',
            { inputMode: 'decimal', placeholder: '49.99' },
            'For services priced per quote, this is only the default.',
          )}
          {text('unitLabel', 'Unit label')}
        </div>

        <form.Field name="taxable">
          {(field) => (
            <Field orientation="horizontal">
              <Checkbox
                id="service-taxable"
                checked={field.state.value}
                onCheckedChange={(checked) => field.handleChange(checked)}
              />
              <FieldLabel htmlFor="service-taxable">Taxable</FieldLabel>
            </Field>
          )}
        </form.Field>

        <form.Field name="isPrivate">
          {(field) => (
            <Field orientation="horizontal">
              <Checkbox
                id="service-private"
                checked={field.state.value}
                onCheckedChange={(checked) => field.handleChange(checked)}
              />
              <FieldLabel htmlFor="service-private">
                Private (hide from the public calculator)
              </FieldLabel>
            </Field>
          )}
        </form.Field>

        <FieldSet>
          <FieldLegend variant="label">Quantity</FieldLegend>
          <form.Subscribe
            selector={(s) =>
              s.values.minQuantity === '1' && s.values.maxQuantity === '1'
            }
          >
            {(single) => (
              <>
                <Field orientation="horizontal">
                  <Checkbox
                    id="service-single"
                    checked={single}
                    onCheckedChange={(checked) => {
                      form.setFieldValue('minQuantity', '1')
                      form.setFieldValue('maxQuantity', checked ? '1' : '')
                      form.setFieldValue('quantityStep', '1')
                    }}
                  />
                  <FieldLabel htmlFor="service-single">
                    No quantity, sold once per quote
                  </FieldLabel>
                </Field>
                {!single && (
                  <div className="grid gap-4 sm:grid-cols-3">
                    {text('minQuantity', 'Minimum', { inputMode: 'numeric' })}
                    {text('maxQuantity', 'Maximum', {
                      inputMode: 'numeric',
                      placeholder: 'No limit',
                    })}
                    {text('quantityStep', 'Step', { inputMode: 'numeric' })}
                  </div>
                )}
              </>
            )}
          </form.Subscribe>
        </FieldSet>

        <FieldSet>
          <FieldLegend variant="label">Estimated days</FieldLegend>
          <div className="grid gap-4 sm:grid-cols-2">
            {text('estimatedDaysMin', 'From', {
              inputMode: 'decimal',
              placeholder: '0.5',
            })}
            {text('estimatedDaysMax', 'To', {
              inputMode: 'decimal',
              placeholder: '2',
            })}
          </div>
        </FieldSet>

        <form.Field name="groups" mode="array">
          {(groupsField) => (
            <FieldSet>
              <FieldLegend variant="label">Option groups</FieldLegend>
              <FieldDescription>
                Group options when the client should choose one of them, or must
                choose at least one.
              </FieldDescription>
              {groupsField.state.value.map((group, index) => (
                <div
                  key={group.id ?? `new-group-${index}`}
                  className="grid grid-cols-[1fr_9rem_auto_auto] items-start gap-2 max-sm:grid-cols-2"
                >
                  <form.Field name={`groups[${index}].name`}>
                    {(field) => {
                      const errors = withServerErrors(
                        field.name,
                        field.state.meta.errors,
                      )
                      return (
                        <Field data-invalid={errors.length > 0}>
                          <Input
                            aria-label={`Group ${index + 1} name`}
                            placeholder="Group name"
                            value={field.state.value}
                            aria-invalid={errors.length > 0}
                            onBlur={field.handleBlur}
                            onChange={(e) => {
                              const previous = field.state.value
                              field.handleChange(e.target.value)
                              form.state.values.options.forEach((o, i) => {
                                if (o.group === previous) {
                                  form.setFieldValue(
                                    `options[${i}].group`,
                                    e.target.value,
                                  )
                                }
                              })
                            }}
                          />
                          {errors.length > 0 && <FieldError errors={errors} />}
                        </Field>
                      )
                    }}
                  </form.Field>
                  <form.Field name={`groups[${index}].selection`}>
                    {(field) => (
                      <Select
                        value={field.state.value}
                        onValueChange={(v) =>
                          v && field.handleChange(v as 'single' | 'multiple')
                        }
                      >
                        <SelectTrigger
                          aria-label={`Group ${index + 1} selection`}
                          className="w-full"
                        >
                          <SelectValue>
                            {SELECTION_LABELS[field.state.value]}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(SELECTION_LABELS).map(
                            ([value, label]) => (
                              <SelectItem key={value} value={value}>
                                {label}
                              </SelectItem>
                            ),
                          )}
                        </SelectContent>
                      </Select>
                    )}
                  </form.Field>
                  <form.Field name={`groups[${index}].required`}>
                    {(field) => (
                      <Field orientation="horizontal" className="h-8 w-auto">
                        <Checkbox
                          id={`group-required-${index}`}
                          checked={field.state.value}
                          onCheckedChange={(checked) =>
                            field.handleChange(checked)
                          }
                        />
                        <FieldLabel htmlFor={`group-required-${index}`}>
                          Required
                        </FieldLabel>
                      </Field>
                    )}
                  </form.Field>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove group ${index + 1}`}
                    onClick={() => {
                      form.state.values.options.forEach((o, i) => {
                        if (o.group === group.name) {
                          form.setFieldValue(`options[${i}].group`, '')
                        }
                      })
                      groupsField.removeValue(index)
                    }}
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-fit"
                disabled={
                  groupsField.state.value.length >= MAX_GROUPS_PER_SERVICE
                }
                onClick={() =>
                  groupsField.pushValue({
                    name: '',
                    selection: 'single',
                    required: false,
                  })
                }
              >
                <PlusIcon data-icon="inline-start" />
                Add group
              </Button>
            </FieldSet>
          )}
        </form.Field>

        <form.Field name="options" mode="array">
          {(optionsField) => (
            <FieldSet>
              <FieldLegend variant="label">Options</FieldLegend>
              <FieldDescription>
                A flat amount is added to the unit price. A percentage adds that
                share of the line amount.
              </FieldDescription>
              {withServerErrors('options', optionsField.state.meta.errors)
                .length > 0 && (
                <FieldError
                  errors={withServerErrors(
                    'options',
                    optionsField.state.meta.errors,
                  )}
                />
              )}
              {optionsField.state.value.map((option, index) => (
                <div
                  key={option.id ?? `new-${index}`}
                  className="grid grid-cols-[1fr_8rem_6rem_8rem_auto] items-start gap-2 max-sm:grid-cols-2"
                >
                  <form.Field name={`options[${index}].name`}>
                    {(field) => {
                      const errors = withServerErrors(
                        field.name,
                        field.state.meta.errors,
                      )
                      const invalid = errors.length > 0
                      return (
                        <Field data-invalid={invalid}>
                          <Input
                            aria-label={`Option ${index + 1} name`}
                            placeholder="Option name"
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
                  <form.Field name={`options[${index}].modifierType`}>
                    {(field) => (
                      <Select
                        value={field.state.value}
                        onValueChange={(v) =>
                          v && field.handleChange(v as 'flat' | 'percent')
                        }
                      >
                        <SelectTrigger
                          aria-label={`Option ${index + 1} type`}
                          className="w-full"
                        >
                          <SelectValue>
                            {TYPE_LABELS[field.state.value]}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(TYPE_LABELS).map(([value, label]) => (
                            <SelectItem key={value} value={value}>
                              {label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </form.Field>
                  <form.Field name={`options[${index}].modifierValue`}>
                    {(field) => {
                      const errors = withServerErrors(
                        field.name,
                        field.state.meta.errors,
                      )
                      const invalid = errors.length > 0
                      return (
                        <Field data-invalid={invalid}>
                          <Input
                            aria-label={`Option ${index + 1} value`}
                            inputMode="decimal"
                            placeholder={
                              option.modifierType === 'flat' ? '5.00' : '25'
                            }
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
                  <form.Field name={`options[${index}].group`}>
                    {(field) => {
                      const errors = withServerErrors(
                        field.name,
                        field.state.meta.errors,
                      )
                      const names = form.state.values.groups
                        .map((g) => g.name)
                        .filter(Boolean)
                      return (
                        <Field data-invalid={errors.length > 0}>
                          <Select
                            value={field.state.value || NONE}
                            onValueChange={(v) =>
                              v && field.handleChange(v === NONE ? '' : v)
                            }
                          >
                            <SelectTrigger
                              aria-label={`Option ${index + 1} group`}
                              className="w-full"
                            >
                              <SelectValue>
                                {field.state.value || 'No group'}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NONE}>No group</SelectItem>
                              {names.map((name) => (
                                <SelectItem key={name} value={name}>
                                  {name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {errors.length > 0 && <FieldError errors={errors} />}
                        </Field>
                      )
                    }}
                  </form.Field>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove option ${index + 1}`}
                    onClick={() => optionsField.removeValue(index)}
                  >
                    <Trash2Icon />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-fit"
                disabled={
                  optionsField.state.value.length >= MAX_OPTIONS_PER_SERVICE
                }
                onClick={() =>
                  optionsField.pushValue({
                    name: '',
                    modifierType: 'flat',
                    modifierValue: '',
                    group: '',
                  })
                }
              >
                <PlusIcon data-icon="inline-start" />
                Add option
              </Button>
            </FieldSet>
          )}
        </form.Field>

        {otherServices.length > 0 && (
          <form.Field name="requires">
            {(field) => {
              const errors = withServerErrors(
                field.name,
                field.state.meta.errors,
              )
              return (
                <FieldSet>
                  <FieldLegend variant="label">Requires</FieldLegend>
                  <FieldDescription>
                    Services the client must also choose with this one.
                  </FieldDescription>
                  <div className="grid max-h-40 gap-2 overflow-y-auto">
                    {otherServices.map((other) => (
                      <Field key={other.id} orientation="horizontal">
                        <Checkbox
                          id={`requires-${other.id}`}
                          checked={field.state.value.includes(other.id)}
                          onCheckedChange={(checked) =>
                            field.handleChange(
                              checked
                                ? [...field.state.value, other.id]
                                : field.state.value.filter(
                                    (id) => id !== other.id,
                                  ),
                            )
                          }
                        />
                        <FieldLabel htmlFor={`requires-${other.id}`}>
                          {other.name}
                          {!other.active && ' (archived)'}
                        </FieldLabel>
                      </Field>
                    ))}
                  </div>
                  {errors.length > 0 && <FieldError errors={errors} />}
                </FieldSet>
              )
            }}
          </form.Field>
        )}
      </FieldGroup>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <form.Subscribe selector={(s) => s.isSubmitting}>
          {(submitting) => (
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Saving...' : 'Save service'}
            </Button>
          )}
        </form.Subscribe>
      </DialogFooter>
    </form>
  )
}
