export type ShopRegion = 'rf' | 'kz'
export type KzMarketplace = 'kaspi' | 'satu' | 'halyk'
export type NovinkaMarketplace = 'ozon' | KzMarketplace
export type NovinkaCatalogTab = `novinka-${NovinkaMarketplace}`

export const SHOP_REGION_STORAGE_KEY = 'lshop-shop-region'
export const KZ_MARKETPLACE_STORAGE_KEY = 'lshop-kz-marketplace'
export const KZ_MARKETPLACES: KzMarketplace[] = ['kaspi', 'satu', 'halyk']
export const NOVINKA_MARKETPLACES: NovinkaMarketplace[] = ['ozon', 'kaspi', 'satu', 'halyk']
export const NOVINKA_MARKETPLACE_NOTE_PREFIX = 'marketplace:'

export function readShopRegion(): ShopRegion {
  const value = localStorage.getItem(SHOP_REGION_STORAGE_KEY)
  return value === 'kz' ? 'kz' : 'rf'
}

export function readKzMarketplace(): KzMarketplace {
  const value = localStorage.getItem(KZ_MARKETPLACE_STORAGE_KEY)
  return value === 'satu' || value === 'halyk' ? value : 'kaspi'
}

export function getKzMarketplaceLabel(marketplace: KzMarketplace): string {
  switch (marketplace) {
    case 'kaspi':
      return 'Kaspi'
    case 'satu':
      return 'Satu'
    case 'halyk':
      return 'Halyk'
  }
}

export function getKzTaskType(marketplace: KzMarketplace): 'Kaspi' | 'Satu' | 'Halyk' {
  switch (marketplace) {
    case 'kaspi':
      return 'Kaspi'
    case 'satu':
      return 'Satu'
    case 'halyk':
      return 'Halyk'
  }
}

export function isKzMarketplaceTaskType(taskType: string): boolean {
  return taskType === 'Kaspi' || taskType === 'Satu' || taskType === 'Halyk'
}

export function isRfMarketplaceTaskType(taskType: string): boolean {
  return taskType === 'Ozon' || taskType === 'Packaging'
}

export function getDefaultTaskFormMode(
  region: ShopRegion,
  userRole?: string,
  kzMarketplace: KzMarketplace = 'kaspi',
): 'ozon' | 'kaspi' | 'satu' | 'halyk' {
  void userRole
  return region === 'rf' ? 'ozon' : kzMarketplace
}

export function isMarketplaceTaskFormMode(mode: string): boolean {
  return mode === 'ozon' || mode === 'kaspi' || mode === 'satu' || mode === 'halyk'
}

export function resolveKzMarketplaceFromTaskType(taskType?: string): KzMarketplace {
  if (taskType === 'Satu') {
    return 'satu'
  }

  if (taskType === 'Halyk') {
    return 'halyk'
  }

  return 'kaspi'
}

export function matchesShopRegionTaskType(region: ShopRegion, taskType: string): boolean {
  if (taskType === 'Novinka') {
    return true
  }

  return region === 'rf'
    ? isRfMarketplaceTaskType(taskType)
    : isKzMarketplaceTaskType(taskType)
}

export function formatNovinkaMarketplaceNote(marketplace: NovinkaMarketplace): string {
  return `${NOVINKA_MARKETPLACE_NOTE_PREFIX}${marketplace}`
}

export function appendNovinkaMarketplaceNote(
  existingNotes: string,
  marketplace: NovinkaMarketplace,
): string {
  const trimmed = existingNotes.trim()
  const tag = formatNovinkaMarketplaceNote(marketplace)
  if (trimmed.includes(tag)) {
    return trimmed
  }

  return trimmed ? `${trimmed}; ${tag}` : tag
}

