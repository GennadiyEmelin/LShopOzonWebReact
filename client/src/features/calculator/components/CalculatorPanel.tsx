import { useCallback, useEffect, useMemo, useState } from 'react'
import { apiFetch, parseApiErrorMessage } from '../../../shared/api/client'
import {
  calculate,
  calculatePriceForMargin,
  currencySymbol,
  formatMoney,
} from '../lib/calculatorFormulas'
import type {
  CalculationInput,
  CalculatorCategory,
  CalculatorMode,
  CalculatorProduct,
  CalculatorScheme,
  CalculatorSettings,
  CalculatorSyncState,
} from '../types'
import { CalculationBreakdown } from './CalculationBreakdown'
import { CalculatorSettingsPanel } from './CalculatorSettingsPanel'

type CalculatorPanelProps = {
  token: string | null
  canEdit: boolean
}

const defaultSettings: CalculatorSettings = {
  acquiringPercent: 1.5,
  taxMode: 'none',
  taxPercent: 0,
  buyoutRatePercent: 90,
  logisticsRatePerLiter: 0,
  logisticsBaseAmount: 0,
  advertisingPercent: 0,
  extraCostFixed: 0,
  defaultScheme: 'fbo',
  payoutDelayWeeks: 0,
  payoutDayOfWeek: 3,
  updatedAt: '',
}

type ManualForm = {
  categoryId: number | null
  salesPercent: number
  fulfillmentAmount: number
  firstMileAmount: number
  logisticsAmount: number
  delivToCustomerAmount: number
  returnFlowAmount: number
  costPrice: number
  depth: number
  width: number
  height: number
}

const emptyManualForm: ManualForm = {
  categoryId: null,
  salesPercent: 0,
  fulfillmentAmount: 0,
  firstMileAmount: 0,
  logisticsAmount: 0,
  delivToCustomerAmount: 0,
  returnFlowAmount: 0,
  costPrice: 0,
  depth: 0,
  width: 0,
  height: 0,
}

