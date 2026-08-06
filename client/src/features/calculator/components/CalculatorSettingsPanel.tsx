import type { CalculatorSettings, CalculatorTaxMode } from '../types'

type CalculatorSettingsPanelProps = {
  settings: CalculatorSettings
  canEdit: boolean
  saving: boolean
  status: string
  onChange: (settings: CalculatorSettings) => void
  onSave: () => void
  onClose: () => void
  currency: string
}

const payoutDays = [
  { value: 1, label: 'понедельник' },
  { value: 2, label: 'вторник' },
  { value: 3, label: 'среда' },
  { value: 4, label: 'четверг' },
  { value: 5, label: 'пятница' },
]

const taxModes: { value: CalculatorTaxMode; label: string }[] = [
  { value: 'usn_income', label: 'УСН «Доходы» — налог с оборота' },
  { value: 'usn_income_minus_expenses', label: 'УСН «Доходы минус расходы»' },
  { value: 'none', label: 'Не учитывать налог' },
]

export function CalculatorSettingsPanel({
  settings,
  canEdit,
  saving,
  status,
  onChange,
  onSave,
  onClose,
  currency,
}: CalculatorSettingsPanelProps) {
  const update = (patch: Partial<CalculatorSettings>) => onChange({ ...settings, ...patch })

  return (
    <div className="calc-settings">
      <div className="calc-settings-head">
        <h3>Настройки расчёта</h3>
        <p>То, чего Ozon не отдаёт по API. Комиссии и логистика подтягиваются автоматически.</p>
      </div>

      <div className="calc-settings-grid">
        <label>
          <span>Эквайринг, %</span>
          <input
            type="number"
            step="0.1"
            min="0"
            max="100"
            value={settings.acquiringPercent}
            disabled={!canEdit}
            onChange={(event) => update({ acquiringPercent: Number(event.target.value) })}
          />
        </label>

        <label>
          <span>Налоговый режим</span>
          <select
            value={settings.taxMode}
            disabled={!canEdit}
            onChange={(event) => update({ taxMode: event.target.value as CalculatorTaxMode })}
          >
            {taxModes.map((mode) => (
              <option key={mode.value} value={mode.value}>
                {mode.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Налог, %</span>
          <input
            type="number"
            step="0.1"
            min="0"
            max="100"
            value={settings.taxPercent}
            disabled={!canEdit || settings.taxMode === 'none'}
            onChange={(event) => update({ taxPercent: Number(event.target.value) })}
          />
        </label>

        <label>
          <span>Процент выкупа, %</span>
          <input
            type="number"
            step="1"
            min="0"
            max="100"
            value={settings.buyoutRatePercent}
            disabled={!canEdit}
            onChange={(event) => update({ buyoutRatePercent: Number(event.target.value) })}
          />
          <small>Обратная логистика платится по невыкупленным заказам</small>
        </label>

        <label>
          <span>Реклама, %</span>
          <input
            type="number"
            step="0.1"
            min="0"
            value={settings.advertisingPercent}
            disabled={!canEdit}
            onChange={(event) => update({ advertisingPercent: Number(event.target.value) })}
          />
        </label>

        <label>
          <span>Прочие расходы на единицу</span>
          <input
            type="number"
            step="1"
            min="0"
            value={settings.extraCostFixed}
            disabled={!canEdit}
            onChange={(event) => update({ extraCostFixed: Number(event.target.value) })}
          />
        </label>

        <label>
          <span>Логистика: база, {currency}</span>
          <input
            type="number"
            step="1"
            min="0"
            value={settings.logisticsBaseAmount}
            disabled={!canEdit}
            onChange={(event) => update({ logisticsBaseAmount: Number(event.target.value) })}
          />
          <small>Только для ручного режима</small>
        </label>

        <label>
          <span>Логистика: за литр, {currency}</span>
          <input
            type="number"
            step="1"
            min="0"
            value={settings.logisticsRatePerLiter}
            disabled={!canEdit}
            onChange={(event) => update({ logisticsRatePerLiter: Number(event.target.value) })}
          />
          <small>Только для ручного режима</small>
        </label>
      </div>

      <div className="calc-settings-head" style={{ marginTop: 18 }}>
        <h3>График выплат</h3>
        <p>
          Ozon не отдаёт плановую дату по API, а графики у кабинетов разные.
          В РФ стандартный — среда через 3 недели после конца недельного периода.
        </p>
      </div>

      <div className="calc-settings-grid">
        <label>
          <span>Задержка выплаты, недель</span>
          <input
            type="number"
            step="1"
            min="0"
            max="12"
            value={settings.payoutDelayWeeks}
            disabled={!canEdit}
            onChange={(event) => update({ payoutDelayWeeks: Number(event.target.value) })}
          />
          <small>Считается от конца недельного периода</small>
        </label>

        <label>
          <span>День выплаты</span>
          <select
            value={settings.payoutDayOfWeek}
            disabled={!canEdit}
            onChange={(event) => update({ payoutDayOfWeek: Number(event.target.value) })}
          >
            {payoutDays.map((day) => (
              <option key={day.value} value={day.value}>
                {day.label}
              </option>
            ))}
          </select>
          <small>Если даты разъезжаются с кабинетом — поправьте здесь</small>
        </label>
      </div>

      <div className="calc-settings-actions">
        {status && <span className="calc-settings-status">{status}</span>}
        <button type="button" className="secondary" onClick={onClose}>
          Закрыть
        </button>
        {canEdit && (
          <button type="button" onClick={onSave} disabled={saving}>
            {saving ? 'Сохраняю…' : 'Сохранить'}
          </button>
        )}
      </div>
    </div>
  )
}
