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
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldSet,
  FieldLegend,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  MAX_ITEMS_PER_PACKAGE,
  packageSchema,
  type PackageFormValues,
} from '#/lib/packages'
import type { PackageCategoryRow, PackageRow } from '#/server/packages'
import { savePackageAction } from '#/server/packages-actions'
import { toast } from 'sonner'
import { callAction, toastFormErrors } from '#/lib/action-errors'

export type ServiceChoice = {
  id: string
  name: string
  minQuantity: number
  maxQuantity: number | null
  options: { id: string; name: string }[]
}

const NONE = 'none'

const emptyValues: PackageFormValues = {
  name: '',
  description: '',
  categoryId: '',
  isPrivate: false,
  items: [],
}

const toFormValues = (pkg: PackageRow): PackageFormValues => ({
  id: pkg.id,
  name: pkg.name,
  description: pkg.description,
  categoryId: pkg.categoryId ?? '',
  isPrivate: pkg.isPrivate,
  items: pkg.items.map((i) => ({
    serviceId: i.serviceId,
    quantity: String(i.quantity),
    optionIds: i.optionIds,
  })),
})

export function PackageDialog({
  editing,
  categories,
  services,
  onClose,
}: {
  editing: PackageRow | 'new' | null
  categories: PackageCategoryRow[]
  services: ServiceChoice[]
  onClose: () => void
}) {
  return (
    <Dialog open={editing !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        {editing !== null && (
          <PackageForm
            key={editing === 'new' ? 'new' : editing.id}
            initial={editing === 'new' ? emptyValues : toFormValues(editing)}
            categories={categories}
            services={services}
            onDone={onClose}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

function PackageForm({
  initial,
  categories,
  services,
  onDone,
}: {
  initial: PackageFormValues
  categories: PackageCategoryRow[]
  services: ServiceChoice[]
  onDone: () => void
}) {
  const router = useRouter()
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({})
  const byId = new Map(services.map((s) => [s.id, s]))

  const form = useForm({
    defaultValues: initial,
    validators: { onSubmit: packageSchema },
    onSubmit: async ({ value }) => {
      setServerErrors({})
      const result = await callAction(
        () => savePackageAction({ data: value }),
        'Could not save the package. Try again.',
      )
      if (!result) return
      if (result.ok) {
        toast.success('Package saved.')
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
        <DialogTitle>{initial.id ? 'Edit package' : 'New package'}</DialogTitle>
        <DialogDescription>
          A package preselects services, quantities and options. The client can
          change everything on the next step.
        </DialogDescription>
      </DialogHeader>

      <FieldGroup>
        <div className="grid gap-4 sm:grid-cols-2">
          <form.Field name="name">
            {(field) => {
              const errors = withServerErrors(
                field.name,
                field.state.meta.errors,
              )
              return (
                <Field data-invalid={errors.length > 0}>
                  <FieldLabel htmlFor="package-name">Name</FieldLabel>
                  <Input
                    id="package-name"
                    value={field.state.value}
                    aria-invalid={errors.length > 0}
                    onBlur={field.handleBlur}
                    onChange={(e) => field.handleChange(e.target.value)}
                  />
                  {errors.length > 0 && <FieldError errors={errors} />}
                </Field>
              )
            }}
          </form.Field>
          <form.Field name="categoryId">
            {(field) => (
              <Field>
                <FieldLabel htmlFor="package-categoryId">Category</FieldLabel>
                <SearchSelect
                  id="package-categoryId"
                  value={field.state.value || NONE}
                  placeholder="Choose a category"
                  emptyText="No categories found."
                  options={[
                    { value: NONE, label: 'No category' },
                    ...categories.map((c) => ({ value: c.id, label: c.name })),
                  ]}
                  onValueChange={(v) => field.handleChange(v === NONE ? '' : v)}
                />
              </Field>
            )}
          </form.Field>
        </div>
        <form.Field name="description">
          {(field) => {
            const errors = withServerErrors(field.name, field.state.meta.errors)
            return (
              <Field data-invalid={errors.length > 0}>
                <FieldLabel htmlFor="package-description">
                  Description
                </FieldLabel>
                <Textarea
                  id="package-description"
                  rows={2}
                  value={field.state.value}
                  aria-invalid={errors.length > 0}
                  onBlur={field.handleBlur}
                  onChange={(e) => field.handleChange(e.target.value)}
                />
                {errors.length > 0 && <FieldError errors={errors} />}
              </Field>
            )
          }}
        </form.Field>
        <form.Field name="isPrivate">
          {(field) => (
            <Field orientation="horizontal">
              <Checkbox
                id="package-private"
                checked={field.state.value}
                onCheckedChange={(checked) => field.handleChange(checked)}
              />
              <FieldLabel htmlFor="package-private">
                Private (hide from the public calculator)
              </FieldLabel>
            </Field>
          )}
        </form.Field>
      </FieldGroup>

      <form.Field name="items" mode="array">
        {(list) => {
          const listErrors = withServerErrors('items', list.state.meta.errors)
          const used = new Set(list.state.value.map((i) => i.serviceId))
          return (
            <FieldSet>
              <FieldLegend variant="label">Services</FieldLegend>
              {list.state.value.map((item, index) => {
                const service = byId.get(item.serviceId)
                return (
                  <div
                    key={`${item.serviceId}-${index}`}
                    className="grid gap-2 rounded-lg border p-3"
                  >
                    <div className="grid grid-cols-[1fr_6rem_auto] items-start gap-2">
                      <form.Field name={`items[${index}].serviceId`}>
                        {(field) => {
                          const errors = withServerErrors(
                            field.name,
                            field.state.meta.errors,
                          )
                          return (
                            <Field data-invalid={errors.length > 0}>
                              <SearchSelect
                                aria-label={`Service ${index + 1}`}
                                value={field.state.value || null}
                                invalid={errors.length > 0}
                                placeholder="Choose a service"
                                emptyText="No services found."
                                options={services.map((s) => ({
                                  value: s.id,
                                  label: s.name,
                                  disabled:
                                    used.has(s.id) &&
                                    s.id !== field.state.value,
                                }))}
                                onValueChange={(v) => {
                                  field.handleChange(v)
                                  form.setFieldValue(
                                    `items[${index}].optionIds`,
                                    [],
                                  )
                                  const next = byId.get(v)
                                  if (next) {
                                    form.setFieldValue(
                                      `items[${index}].quantity`,
                                      String(next.minQuantity),
                                    )
                                  }
                                }}
                              />
                              {errors.length > 0 && (
                                <FieldError errors={errors} />
                              )}
                            </Field>
                          )
                        }}
                      </form.Field>
                      <form.Field name={`items[${index}].quantity`}>
                        {(field) => {
                          const errors = withServerErrors(
                            field.name,
                            field.state.meta.errors,
                          )
                          return (
                            <Field data-invalid={errors.length > 0}>
                              <Input
                                aria-label={`Service ${index + 1} quantity`}
                                inputMode="numeric"
                                value={field.state.value}
                                aria-invalid={errors.length > 0}
                                onBlur={field.handleBlur}
                                onChange={(e) =>
                                  field.handleChange(e.target.value)
                                }
                              />
                              {errors.length > 0 && (
                                <FieldError errors={errors} />
                              )}
                            </Field>
                          )
                        }}
                      </form.Field>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        aria-label={`Remove service ${index + 1}`}
                        onClick={() => list.removeValue(index)}
                      >
                        <Trash2Icon />
                      </Button>
                    </div>
                    {service && service.options.length > 0 && (
                      <form.Field name={`items[${index}].optionIds`}>
                        {(field) => (
                          <div className="flex flex-wrap gap-x-4 gap-y-1">
                            {service.options.map((option) => (
                              <Field
                                key={option.id}
                                orientation="horizontal"
                                className="w-auto"
                              >
                                <Checkbox
                                  id={`package-${index}-${option.id}`}
                                  checked={field.state.value.includes(
                                    option.id,
                                  )}
                                  onCheckedChange={(on) =>
                                    field.handleChange(
                                      on
                                        ? [...field.state.value, option.id]
                                        : field.state.value.filter(
                                            (id) => id !== option.id,
                                          ),
                                    )
                                  }
                                />
                                <FieldLabel
                                  htmlFor={`package-${index}-${option.id}`}
                                  className="font-normal"
                                >
                                  {option.name}
                                </FieldLabel>
                              </Field>
                            ))}
                          </div>
                        )}
                      </form.Field>
                    )}
                  </div>
                )
              })}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-fit"
                disabled={
                  list.state.value.length >= MAX_ITEMS_PER_PACKAGE ||
                  used.size >= services.length
                }
                onClick={() =>
                  list.pushValue({
                    serviceId: '',
                    quantity: '1',
                    optionIds: [],
                  })
                }
              >
                <PlusIcon data-icon="inline-start" />
                Add service
              </Button>
              {listErrors.length > 0 && <FieldError errors={listErrors} />}
            </FieldSet>
          )
        }}
      </form.Field>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <form.Subscribe selector={(s) => s.isSubmitting}>
          {(submitting) => (
            <Button type="submit" disabled={submitting}>
              {submitting ? 'Saving...' : 'Save package'}
            </Button>
          )}
        </form.Subscribe>
      </DialogFooter>
    </form>
  )
}