function formatDateTime(value: string | null) {
  if (!value) {
    return 'ещё не запускалась'
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    return 'ещё не запускалась'
  }

  return parsed.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function CalculatorPanel({ token, canEdit }: CalculatorPanelProps) {
  const [mode, setMode] = useState<CalculatorMode>('catalog')
  const [scheme, setScheme] = useState<CalculatorScheme>('fbo')

  const [settings, setSettings] = useState<CalculatorSettings>(defaultSettings)
  const [settingsDraft, setSettingsDraft] = useState<CalculatorSettings>(defaultSettings)
  const [showSettings, setShowSettings] = useState(false)
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsStatus, setSettingsStatus] = useState('')

  const [search, setSearch] = useState('')
  const [products, setProducts] = useState<CalculatorProduct[]>([])
  const [selectedProduct, setSelectedProduct] = useState<CalculatorProduct | null>(null)
  const [loadingProducts, setLoadingProducts] = useState(false)

  const [categories, setCategories] = useState<CalculatorCategory[]>([])
  const [manual, setManual] = useState<ManualForm>(emptyManualForm)

  const [price, setPrice] = useState(0)
  const [costPriceOverride, setCostPriceOverride] = useState<number | null>(null)
  const [targetMargin, setTargetMargin] = useState(30)

  const [syncState, setSyncState] = useState<CalculatorSyncState | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState('')

  // ---------- Загрузка ----------

  const loadSettings = useCallback(async () => {
    if (!token) return

    try {
      const response = await apiFetch('/api/calculator/settings', token)
      if (!response.ok) {
        setError(await parseApiErrorMessage(response, 'Не удалось загрузить настройки калькулятора.'))
        return
      }

      const data = (await response.json()) as CalculatorSettings
      setSettings(data)
      setSettingsDraft(data)
      setScheme(data.defaultScheme)
    } catch {
      setError('Не удалось загрузить настройки калькулятора.')
    }
  }, [token])

  const loadSyncState = useCallback(async () => {
    if (!token) return

    try {
      const response = await apiFetch('/api/calculator/sync-state', token)
      if (response.ok) {
        setSyncState((await response.json()) as CalculatorSyncState)
      }
    } catch {
      // Состояние синхронизации — не критично, молчим.
    }
  }, [token])

  const loadCategories = useCallback(async () => {
    if (!token) return

    try {
      const response = await apiFetch('/api/calculator/categories', token)
      if (response.ok) {
        setCategories((await response.json()) as CalculatorCategory[])
      }
    } catch {
      // Справочник может быть пуст — это нормально.
    }
  }, [token])

  useEffect(() => {
    void loadSettings()
    void loadSyncState()
    void loadCategories()
  }, [loadSettings, loadSyncState, loadCategories])

  // Поиск товаров с задержкой, чтобы не бить по API на каждую букву.
  useEffect(() => {
    if (!token || mode !== 'catalog') return

    const timer = window.setTimeout(async () => {
      setLoadingProducts(true)
      try {
        const query = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : ''
        const response = await apiFetch(`/api/calculator/products${query}`, token)
        if (response.ok) {
          setProducts((await response.json()) as CalculatorProduct[])
        } else {
          setError(await parseApiErrorMessage(response, 'Не удалось загрузить товары.'))
        }
      } catch {
        setError('Не удалось загрузить товары.')
      } finally {
        setLoadingProducts(false)
      }
    }, 300)

    return () => window.clearTimeout(timer)
  }, [token, search, mode])

  // Пока идёт синхронизация — обновляем прогресс.
  useEffect(() => {
    if (syncState?.status !== 'InProgress') return

    const timer = window.setInterval(() => void loadSyncState(), 3000)
    return () => window.clearInterval(timer)
  }, [syncState?.status, loadSyncState])

  // ---------- Действия ----------

  const handleSelectProduct = (product: CalculatorProduct) => {
    setSelectedProduct(product)
    setPrice(product.currentPrice)
    setCostPriceOverride(null)
    setError('')
  }

  const handleSaveSettings = async () => {
    if (!token || !canEdit) return

    setSavingSettings(true)
    setSettingsStatus('')

    try {
      const response = await apiFetch('/api/calculator/settings', token, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settingsDraft),
      })

      if (!response.ok) {
        setSettingsStatus(await parseApiErrorMessage(response, 'Не удалось сохранить настройки.'))
        return
      }

      const data = (await response.json()) as CalculatorSettings
      setSettings(data)
      setSettingsDraft(data)
      setSettingsStatus('Сохранено')
    } catch {
      setSettingsStatus('Не удалось сохранить настройки.')
    } finally {
      setSavingSettings(false)
    }
  }

  const handleSync = async () => {
    if (!token || !canEdit) return

    setSyncing(true)
    try {
      const response = await apiFetch('/api/calculator/sync', token, { method: 'POST' })
      if (response.ok) {
        setSyncState((await response.json()) as CalculatorSyncState)
      } else {
        setError(await parseApiErrorMessage(response, 'Не удалось запустить синхронизацию.'))
      }
    } catch {
      setError('Не удалось запустить синхронизацию.')
    } finally {
      setSyncing(false)
    }
  }

  // ---------- Расчёт ----------

  const input = useMemo<CalculationInput>(() => {
    const isFbo = scheme === 'fbo'

    if (mode === 'catalog' && selectedProduct) {
      return {
        scheme,
        price,
        salesPercent: isFbo ? selectedProduct.salesPercentFbo : selectedProduct.salesPercentFbs,
        fulfillmentAmount: isFbo ? selectedProduct.fboFulfillmentAmount : 0,
        firstMileAmount: isFbo ? 0 : selectedProduct.fbsFirstMileMinAmount,
        directFlowTransMinAmount: isFbo
          ? selectedProduct.fboDirectFlowTransMinAmount
          : selectedProduct.fbsDirectFlowTransMinAmount,
        directFlowTransMaxAmount: isFbo
          ? selectedProduct.fboDirectFlowTransMaxAmount
          : selectedProduct.fbsDirectFlowTransMaxAmount,
        delivToCustomerAmount: isFbo
          ? selectedProduct.fboDelivToCustomerAmount
          : selectedProduct.fbsDelivToCustomerAmount,
        returnFlowAmount: isFbo
          ? selectedProduct.fboReturnFlowAmount
          : selectedProduct.fbsReturnFlowAmount,
        acquiringPercent: selectedProduct.acquiringPercent ?? settings.acquiringPercent,
        advertisingPercent: settings.advertisingPercent,
        costPrice: costPriceOverride ?? selectedProduct.costPrice,
        extraCostFixed: settings.extraCostFixed,
        // Налог не считаем — см. комментарий в CalculatorEndpoints.
        taxMode: 'none',
        taxPercent: 0,
        buyoutRatePercent: settings.buyoutRatePercent,
      }
    }

    const liters = (manual.depth * manual.width * manual.height) / 1000
    const estimatedLogistics =
      manual.logisticsAmount > 0
        ? manual.logisticsAmount
        : liters > 0
          ? settings.logisticsBaseAmount + liters * settings.logisticsRatePerLiter
          : 0

    return {
      scheme,
      price,
      salesPercent: manual.salesPercent,
      fulfillmentAmount: manual.fulfillmentAmount,
      firstMileAmount: manual.firstMileAmount,
      directFlowTransMinAmount: estimatedLogistics,
      directFlowTransMaxAmount: estimatedLogistics,
      delivToCustomerAmount: manual.delivToCustomerAmount,
      returnFlowAmount: manual.returnFlowAmount,
      acquiringPercent: settings.acquiringPercent,
      advertisingPercent: settings.advertisingPercent,
      costPrice: manual.costPrice,
      extraCostFixed: settings.extraCostFixed,
      taxMode: 'none',
      taxPercent: 0,
      buyoutRatePercent: settings.buyoutRatePercent,
    }
  }, [mode, scheme, price, selectedProduct, costPriceOverride, manual, settings])

  // Валюта берётся из тарифов Ozon по товару; в ручном режиме — тенге.
  const currency = currencySymbol(selectedProduct?.currencyCode)

  const result = useMemo(() => calculate(input), [input])
  const requiredPrice = useMemo(
    () => calculatePriceForMargin(input, targetMargin),
    [input, targetMargin],
  )

  const updateManual = (patch: Partial<ManualForm>) => setManual((current) => ({ ...current, ...patch }))

  const isStale =
    syncState?.lastSyncCompletedAt != null &&
    Date.now() - new Date(syncState.lastSyncCompletedAt).getTime() > 48 * 3600 * 1000

  // ---------- Разметка ----------

  return (
    <div className="calc-panel">
      <div className="calc-toolbar">
        <div className="inner-tabs calc-mode-tabs">
          <button
            type="button"
            className={mode === 'catalog' ? 'active' : ''}
            onClick={() => setMode('catalog')}
          >
            По своим товарам
          </button>
          <button
            type="button"
            className={mode === 'manual' ? 'active' : ''}
            onClick={() => setMode('manual')}
          >
            Ручной расчёт
          </button>
        </div>

        <div className="calc-scheme-switch">
          <button
            type="button"
            className={scheme === 'fbo' ? 'active' : ''}
            onClick={() => setScheme('fbo')}
          >
            FBO
          </button>
          <button
            type="button"
            className={scheme === 'fbs' ? 'active' : ''}
            onClick={() => setScheme('fbs')}
          >
            FBS
          </button>
        </div>

        <button type="button" className="secondary" onClick={() => setShowSettings((value) => !value)}>
          {showSettings ? 'Скрыть настройки' : 'Настройки'}
        </button>
      </div>

      <div className={`calc-sync-bar ${isStale ? 'calc-sync-stale' : ''}`}>
        <span>
          Тарифы обновлены: <strong>{formatDateTime(syncState?.lastSyncCompletedAt ?? null)}</strong>
          {syncState ? ` · товаров в базе: ${syncState.localSnapshotCount}` : ''}
        </span>

        {syncState?.status === 'InProgress' && (
          <span className="calc-sync-progress">
            Синхронизация: {syncState.syncedProducts} из {syncState.totalProducts}
          </span>
        )}

        {syncState?.status === 'Failed' && syncState.errorMessage && (
          <span className="calc-sync-error">{syncState.errorMessage}</span>
        )}

        {canEdit && (
          <button
            type="button"
            className="secondary"
            onClick={handleSync}
            disabled={syncing || syncState?.status === 'InProgress'}
          >
            {syncing ? 'Запускаю…' : 'Обновить тарифы'}
          </button>
        )}
      </div>

      {error && <div className="calc-error">{error}</div>}

      {showSettings && (
        <CalculatorSettingsPanel
          settings={settingsDraft}
          canEdit={canEdit}
          saving={savingSettings}
          status={settingsStatus}
          onChange={setSettingsDraft}
          onSave={handleSaveSettings}
          onClose={() => setShowSettings(false)}
          currency={currency}
        />
      )}

      <div className="calc-layout">
        <div className="calc-form">
          {mode === 'catalog' ? (
            <>
              <label className="calc-field">
                <span>Товар</span>
                <input
                  type="search"
                  placeholder="Название или артикул"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </label>

              <div className="calc-product-list">
                {loadingProducts && <div className="calc-product-empty">Загружаю…</div>}

                {!loadingProducts && products.length === 0 && (
                  <div className="calc-product-empty">
                    {syncState && syncState.localSnapshotCount === 0
                      ? 'Тарифы ещё не загружены. Нажмите «Обновить тарифы».'
                      : 'Ничего не найдено.'}
                  </div>
                )}

                {products.map((product) => (
                  <button
                    type="button"
                    key={product.productId}
                    className={`calc-product-row ${
                      selectedProduct?.productId === product.productId ? 'active' : ''
                    }`}
                    onClick={() => handleSelectProduct(product)}
                  >
                    <span className="calc-product-name">{product.productName || product.offerId}</span>
                    <span className="calc-product-meta">
                      {product.offerId} · {formatMoney(product.currentPrice, currencySymbol(product.currencyCode))} ·{' '}
                      {scheme === 'fbo' ? product.salesPercentFbo : product.salesPercentFbs} %
                    </span>
                  </button>
                ))}
              </div>

              {selectedProduct && (
                <>
                  <label className="calc-field">
                    <span>Цена продажи, {currency}</span>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      value={price}
                      onChange={(event) => setPrice(Number(event.target.value))}
                    />
                  </label>

                  <label className="calc-field">
                    <span>Себестоимость, {currency}</span>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      value={costPriceOverride ?? selectedProduct.costPrice}
                      onChange={(event) => setCostPriceOverride(Number(event.target.value))}
                    />
                    <small>
                      {selectedProduct.costPrice > 0
                        ? 'Из карточки себестоимости — можно изменить для прикидки'
                        : 'В карточке товара себестоимость не заполнена'}
                    </small>
                  </label>
                </>
              )}
            </>
          ) : (
            <>
              <label className="calc-field">
                <span>Категория</span>
                <select
                  value={manual.categoryId ?? ''}
                  onChange={(event) => {
                    const value = event.target.value ? Number(event.target.value) : null
                    const category = categories.find((entry) => entry.categoryId === value)
                    updateManual({
                      categoryId: value,
                      salesPercent: category
                        ? scheme === 'fbo'
                          ? category.salesPercentFbo
                          : category.salesPercentFbs
                        : manual.salesPercent,
                    })
                  }}
                >
                  <option value="">
                  Не выбрано — можно просто вписать комиссию в поле ниже
                </option>
                  {categories.map((category) => (
                    <option key={category.categoryId} value={category.categoryId}>
                      {category.categoryName || `Без названия (id ${category.categoryId})`}
                      {` — комиссия ${scheme === 'fbo' ? category.salesPercentFbo : category.salesPercentFbs} %`}
                      {category.isManualOverride
                        ? ', задана вручную'
                        : `, посчитана по ${category.sampleSize} вашим товарам`}
                    </option>
                  ))}
                </select>
                {categories.length === 0 && (
                  <small>
                    Справочник пуст: он строится по вашему каталогу после синхронизации тарифов.
                  </small>
                )}
              </label>

              <div className="calc-field-grid">
                <label className="calc-field">
                  <span>Цена продажи, {currency}</span>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={price}
                    onChange={(event) => setPrice(Number(event.target.value))}
                  />
                </label>

                <label className="calc-field">
                  <span>Комиссия, %</span>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                    value={manual.salesPercent}
                    onChange={(event) => updateManual({ salesPercent: Number(event.target.value) })}
                  />
                </label>

                <label className="calc-field">
                  <span>Себестоимость, {currency}</span>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={manual.costPrice}
                    onChange={(event) => updateManual({ costPrice: Number(event.target.value) })}
                  />
                </label>

                <label className="calc-field">
                  <span>Последняя миля, {currency}</span>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={manual.delivToCustomerAmount}
                    onChange={(event) =>
                      updateManual({ delivToCustomerAmount: Number(event.target.value) })
                    }
                  />
                </label>

                <label className="calc-field">
                  <span>Обратная логистика, {currency}</span>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={manual.returnFlowAmount}
                    onChange={(event) => updateManual({ returnFlowAmount: Number(event.target.value) })}
                  />
                </label>

                <label className="calc-field">
                  <span>{scheme === 'fbo' ? `Фулфилмент, ${currency}` : `Первая миля, ${currency}`}</span>
                  <input
                    type="number"
                    step="1"
                    min="0"
                    value={scheme === 'fbo' ? manual.fulfillmentAmount : manual.firstMileAmount}
                    onChange={(event) =>
                      updateManual(
                        scheme === 'fbo'
                          ? { fulfillmentAmount: Number(event.target.value) }
                          : { firstMileAmount: Number(event.target.value) },
                      )
                    }
                  />
                </label>
              </div>

              <fieldset className="calc-dimensions">
                <legend>Габариты, см — для оценки логистики</legend>
                <div className="calc-field-grid calc-dimensions-grid">
                  <label className="calc-field">
                    <span>Длина</span>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      value={manual.depth}
                      onChange={(event) => updateManual({ depth: Number(event.target.value) })}
                    />
                  </label>
                  <label className="calc-field">
                    <span>Ширина</span>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      value={manual.width}
                      onChange={(event) => updateManual({ width: Number(event.target.value) })}
                    />
                  </label>
                  <label className="calc-field">
                    <span>Высота</span>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      value={manual.height}
                      onChange={(event) => updateManual({ height: Number(event.target.value) })}
                    />
                  </label>
                  <label className="calc-field">
                    <span>Логистика, {currency}</span>
                    <input
                      type="number"
                      step="1"
                      min="0"
                      value={manual.logisticsAmount}
                      onChange={(event) =>
                        updateManual({ logisticsAmount: Number(event.target.value) })
                      }
                    />
                    <small>Задайте вручную, чтобы не считать по габаритам</small>
                  </label>
                </div>
              </fieldset>
            </>
          )}
        </div>

        <div className="calc-result">
          {mode === 'catalog' && !selectedProduct ? (
            <div className="calc-product-empty">Выберите товар слева.</div>
          ) : (
            <>
              <CalculationBreakdown result={result} showRange={mode === 'catalog'} currency={currency} />

              <div className="calc-reverse">
                <div className="calc-reverse-head">
                  <strong>Какая цена нужна для маржи</strong>
                  <input
                    type="number"
                    step="1"
                    min="1"
                    max="99"
                    value={targetMargin}
                    onChange={(event) => setTargetMargin(Number(event.target.value))}
                  />
                  <span>%</span>
                </div>
                <div className="calc-reverse-value">
                  {requiredPrice === null ? (
                    <span className="calc-loss">
                      Недостижимо: комиссия, налог и целевая маржа съедают всю цену
                    </span>
                  ) : (
                    <>
                      <strong>{formatMoney(requiredPrice, currency)}</strong>
                      <button
                        type="button"
                        className="secondary"
                        title="Подставит эту цену в поле расчёта выше. В Ozon ничего не изменится."
                        onClick={() => setPrice(requiredPrice)}
                      >
                        Подставить в расчёт
                      </button>
                    </>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {mode === 'catalog' && selectedProduct && (
        <p className="calc-note">
          Комиссия, логистика и последняя миля — тарифы Ozon по этому товару, а не средние по
          категории. Обновлены {formatDateTime(selectedProduct.fetchedAt)}.
        </p>
      )}
    </div>
  )
}
