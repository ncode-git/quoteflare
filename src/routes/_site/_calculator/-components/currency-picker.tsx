import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { useCalculator } from './calculator-context'

export function CurrencyPicker() {
  const { catalog, displayCurrency, setDisplayCurrency } = useCalculator()
  const codes = [catalog.currency, ...Object.keys(catalog.rates).sort()]
  if (codes.length === 1) return null
  return (
    <Select
      value={displayCurrency}
      onValueChange={(code) => code && setDisplayCurrency(code)}
    >
      <SelectTrigger className="w-full" aria-label="Currency">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {codes.map((code) => (
          <SelectItem key={code} value={code}>
            {code}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
