import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  deselectService,
  evaluate,
  selectService,
  stateForPackage,
  type CalculatorCatalog,
  type CalculatorState,
  type ChosenService,
  type Evaluation,
} from '#/lib/calculator'
import { convertMinor, formatConverted } from '#/lib/currencies'
import { formatMinor } from '#/lib/decimal'

export const SCRATCH = 'scratch'

type CalculatorValue = {
  catalog: CalculatorCatalog
  state: CalculatorState
  evaluation: Evaluation
  /** A package id, `SCRATCH`, or null before the customer has chosen. */
  chosen: string | null
  /** The currency prices are shown in. Quotes are always issued in `catalog.currency`. */
  displayCurrency: string
  setDisplayCurrency: (currency: string) => void
  /** Formats base-currency cents in the display currency. */
  money: (minor: number) => string
  choose: (target: string) => void
  toggle: (id: string, checked: boolean) => void
  change: (id: string, patch: Partial<ChosenService>) => void
}

const CalculatorContext = createContext<CalculatorValue | null>(null)

export function CalculatorProvider({
  catalog,
  children,
}: {
  catalog: CalculatorCatalog
  children: ReactNode
}) {
  const [state, setState] = useState<CalculatorState>({})
  const [chosen, setChosen] = useState<string | null>(null)
  const [picked, setPicked] = useState(catalog.currency)
  const displayCurrency =
    picked !== catalog.currency && catalog.rates[picked]
      ? picked
      : catalog.currency
  const evaluation = useMemo(() => evaluate(catalog, state), [catalog, state])

  const value = useMemo<CalculatorValue>(
    () => ({
      catalog,
      state,
      evaluation,
      chosen,
      displayCurrency,
      setDisplayCurrency: setPicked,
      money: (minor) =>
        displayCurrency === catalog.currency
          ? formatMinor(minor, catalog.currency)
          : formatConverted(
              convertMinor(
                minor,
                catalog.rates[displayCurrency],
                displayCurrency,
              ),
              displayCurrency,
            ),
      choose: (target) => {
        const pkg = catalog.packages.find((p) => p.id === target)
        setState(pkg ? stateForPackage(catalog, pkg) : {})
        setChosen(pkg ? pkg.id : SCRATCH)
      },
      toggle: (id, checked) =>
        setState((current) =>
          checked
            ? selectService(catalog, current, id)
            : deselectService(current, id),
        ),
      change: (id, patch) =>
        setState((current) => ({
          ...current,
          [id]: { ...current[id], ...patch },
        })),
    }),
    [catalog, state, evaluation, chosen, displayCurrency],
  )

  return (
    <CalculatorContext.Provider value={value}>
      {children}
    </CalculatorContext.Provider>
  )
}

export function useCalculator() {
  const value = useContext(CalculatorContext)
  if (!value) throw new Error('useCalculator needs a CalculatorProvider')
  return value
}
