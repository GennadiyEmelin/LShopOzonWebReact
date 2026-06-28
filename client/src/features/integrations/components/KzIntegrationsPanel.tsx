import { KzIntegrationCard } from '../../../KzRegionUi'
import type { KzIntegrationSettings } from '../../../KzRegionUi'
import { KzMarketplaceTabs } from '../../../KzRegionUi'
import type { KzMarketplace } from '../../../shopRegion'
import { getKzMarketplaceLabel } from '../../../shopRegion'

type KzIntegrationsPanelProps = {
  activeMarketplace: KzMarketplace
  onMarketplaceChange: (marketplace: KzMarketplace) => void
  settings: Record<KzMarketplace, KzIntegrationSettings | null>
  forms: Record<KzMarketplace, { merchantId: string; apiKey: string }>
  status: Record<KzMarketplace, string>
  saving: Record<KzMarketplace, boolean>
  canEdit: boolean
  onMerchantIdChange: (marketplace: KzMarketplace, value: string) => void
  onApiKeyChange: (marketplace: KzMarketplace, value: string) => void
  onSave: (marketplace: KzMarketplace) => void
  onTest: (marketplace: KzMarketplace) => void
}

export function KzIntegrationsPanel({
  activeMarketplace,
  onMarketplaceChange,
  settings,
  forms,
  status,
  saving,
  canEdit,
  onMerchantIdChange,
  onApiKeyChange,
  onSave,
  onTest,
}: KzIntegrationsPanelProps) {
  const label = getKzMarketplaceLabel(activeMarketplace)

  return (
    <article className="integration-card integrations-marketplace-panel">
      <div className="integration-card-head">
        <div>
          <h3>Маркетплейсы KZ</h3>
          <p>API Key и ID магазина для Kaspi, Satu и Halyk</p>
        </div>
        <span className={`integration-badge ${settings[activeMarketplace]?.configured ? 'ok' : 'warn'}`}>
          {settings[activeMarketplace]?.configured ? `${label}: настроено` : `${label}: не настроено`}
        </span>
      </div>

      <KzMarketplaceTabs activeMarketplace={activeMarketplace} onChange={onMarketplaceChange} />

      <KzIntegrationCard
        marketplace={activeMarketplace}
        settings={settings[activeMarketplace]}
        merchantId={forms[activeMarketplace].merchantId}
        apiKey={forms[activeMarketplace].apiKey}
        status={status[activeMarketplace]}
        saving={saving[activeMarketplace]}
        canEdit={canEdit}
        embedded
        onMerchantIdChange={(value) => onMerchantIdChange(activeMarketplace, value)}
        onApiKeyChange={(value) => onApiKeyChange(activeMarketplace, value)}
        onSave={() => onSave(activeMarketplace)}
        onTest={() => onTest(activeMarketplace)}
      />
    </article>
  )
}
