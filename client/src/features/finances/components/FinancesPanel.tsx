import { Fragment, useCallback, useEffect, useState } from 'react'
import { apiFetch, parseApiErrorMessage } from '../../../shared/api/client'

type PayoutServiceItem = {
  name: string
  amount: number
}

type PayoutPeriod = {
  periodBegin: string
  periodEnd: string
  label: string
  ordersAmount: number
  returnsAmount: number
  commission: number
  logistics: number
  services: number
  /** Фактически перечислено продавцу в этом периоде. */
  paidOut: number
  /** Начислено к выплате — деньги, которые ещё придут. */
  pendingPayout: number
  /** День перечисления внутри платёжного периода по графику кабинета. */
  paidOutDate: string | null
  /** Дата выплаты по стандартному графику: среда через 3 недели после конца периода. */
  estimatedPayoutDate: string | null
  beginBalance: number
  endBalance: number
  serviceItems: PayoutServiceItem[]
}

type PayoutReport = {
  periods: PayoutPeriod[]
  paidTotal: number
  pendingTotal: number
  currentBalance: number | null
  currencyCode: string
  periodCount: number
}

type FinancesPanelProps = {
  token: string | null
  dateFrom: string
  dateTo: string
}

function money(value: number, currency: string) {
  return `${Math.round(value).toLocaleString('ru-RU')} ${currency}`
}

/** Доля расхода от суммы продаж — как проценты в кабинете Ozon. */
function share(amount: number, sales: number) {
  if (!sales) return ''
  return ` ${((Math.abs(amount) / sales) * 100).toFixed(1).replace('.', ',')} %`
}

function shortDate(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: 'long' })
}

