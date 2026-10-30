import { InfoIcon } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import type { CalculatorService, ChosenService } from '#/lib/calculator'
import { bpsToPercent } from '#/lib/decimal'
import { BILLING_LABELS } from '#/lib/services'
import { useCalculator } from './calculator-context'

type Option = CalculatorService['options'][number]

const optionPrice = (option: Option, money: (minor: number) => string) =>
  option.modifierType === 'flat'
    ? `+${money(option.modifierValue)}`
    : `+${bpsToPercent(option.modifierValue)}%`

const estimate = (service: CalculatorService) => {
  const { estimatedDaysMin: min, estimatedDaysMax: max } = service
  if (min === null && max === null) return null
  if (min !== null && max !== null && min !== max)
    return `${min} to ${max} days`
  return `${min ?? max} days`
}

export function ServiceCard({
  service,
  choice,
  problems,
  requiredBy,
  requires,
  onToggle,
  onChange,
}: {
  service: CalculatorService
  choice: ChosenService | undefined
  problems: string[]
  requiredBy: string[]
  requires: string[]
  onToggle: (checked: boolean) => void
  onChange: (patch: Partial<ChosenService>) => void
}) {
  const { money } = useCalculator()
  const checked = Boolean(choice)
  const locked = requiredBy.length > 0
  const single = service.maxQuantity === 1
  const hasDetails =
    !single || service.options.length > 0 || problems.length > 0
  const days = estimate(service)
  const recurring = service.billing !== 'one_time'
  const id = `service-${service.id}`

  const toggleOption = (option: Option, on: boolean) => {
    if (!choice) return
    onChange({
      optionIds: on
        ? [...choice.optionIds, option.id]
        : choice.optionIds.filter((o) => o !== option.id),
    })
  }

  const setSingle = (groupId: string | null, optionId: string) => {
    if (!choice) return
    const others = service.options
      .filter((o) => o.groupId === groupId)
      .map((o) => o.id)
    onChange({
      optionIds: [
        ...choice.optionIds.filter((o) => !others.includes(o)),
        optionId,
      ],
    })
  }

  return (
    <Card className="[--card-spacing:--spacing(5)]">
      <CardContent className="flex flex-col gap-5">
        <div className="flex items-start gap-3">
          <Checkbox
            id={id}
            checked={checked}
            disabled={locked}
            onCheckedChange={onToggle}
            className="mt-1"
          />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <label
              htmlFor={id}
              className="flex flex-wrap items-baseline gap-x-2"
            >
              <span className="font-medium">{service.name}</span>
              <span className="text-sm text-muted-foreground">
                {service.pricingMode === 'custom' && 'From '}
                {`${money(service.unitPrice)} / ${service.unitLabel}`}
                {recurring &&
                  `, ${BILLING_LABELS[service.billing].toLowerCase()}`}
              </span>
            </label>
            {service.description && (
              <p className="text-sm text-muted-foreground">
                {service.description}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {days && <Badge variant="secondary">{days}</Badge>}
              {!service.taxable && <Badge variant="outline">No tax</Badge>}
              {service.requires.length > 0 && (
                <Badge variant="outline">Includes {requires.join(', ')}</Badge>
              )}
            </div>
            {service.note && (
              <Alert>
                <InfoIcon />
                <AlertDescription>{service.note}</AlertDescription>
              </Alert>
            )}
            {locked && (
              <p className="text-sm text-muted-foreground">
                Needed by {requiredBy.join(', ')}.
              </p>
            )}
          </div>
        </div>

        {choice && hasDetails && (
          <div className="flex flex-col gap-5 border-t pt-5 sm:pl-7">
            {!single && (
              <Field>
                <FieldLabel htmlFor={`${id}-quantity`}>Quantity</FieldLabel>
                <Input
                  id={`${id}-quantity`}
                  type="number"
                  inputMode="numeric"
                  min={service.minQuantity}
                  max={service.maxQuantity ?? undefined}
                  step={service.quantityStep}
                  value={choice.quantity}
                  onChange={(e) => onChange({ quantity: e.target.value })}
                  className="w-32"
                />
                <FieldDescription>
                  {`Minimum ${service.minQuantity}`}
                  {service.maxQuantity !== null &&
                    `, maximum ${service.maxQuantity}`}
                  {service.quantityStep > 1 &&
                    `, in steps of ${service.quantityStep}`}
                </FieldDescription>
              </Field>
            )}

            {service.groups.map((group) => {
              const options = service.options.filter(
                (o) => o.groupId === group.id,
              )
              if (options.length === 0) return null
              return (
                <FieldSet key={group.id}>
                  <FieldLegend variant="label">
                    {group.name}
                    {group.required ? ' (required)' : ' (optional)'}
                  </FieldLegend>
                  {group.selection === 'single' ? (
                    <RadioGroup
                      value={
                        options.find((o) => choice.optionIds.includes(o.id))
                          ?.id ?? ''
                      }
                      onValueChange={(value) =>
                        setSingle(group.id, String(value))
                      }
                    >
                      {options.map((option) => (
                        <Field key={option.id} orientation="horizontal">
                          <RadioGroupItem
                            id={`${id}-${option.id}`}
                            value={option.id}
                          />
                          <FieldLabel htmlFor={`${id}-${option.id}`}>
                            {option.name}
                            <span className="ml-auto text-muted-foreground">
                              {optionPrice(option, money)}
                            </span>
                          </FieldLabel>
                        </Field>
                      ))}
                    </RadioGroup>
                  ) : (
                    options.map((option) => (
                      <Field key={option.id} orientation="horizontal">
                        <Checkbox
                          id={`${id}-${option.id}`}
                          checked={choice.optionIds.includes(option.id)}
                          onCheckedChange={(on) => toggleOption(option, on)}
                        />
                        <FieldLabel htmlFor={`${id}-${option.id}`}>
                          {option.name}
                          <span className="ml-auto text-muted-foreground">
                            {optionPrice(option, money)}
                          </span>
                        </FieldLabel>
                      </Field>
                    ))
                  )}
                </FieldSet>
              )
            })}

            {service.options.some((o) => o.groupId === null) && (
              <FieldSet>
                <FieldLegend variant="label">Extras</FieldLegend>
                {service.options
                  .filter((o) => o.groupId === null)
                  .map((option) => (
                    <Field key={option.id} orientation="horizontal">
                      <Checkbox
                        id={`${id}-${option.id}`}
                        checked={choice.optionIds.includes(option.id)}
                        onCheckedChange={(on) => toggleOption(option, on)}
                      />
                      <FieldLabel htmlFor={`${id}-${option.id}`}>
                        {option.name}
                        <span className="ml-auto text-muted-foreground">
                          {optionPrice(option, money)}
                        </span>
                      </FieldLabel>
                    </Field>
                  ))}
              </FieldSet>
            )}

            {problems.length > 0 && (
              <FieldError>{problems.join(' ')}</FieldError>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
