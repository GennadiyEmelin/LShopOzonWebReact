import type { KzMarketplace } from './shopRegion'
import { getKzMarketplaceLabel } from './shopRegion'

export type KzIntegrationSettings = {
  configured: boolean
  merchantIdMasked: string
  apiKeyMasked: string
  hasStoredMerchantId: boolean
  hasStoredApiKey: boolean
  updatedAt: string | null
  marketplaceLabel: string
}

type RegionSwitcherProps = {
  shopRegion: 'rf' | 'kz'
  onChange: (region: 'rf' | 'kz') => void
}

export function RegionSwitcher({ shopRegion, onChange }: RegionSwitcherProps) {
  return (
    <div
      className="region-switcher"
      role="group"
      aria-label="Регион магазина"
      data-region={shopRegion}
    >
      <div className="region-switcher-thumb" aria-hidden="true" />
      <button
        type="button"
        className={shopRegion === 'rf' ? 'active' : ''}
        aria-pressed={shopRegion === 'rf'}
        onClick={() => onChange('rf')}
      >
        LShop РФ
      </button>
      <button
        type="button"
        className={shopRegion === 'kz' ? 'active' : ''}
        aria-pressed={shopRegion === 'kz'}
        onClick={() => onChange('kz')}
      >
        LShop KZ
      </button>
    </div>
  )
}

type KzMarketplaceTabsProps = {
  activeMarketplace: KzMarketplace
  onChange: (marketplace: KzMarketplace) => void
  className?: string
}

export function KzMarketplaceTabs({ activeMarketplace, onChange, className = '' }: KzMarketplaceTabsProps) {
  const marketplaces: KzMarketplace[] = ['kaspi', 'satu', 'halyk']

  return (
    <div className={`inner-tabs kz-marketplace-tabs ${className}`.trim()}>
      {marketplaces.map((marketplace) => (
        <button
          key={marketplace}
          type="button"
          className={activeMarketplace === marketplace ? 'active' : ''}
          onClick={() => onChange(marketplace)}
        >
          {getKzMarketplaceLabel(marketplace)}
        </button>
      ))}
    </div>
  )
}

function getIntegrationStatusClass(status: string) {
  if (!status) {
    return ''
  }

  const normalized = status.toLowerCase()
  if (
    normalized.includes('ошиб') ||
    normalized.includes('не удал') ||
    normalized.includes('invalid') ||
    normalized.includes('не json')
  ) {
    return 'integration-status-error'
  }

  if (
    normalized.includes('отвечает') ||
    normalized.includes('сохранен') ||
    normalized.includes('настроен')
  ) {
    return 'integration-status-ok'
  }

  return ''
}

function getMerchantIdLabel(marketplace: KzMarketplace) {
  switch (marketplace) {
    case 'satu':
      return 'ID магазина'
    case 'kaspi':
      return 'Merchant ID'
    default:
      return 'ID магазина'
  }
}

type KzIntegrationCardProps = {
  marketplace: KzMarketplace
  settings: KzIntegrationSettings | null
  merchantId: string
  apiKey: string
  status: string
  saving: boolean
  canEdit: boolean
  embedded?: boolean
  onMerchantIdChange: (value: string) => void
  onApiKeyChange: (value: string) => void
  onSave: () => void
  onTest: () => void
}

export function KzIntegrationCard({
  marketplace,
  settings,
  merchantId,
  apiKey,
  status,
  saving,
  canEdit,
  embedded = false,
  onMerchantIdChange,
  onApiKeyChange,
  onSave,
  onTest,
}: KzIntegrationCardProps) {
  const label = getKzMarketplaceLabel(marketplace)
  const merchantIdLabel = getMerchantIdLabel(marketplace)
  const statusClass = getIntegrationStatusClass(status)

  return (
    <div className={embedded ? 'integration-card-body' : 'integration-card'}>
      {!embedded && (
        <div className="integration-card-head">
          <div>
            <h3>{label} API</h3>
            <p className={statusClass || undefined}>{status || 'ID и API Key хранятся в базе данных'}</p>
          </div>
          <span className={`integration-badge ${settings?.configured ? 'ok' : 'warn'}`}>
            {settings?.configured ? 'Настроено' : 'Не настроено'}
          </span>
        </div>
      )}

      {embedded && status && (
        <p className={`integration-hint ${statusClass}`.trim()}>{status}</p>
      )}

      {settings && (
        <div className="integration-meta">
          <small>{merchantIdLabel}: {settings.merchantIdMasked || '—'}</small>
          <small>API Key: {settings.apiKeyMasked || '—'}</small>
          {settings.updatedAt && <small>Обновлено: {settings.updatedAt}</small>}
        </div>
      )}

      <div className="integration-form-grid integration-form-grid-2">
        <label>
          <span>{merchantIdLabel}</span>
          <input
            type="text"
            value={merchantId}
            disabled={!canEdit}
            onChange={(event) => onMerchantIdChange(event.target.value)}
            placeholder={settings?.hasStoredMerchantId ? 'Оставьте пустым, чтобы не менять' : `Введите ${merchantIdLabel} ${label}`}
            autoComplete="off"
          />
        </label>
        <label>
          <span>API Key / Token</span>
          <input
            type="password"
            value={apiKey}
            disabled={!canEdit}
            onChange={(event) => onApiKeyChange(event.target.value)}
            placeholder={settings?.hasStoredApiKey ? 'Оставьте пустым, чтобы не менять' : `Введите API Key ${label}`}
            autoComplete="off"
          />
        </label>
      </div>

      {marketplace === 'satu' && (
        <p className="integration-hint">
          Satu API: <code>https://my.satu.kz/api/v1/</code> · авторизация Bearer token из кабинета продавца.
        </p>
      )}

      <div className="integration-actions">
        {canEdit && (
          <button type="button" className="header-action" disabled={saving} onClick={onSave}>
            {saving ? 'Сохранение...' : `Сохранить ${label}`}
          </button>
        )}
        <button type="button" className="header-action secondary" onClick={onTest}>
          Проверить подключение
        </button>
      </div>
    </div>
  )
}