export function FinancesPanel({ token, dateFrom, dateTo }: FinancesPanelProps) {
  const [report, setReport] = useState<PayoutReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!token) return

    setLoading(true)
    setError('')

    try {
      const query = new URLSearchParams({ dateFrom, dateTo }).toString()
      const response = await apiFetch(`/api/ozon/finance/payouts?${query}`, token)

      if (!response.ok) {
        setError(await parseApiErrorMessage(response, 'Не удалось загрузить данные о выплатах.'))
        setReport(null)
        return
      }

      setReport((await response.json()) as PayoutReport)
    } catch {
      setError('Не удалось загрузить данные о выплатах.')
      setReport(null)
    } finally {
      setLoading(false)
    }
  }, [token, dateFrom, dateTo])

  useEffect(() => {
    void load()
  }, [load])

  if (loading) {
    return <div className="fin-empty">Загружаю данные о выплатах…</div>
  }

  if (error) {
    return <div className="calc-error">{error}</div>
  }

  if (!report || report.periods.length === 0) {
    return <div className="fin-empty">За выбранный период данных о выплатах нет.</div>
  }

  const currency = report.currencyCode
  const pending = report.periods.filter((period) => period.pendingPayout > 0)
  const paid = report.periods.filter((period) => period.paidOut > 0)

  return (
    <div className="fin-panel">
      {/* Главное — сколько ещё придёт и когда */}
      <div className="fin-payouts">
        <div className="fin-payouts-block">
          <h3>Ожидают выплаты</h3>
          {pending.length === 0 ? (
            <div className="fin-payouts-empty">Нет начислений, ожидающих перечисления.</div>
          ) : (
            pending.map((period) => (
              <div className="fin-payout-line fin-payout-pending" key={`p-${period.periodBegin}`}>
                <div className="fin-payout-sum">{money(period.pendingPayout, currency)}</div>
                <div className="fin-payout-meta">
                  <span className="fin-badge fin-badge-pending">
                    выплата {shortDate(period.estimatedPayoutDate)}
                  </span>
                  <span className="fin-payout-period">начислено в периоде {period.label}</span>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="fin-payouts-block">
          <h3>Уже выплачено</h3>
          {paid.length === 0 ? (
            <div className="fin-payouts-empty">В выбранном периоде выплат не было.</div>
          ) : (
            paid.slice(0, 5).map((period) => (
              <div className="fin-payout-line" key={`d-${period.periodBegin}`}>
                <div className="fin-payout-sum">{money(period.paidOut, currency)}</div>
                <div className="fin-payout-meta">
                  <span className="fin-badge fin-badge-paid">
                    выплачено {shortDate(period.paidOutDate)}
                  </span>
                  <span className="fin-payout-period">в период {period.label}</span>
                </div>
              </div>
            ))
          )}
        </div>

        <div className="fin-payouts-block fin-payouts-balance">
          <h3>Баланс Ozon</h3>
          <div className="fin-balance-value">
            {report.currentBalance === null ? '—' : money(report.currentBalance, currency)}
          </div>
          <span className="fin-payouts-empty">на конец последнего периода</span>
        </div>
      </div>

      {/* Детализация по неделям */}
      <details className="fin-details-toggle" open>
        <summary>Разбивка по неделям</summary>

        <div className="fin-table-wrap">
          <table className="fin-table">
            <thead>
              <tr>
                <th>Период</th>
                <th className="fin-num">Продажи</th>
                <th className="fin-num">Комиссия</th>
                <th className="fin-num">Логистика</th>
                <th className="fin-num">Услуги</th>
                <th className="fin-num">Баланс</th>
              </tr>
            </thead>
            <tbody>
              {report.periods.map((period) => {
                const isOpen = expanded === period.periodBegin
                const hasDetails = period.serviceItems.length > 0

                return (
                  <Fragment key={period.periodBegin}>
                    <tr
                      className={`${period.pendingPayout > 0 ? 'fin-row-pending' : ''} ${
                        hasDetails ? 'fin-row-clickable' : ''
                      }`}
                      onClick={() => hasDetails && setExpanded(isOpen ? null : period.periodBegin)}
                    >
                      <td>
                        {hasDetails && <span className="fin-caret">{isOpen ? '▾' : '▸'}</span>}
                        {period.label}
                      </td>
                      <td className="fin-num">{money(period.ordersAmount, currency)}</td>
                      <td className="fin-num fin-negative">−{money(period.commission, currency)}</td>
                      <td className="fin-num fin-negative">−{money(period.logistics, currency)}</td>
                      <td className="fin-num fin-negative">−{money(period.services, currency)}</td>
                      <td className="fin-num fin-total">{money(period.endBalance, currency)}</td>
                    </tr>

                    {isOpen && (
                      <tr className="fin-details-row">
                        <td colSpan={6}>
                          <div className="fin-details">
                            {/* Структура как в кабинете Ozon: группы с долей от продаж,
                                затем расшифровка услуг, внизу итог за период. */}
                            <div className="fin-group fin-group-plus">
                              <span>Продажи</span>
                              <b>{money(period.ordersAmount, currency)}</b>
                            </div>

                            {period.returnsAmount !== 0 && (
                              <div className="fin-group">
                                <span>Возвраты</span>
                                <b>{money(period.returnsAmount, currency)}</b>
                              </div>
                            )}

                            <div className="fin-group">
                              <span>Вознаграждение Ozon</span>
                              <b className="fin-negative">
                                −{money(period.commission, currency)}
                                <i>{share(period.commission, period.ordersAmount)}</i>
                              </b>
                            </div>

                            <div className="fin-group">
                              <span>Услуги доставки</span>
                              <b className="fin-negative">
                                −{money(period.logistics, currency)}
                                <i>{share(period.logistics, period.ordersAmount)}</i>
                              </b>
                            </div>

                            <div className="fin-group">
                              <span>Услуги и продвижение</span>
                              <b className="fin-negative">
                                −{money(period.services, currency)}
                                <i>{share(period.services, period.ordersAmount)}</i>
                              </b>
                            </div>

                            {period.serviceItems.length > 0 && (
                              <div className="fin-group-items">
                                {period.serviceItems.map((item, index) => (
                                  <div className="fin-group-item" key={`${item.name}-${index}`}>
                                    <span>{item.name}</span>
                                    <b className={item.amount < 0 ? 'fin-negative' : 'fin-positive'}>
                                      {item.amount < 0 ? '−' : '+'}
                                      {money(Math.abs(item.amount), currency)}
                                    </b>
                                  </div>
                                ))}
                              </div>
                            )}

                            <div className="fin-group fin-group-total">
                              <span>Всего за период</span>
                              <b>
                                {money(
                                  period.ordersAmount +
                                    period.returnsAmount -
                                    period.commission -
                                    period.logistics -
                                    period.services,
                                  currency,
                                )}
                              </b>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </details>

      <p className="fin-note">
        Ozon считает недельными периодами и переводит деньги по средам. Плановой даты в API нет —
        она вычисляется как первая среда после конца периода, в котором Ozon выставил документ.
        Если даты разойдутся с кабинетом, поправьте задержку в настройках калькулятора.
      </p>
    </div>
  )
}
