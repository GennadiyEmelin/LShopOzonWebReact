export type ShopRegion = 'rf' | 'kz'
export type KzMarketplace = 'kaspi' | 'satu' | 'halyk'

export const SHOP_REGION_STORAGE_KEY = 'lshop-shop-region'
export const KZ_MARKETPLACE_STORAGE_KEY = 'lshop-kz-marketplace'
export const KZ_MARKETPLACES: KzMarketplace[] = ['kaspi', 'satu', 'halyk']

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
  return taskType === 'Ozon'
}

export function matchesShopRegionTaskType(region: ShopRegion, taskType: string): boolean {
  if (taskType === 'Novinka') {
    return true
  }

  return region === 'rf'
    ? isRfMarketplaceTaskType(taskType)
    : isKzMarketplaceTaskType(taskType)
}
