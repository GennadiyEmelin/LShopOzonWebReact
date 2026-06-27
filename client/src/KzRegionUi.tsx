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

type KzIntegrationCardProps = {
  marketplace: KzMarketplace
  settings: KzIntegrationSettings | null
  merchantId: string
  apiKey: string
  status: string
  saving: boolean
  canEdit: boolean
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
  onMerchantIdChange,
  onApiKeyChange,
  onSave,
  onTest,
}: KzIntegrationCardProps) {
  const label = getKzMarketplaceLabel(marketplace)

  return (
    <article className="integration-card">
      <div className="integration-card-head">
        <div>
          <h3>{label} API</h3>
          <p>{status || 'ID и API Key хранятся в базе данных'}</p>
        </div>
        <span className={`integration-badge ${settings?.configured ? 'ok' : 'warn'}`}>
          {settings?.configured ? 'Настроено' : 'Не настроено'}
        </span>
      </div>

      {settings && (
        <div className="integration-meta">
          <small>ID: {settings.merchantIdMasked || '—'}</small>
          <small>API Key: {settings.apiKeyMasked || '—'}</small>
          {settings.updatedAt && <small>Обновлено: {settings.updatedAt}</small>}
        </div>
      )}

      <div className="integration-form-grid">
        <label>
          <span>ID</span>
          <input
            type="text"
            value={merchantId}
            disabled={!canEdit}
            onChange={(event) => onMerchantIdChange(event.target.value)}
            placeholder={settings?.hasStoredMerchantId ? 'Оставьте пустым, чтобы не менять' : `Введите ID ${label}`}
            autoComplete="off"
          />
        </label>
        <label>
          <span>API Key</span>
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

      <div className="integration-actions">
        {canEdit && (
          <button type="button" disabled={saving} onClick={onSave}>
            {saving ? 'Сохранение...' : 'Сохранить'}
          </button>
        )}
        <button type="button" className="secondary" onClick={onTest}>
          Проверить подключение
        </button>
      </div>
    </article>
  )
}
