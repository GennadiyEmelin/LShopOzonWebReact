import { formatMoney, formatPercent } from '../lib/calculatorFormulas'
import type { CalculationResult } from '../types'

type CalculationBreakdownProps = {
  result: CalculationResult
  /** Показывать вилку логистики: два сценария вместо одного. */
  showRange: boolean
  /** Символ валюты магазина: ₸ для Казахстана, ₽ для России. */
  currency: string
}

/**
 * Разложение цены по статьям расходов.
 * Каждая строка подписана источником — чтобы не гадать, откуда взялась цифра.
 */
export function CalculationBreakdown({ result, showRange, currency }: CalculationBreakdownProps) {
  const scenario = result.worst
  const hasRange = showRange && result.worst.profit !== result.best.profit

  return (
    <div className="calc-breakdown">
      <div className="calc-breakdown-row calc-breakdown-price">
        <span className="calc-breakdown-label">Цена продажи</span>
        <span className="calc-breakdown-amount">{formatMoney(result.price, currency)}</span>
        <span className="calc-breakdown-source" />
      </div>

      {scenario.lines.map((line) => (
        <div className="calc-breakdown-row" key={line.key}>
          <span className="calc-breakdown-label">{line.label}</span>
          <span className="calc-breakdown-amount calc-negative">{formatMoney(line.amount, currency)}</span>
          <span className="calc-breakdown-source" title={`Источник: ${line.source}`}>
            {line.source}
          </span>
        </div>
      ))}

      <div className="calc-breakdown-row calc-breakdown-payout">
        <span className="calc-breakdown-label">Выплата от Ozon</span>
        <span className="calc-breakdown-amount">{formatMoney(scenario.ozonPayout, currency)}</span>
        <span className="calc-breakdown-source" />
      </div>

      <div
        className={`calc-breakdown-row calc-breakdown-total ${
          scenario.profit >= 0 ? 'calc-profit' : 'calc-loss'
        }`}
      >
        <span className="calc-breakdown-label">Чистая прибыль</span>
        <span className="calc-breakdown-amount">
          {hasRange
            ? `${formatMoney(scenario.profit, currency)} — ${formatMoney(result.best.profit, currency)}`
            : formatMoney(scenario.profit, currency)}
        </span>
        <span className="calc-breakdown-source">
          {hasRange ? 'вилка логистики Ozon' : ''}
        </span>
      </div>

      <div className="calc-metrics">
        <div className="calc-metric">
          <span>Маржа</span>
          <strong className={scenario.marginPercent >= 0 ? 'calc-profit' : 'calc-loss'}>
            {hasRange
              ? `${formatPercent(scenario.marginPercent)} — ${formatPercent(result.best.marginPercent)}`
              : formatPercent(scenario.marginPercent)}
          </strong>
        </div>
        <div className="calc-metric">
          <span>ROI</span>
          <strong className={scenario.roiPercent >= 0 ? 'calc-profit' : 'calc-loss'}>
            {scenario.roiPercent === 0 ? '—' : formatPercent(scenario.roiPercent)}
          </strong>
        </div>
        <div className="calc-metric">
          <span>Точка безубыточности</span>
          <strong>
            {result.breakEvenPrice === null ? 'недостижима' : formatMoney(result.breakEvenPrice, currency)}
          </strong>
        </div>
      </div>

      {result.warnings.length > 0 && (
        <ul className="calc-warnings">
          {result.warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
