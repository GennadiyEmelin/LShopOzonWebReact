import type {
  CalculationInput,
  CalculationLine,
  CalculationResult,
  CalculationScenario,
} from '../types'

/**
 * Зеркало серверного CalculatorService.
 *
 * Нужно, чтобы цифры пересчитывались на каждое нажатие клавиши без запроса
 * к серверу. Сервер остаётся источником истины: при сохранении и экспорте
 * считает он. Расхождения возможны в последнем знаке — на сервере decimal,
 * здесь number с плавающей точкой.
 *
 * ВАЖНО: любое изменение формулы должно быть внесено в оба места.
 */

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100

function taxLabel(input: CalculationInput) {
  if (input.taxMode === 'usn_income_minus_expenses') {
    return `Налог с прибыли, ${round2(input.taxPercent)} %`
  }
  if (input.taxMode === 'none') {
    return 'Налог не учитывается'
  }
  return `Налог с оборота, ${round2(input.taxPercent)} %`
}

function calculateTax(input: CalculationInput, profitBeforeTax: number) {
  if (input.taxMode === 'none') {
    return 0
  }
  if (input.taxMode === 'usn_income_minus_expenses') {
    return profitBeforeTax > 0 ? (profitBeforeTax * input.taxPercent) / 100 : 0
  }
  return (input.price * input.taxPercent) / 100
}

/** Расходы, не зависящие от цены. */
function fixedCosts(input: CalculationInput, useMaxTransport: boolean) {
  const isFbo = input.scheme === 'fbo'
  const notBuyoutShare = Math.min(Math.max((100 - input.buyoutRatePercent) / 100, 0), 1)

  return (
    (isFbo ? input.fulfillmentAmount : input.firstMileAmount) +
    (useMaxTransport ? input.directFlowTransMaxAmount : input.directFlowTransMinAmount) +
    input.delivToCustomerAmount +
    input.returnFlowAmount * notBuyoutShare
  )
}

/** Доля расходов, пропорциональных цене. */
function variableShare(input: CalculationInput) {
  return (input.salesPercent + input.acquiringPercent + input.advertisingPercent) / 100
}

function buildScenario(input: CalculationInput, useMaxTransport: boolean): CalculationScenario {
  const lines: CalculationLine[] = []
  const isFbo = input.scheme === 'fbo'

  const salesCommission = (input.price * input.salesPercent) / 100
  lines.push({
    key: 'salesCommission',
    label: `Комиссия за продажу, ${round2(input.salesPercent)} %`,
    amount: -round2(salesCommission),
    source: 'Ozon API',
  })

  if (isFbo && input.fulfillmentAmount > 0) {
    lines.push({
      key: 'fulfillment',
      label: 'Фулфилмент',
      amount: -round2(input.fulfillmentAmount),
      source: 'Ozon API',
    })
  }

  if (!isFbo && input.firstMileAmount > 0) {
    lines.push({
      key: 'firstMile',
      label: 'Первая миля',
      amount: -round2(input.firstMileAmount),
      source: 'Ozon API',
    })
  }

  const transport = useMaxTransport
    ? input.directFlowTransMaxAmount
    : input.directFlowTransMinAmount

  if (transport > 0) {
    lines.push({
      key: 'logistics',
      label: useMaxTransport ? 'Логистика (верхняя граница)' : 'Логистика (нижняя граница)',
      amount: -round2(transport),
      source: 'Ozon API',
    })
  }

  if (input.delivToCustomerAmount > 0) {
    lines.push({
      key: 'lastMile',
      label: 'Последняя миля',
      amount: -round2(input.delivToCustomerAmount),
      source: 'Ozon API',
    })
  }

  const notBuyoutShare = Math.min(Math.max((100 - input.buyoutRatePercent) / 100, 0), 1)
  const returnFlow = input.returnFlowAmount * notBuyoutShare
  if (returnFlow > 0) {
    lines.push({
      key: 'returnFlow',
      label: `Обратная логистика (выкуп ${round2(input.buyoutRatePercent)} %)`,
      amount: -round2(returnFlow),
      source: 'Ozon API × настройки',
    })
  }

  const acquiring = (input.price * input.acquiringPercent) / 100
  if (acquiring > 0) {
    lines.push({
      key: 'acquiring',
      label: `Эквайринг, ${round2(input.acquiringPercent)} %`,
      amount: -round2(acquiring),
      source: 'Настройки',
    })
  }

  const ozonExpenses =
    salesCommission +
    (isFbo ? input.fulfillmentAmount : input.firstMileAmount) +
    transport +
    input.delivToCustomerAmount +
    returnFlow +
    acquiring

  const payout = input.price - ozonExpenses

  const advertising = (input.price * input.advertisingPercent) / 100
  if (advertising > 0) {
    lines.push({
      key: 'advertising',
      label: `Реклама, ${round2(input.advertisingPercent)} %`,
      amount: -round2(advertising),
      source: 'Настройки',
    })
  }

  if (input.costPrice > 0) {
    lines.push({
      key: 'costPrice',
      label: 'Себестоимость',
      amount: -round2(input.costPrice),
      source: 'Карточка себестоимости',
    })
  }

  if (input.extraCostFixed > 0) {
    lines.push({
      key: 'extraCost',
      label: 'Прочие расходы',
      amount: -round2(input.extraCostFixed),
      source: 'Настройки',
    })
  }

  const profitBeforeTax = payout - advertising - input.costPrice - input.extraCostFixed
  const tax = calculateTax(input, profitBeforeTax)

  if (tax > 0) {
    lines.push({
      key: 'tax',
      label: taxLabel(input),
      amount: -round2(tax),
      source: 'Настройки',
    })
  }

  const profit = profitBeforeTax - tax

  return {
    lines,
    ozonPayout: round2(payout),
    profit: round2(profit),
    marginPercent: input.price > 0 ? round2((profit / input.price) * 100) : 0,
    roiPercent: input.costPrice > 0 ? round2((profit / input.costPrice) * 100) : 0,
  }
}

