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

  return (
    <div className="fin-panel">
      <div className="fin-summary">
        <div className="fin-card fin-card-pending">
          <span>Ожидается к выплате</span>
          <strong>{money(report.pendingTotal, currency)}</strong>
          <small>начислено, но ещё не перечислено</small>
        </div>

        <div className="fin-card fin-card-paid">
          <span>Выплачено за период</span>
          <strong>{money(report.paidTotal, currency)}</strong>
          <small>фактически пришло на счёт</small>
        </div>

        <div className="fin-card">
          <span>Баланс на конец</span>
          <strong>
            {report.currentBalance === null ? '—' : money(report.currentBalance, currency)}
          </strong>
          <small>по последнему периоду</small>
        </div>
      </div>

      <div className="fin-table-wrap">
        <table className="fin-table">
          <thead>
            <tr>
              <th>Период</th>
              <th className="fin-num">Продажи</th>
              <th className="fin-num">Комиссия</th>
              <th className="fin-num">Логистика</th>
              <th className="fin-num">Услуги</th>
              <th className="fin-num">Выплачено</th>
              <th className="fin-num">К выплате</th>
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
                    <td className="fin-num">
                      {period.paidOut > 0 ? (
                        <span className="fin-badge fin-badge-paid">
                          {money(period.paidOut, currency)}
                        </span>
                      ) : (
                        <span className="fin-dash">—</span>
                      )}
                    </td>
                    <td className="fin-num">
                      {period.pendingPayout > 0 ? (
                        <span className="fin-badge fin-badge-pending">
                          {money(period.pendingPayout, currency)}
                        </span>
                      ) : (
                        <span className="fin-dash">—</span>
                      )}
                    </td>
                    <td className="fin-num fin-total">{money(period.endBalance, currency)}</td>
                  </tr>

                  {isOpen && (
                    <tr className="fin-details-row">
                      <td colSpan={8}>
                        <div className="fin-details">
                          {period.serviceItems.map((item, index) => (
                            <div className="fin-details-item" key={`${item.name}-${index}`}>
                              <span>{item.name}</span>
                              <strong className={item.amount < 0 ? 'fin-negative' : 'fin-positive'}>
                                {item.amount < 0 ? '−' : '+'}
                                {money(Math.abs(item.amount), currency)}
                              </strong>
                            </div>
                          ))}
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

      <p className="fin-note">
        Периоды приходят из Ozon как есть — недельные, с отдельным разрезом на границе месяца.
        «К выплате» — сумма, которую Ozon начислил, но ещё не перечислил; она закрывает предыдущие
        периоды и приходит примерно через неделю. «Выплачено» — деньги, фактически ушедшие на счёт
        в этом периоде. Строки с раскрытием показывают, за что именно списаны услуги.
      </p>
    </div>
  )
}
