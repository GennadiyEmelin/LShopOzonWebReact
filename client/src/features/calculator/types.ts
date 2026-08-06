export type CalculatorScheme = 'fbo' | 'fbs'

export type CalculatorTaxMode = 'usn_income' | 'usn_income_minus_expenses' | 'none'

export type CalculatorMode = 'catalog' | 'manual'

export type CalculatorSettings = {
  acquiringPercent: number
  taxMode: CalculatorTaxMode
  taxPercent: number
  buyoutRatePercent: number
  logisticsRatePerLiter: number
  logisticsBaseAmount: number
  advertisingPercent: number
  extraCostFixed: number
  defaultScheme: CalculatorScheme
  updatedAt: string
}

export type CalculatorProduct = {
  productId: number
  offerId: string
  productName: string
  currentPrice: number
  minPrice: number | null
  costPrice: number
  salesPercentFbo: number
  salesPercentFbs: number
  fboFulfillmentAmount: number
  fboDirectFlowTransMinAmount: number
  fboDirectFlowTransMaxAmount: number
  fboDelivToCustomerAmount: number
  fboReturnFlowAmount: number
  fbsFirstMileMinAmount: number
  fbsDirectFlowTransMinAmount: number
  fbsDirectFlowTransMaxAmount: number
  fbsDelivToCustomerAmount: number
  fbsReturnFlowAmount: number
  acquiringPercent: number | null
  currencyCode: string
  fetchedAt: string
}

export type CalculatorCategory = {
  categoryId: number
  categoryName: string
  salesPercentFbo: number
  salesPercentFbs: number
  sampleSize: number
  isManualOverride: boolean
  updatedAt: string
}

export type CalculatorSyncState = {
  status: 'NotStarted' | 'InProgress' | 'Completed' | 'Failed'
  lastSyncStartedAt: string | null
  lastSyncCompletedAt: string | null
  totalProducts: number
  syncedProducts: number
  errorMessage: string | null
  localSnapshotCount: number
}

/** Вход расчёта. Зеркало CalculationInput на сервере. */
export type CalculationInput = {
  scheme: CalculatorScheme
  price: number
  salesPercent: number
  fulfillmentAmount: number
  firstMileAmount: number
  directFlowTransMinAmount: number
  directFlowTransMaxAmount: number
  delivToCustomerAmount: number
  returnFlowAmount: number
  acquiringPercent: number
  advertisingPercent: number
  costPrice: number
  extraCostFixed: number
  taxMode: CalculatorTaxMode
  taxPercent: number
  buyoutRatePercent: number
}

export type CalculationLine = {
  key: string
  label: string
  amount: number
  /** Откуда взялась цифра: «Ozon API», «Настройки», «Карточка себестоимости». */
  source: string
}

export type CalculationScenario = {
  lines: CalculationLine[]
  ozonPayout: number
  profit: number
  marginPercent: number
  roiPercent: number
}

export type CalculationResult = {
  price: number
  scheme: CalculatorScheme
  worst: CalculationScenario
  best: CalculationScenario
  breakEvenPrice: number | null
  warnings: string[]
}