/** Цена, при которой прибыль равна нулю. Считается по худшему сценарию. */
export function findBreakEvenPrice(input: CalculationInput): number | null {
  const totalFixed = fixedCosts(input, true) + input.costPrice + input.extraCostFixed
  const tax = input.taxPercent / 100

  // При «доходы минус расходы» в нулевой точке налог тоже ноль.
  const denominator =
    input.taxMode === 'usn_income'
      ? 1 - variableShare(input) - tax
      : 1 - variableShare(input)

  if (denominator <= 0) {
    return null
  }

  return round2(totalFixed / denominator)
}

export function calculate(input: CalculationInput): CalculationResult {
  const warnings: string[] = []

  if (input.price <= 0) {
    warnings.push('Цена продажи не задана.')
  }

  if (input.costPrice <= 0) {
    warnings.push('Себестоимость не задана — показана только выплата Ozon, не прибыль.')
  }

  if (input.salesPercent <= 0) {
    warnings.push('Комиссия за продажу равна нулю — проверьте, синхронизированы ли тарифы.')
  }

  return {
    price: round2(input.price),
    scheme: input.scheme,
    worst: buildScenario(input, true),
    best: buildScenario(input, false),
    breakEvenPrice: findBreakEvenPrice(input),
    warnings,
  }
}

/** Обратный расчёт: цена под заданную маржу. */
export function calculatePriceForMargin(
  input: CalculationInput,
  targetMarginPercent: number,
): number | null {
  const margin = targetMarginPercent / 100
  const totalFixed = fixedCosts(input, true) + input.costPrice + input.extraCostFixed
  const share = variableShare(input)
  const tax = input.taxPercent / 100

  let numerator: number
  let denominator: number

  if (input.taxMode === 'usn_income_minus_expenses') {
    numerator = totalFixed * (1 - tax)
    denominator = (1 - share) * (1 - tax) - margin
  } else if (input.taxMode === 'none') {
    numerator = totalFixed
    denominator = 1 - share - margin
  } else {
    numerator = totalFixed
    denominator = 1 - share - tax - margin
  }

  if (denominator <= 0) {
    return null
  }

  return round2(numerator / denominator)
}

export function formatMoney(value: number, currency = '₽') {
  return `${value.toLocaleString('ru-RU', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${currency}`
}

export function formatPercent(value: number) {
  return `${value.toLocaleString('ru-RU', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} %`
}