export function resolveNovinkaMarketplaceFromNotes(notes?: string | null): NovinkaMarketplace | null {
  if (!notes) {
    return null
  }

  const match = notes.match(/marketplace:(ozon|kaspi|satu|halyk)/i)
  return match ? (match[1].toLowerCase() as NovinkaMarketplace) : null
}

export function resolveNovinkaMarketplace(productLink?: string, notes?: string | null): NovinkaMarketplace {
  const fromNotes = resolveNovinkaMarketplaceFromNotes(notes)
  if (fromNotes) {
    return fromNotes
  }

  const fromLinkTag = resolveNovinkaMarketplaceFromNotes(productLink)
  if (fromLinkTag) {
    return fromLinkTag
  }

  const link = productLink?.trim().toLowerCase() ?? ''
  if (link.includes('kaspi.kz')) {
    return 'kaspi'
  }

  if (link.includes('satu.kz')) {
    return 'satu'
  }

  if (link.includes('halykmarket') || link.includes('halykbank') || link.includes('halyk.kz')) {
    return 'halyk'
  }

  if (link.includes('ozon.')) {
    return 'ozon'
  }

  return 'ozon'
}

export function stripNovinkaMarketplaceNote(value?: string | null): string {
  if (!value) {
    return ''
  }

  return value.replace(/\s*;?\s*marketplace:(ozon|kaspi|satu|halyk)\b/gi, '').trim()
}

export function isKzNovinkaMarketplace(marketplace: NovinkaMarketplace): marketplace is KzMarketplace {
  return marketplace === 'kaspi' || marketplace === 'satu' || marketplace === 'halyk'
}

export function getNovinkaMarketplaceLabel(marketplace: NovinkaMarketplace): string {
  return marketplace === 'ozon' ? 'Ozon' : getKzMarketplaceLabel(marketplace)
}

export function toNovinkaCatalogTab(marketplace: NovinkaMarketplace): NovinkaCatalogTab {
  return `novinka-${marketplace}`
}

export function parseNovinkaCatalogTab(tab: string): NovinkaMarketplace | null {
  if (!tab.startsWith('novinka-')) {
    return null
  }

  const marketplace = tab.slice('novinka-'.length) as NovinkaMarketplace
  return NOVINKA_MARKETPLACES.includes(marketplace) ? marketplace : null
}

export function isNovinkaCatalogTab(tab: string): tab is NovinkaCatalogTab {
  return parseNovinkaCatalogTab(tab) !== null
}

export function getVisibleNovinkaMarketplaces(region: ShopRegion): NovinkaMarketplace[] {
  return region === 'rf' ? ['ozon'] : ['kaspi', 'satu', 'halyk']
}

export function getDefaultNovinkaCatalogTab(
  region: ShopRegion,
  kzMarketplace: KzMarketplace = 'kaspi',
): NovinkaCatalogTab {
  return region === 'rf' ? 'novinka-ozon' : toNovinkaCatalogTab(kzMarketplace)
}

export function resolveTaskFormNovinkaMarketplace(
  shopRegion: ShopRegion,
  taskFormMode: string,
  kzTaskMarketplace: KzMarketplace,
): NovinkaMarketplace {
  if (taskFormMode === 'kaspi' || taskFormMode === 'satu' || taskFormMode === 'halyk') {
    return taskFormMode
  }

  if (taskFormMode === 'ozon') {
    return 'ozon'
  }

  return shopRegion === 'rf' ? 'ozon' : kzTaskMarketplace
}

export function resolveNovinkaMarketplaceFromTaskType(
  taskType: string | undefined,
  shopRegion: ShopRegion,
  kzTaskMarketplace: KzMarketplace,
): NovinkaMarketplace {
  if (taskType === 'Kaspi' || taskType === 'Satu' || taskType === 'Halyk') {
    return taskType.toLowerCase() as NovinkaMarketplace
  }

  if (taskType === 'Ozon') {
    return 'ozon'
  }

  return shopRegion === 'rf' ? 'ozon' : kzTaskMarketplace
}
