import type { NovinkaMarketplace } from '../../../shopRegion'
import {
  resolveNovinkaMarketplace,
  resolveNovinkaMarketplaceFromNotes,
} from '../../../shopRegion'
import type {
  ProductionCatalogItem,
  ProductionFile,
  ProductionFilePath,
  ProductionTask,
  ProductionTaskItem,
} from '../../../domain/types/production'
import { getProductionTaskItems } from './taskUtils'

export type SupplyCatalogSource = {
  isArchived: boolean
  sentAt?: string
  createdAt: string
  items: Array<{
    id: string
    isReserve: boolean
    offerId: string
    productName: string
  }>
}

export function isNovinkaProductionFile(file: ProductionFile) {
  return (
    file.offerId.startsWith('NV-') ||
    (Boolean(file.productLink?.trim()) && !file.ozonProductId)
  )
}

export function getNovinkaCatalogKey(file: ProductionFile) {
  const name = file.productName.trim().toLowerCase()
  const link = file.productLink?.trim().toLowerCase() ?? ''
  if (link) {
    return `${name}|${link}`
  }

  if (file.offerId.trim()) {
    return file.offerId.trim().toUpperCase()
  }

  return name
}

export function filterNovinkaCatalogByMarketplace(
  items: ProductionCatalogItem[],
  marketplace: NovinkaMarketplace,
) {
  return items.filter((item) => (item.marketplace ?? 'ozon') === marketplace)
}

export function resolveNovinkaMarketplaceForFileGroup(files: ProductionFile[]): NovinkaMarketplace {
  for (const file of files) {
    const fromNotes = resolveNovinkaMarketplaceFromNotes(file.notes)
    if (fromNotes) {
      return fromNotes
    }
  }

  const latest = files.reduce((left, right) =>
    new Date(left.createdAt).getTime() >= new Date(right.createdAt).getTime() ? left : right,
  )

  return resolveNovinkaMarketplace(latest.productLink, latest.notes)
}

function getSupplyReserveOfferId(item: SupplyCatalogSource['items'][number]) {
  const trimmed = item.offerId?.trim()
  if (trimmed) {
    return trimmed
  }

  return `NV-${item.id.replace(/-/g, '')}`
}

export function buildNovinkaCatalogFromSupplyReserves(supplies: SupplyCatalogSource[]): ProductionCatalogItem[] {
  const seen = new Set<string>()
  const items: ProductionCatalogItem[] = []

  for (const supply of supplies) {
    if (supply.isArchived) {
      continue
    }

    for (const item of supply.items) {
      if (!item.isReserve) {
        continue
      }

      const offerId = getSupplyReserveOfferId(item)
      const key = offerId.toUpperCase()
      if (seen.has(key)) {
        continue
      }

      seen.add(key)
      items.push({
        offerId,
        productName: item.productName,
        productLink: '',
        fileCount: 0,
        completedAt: supply.sentAt ?? supply.createdAt,
        marketplace: 'ozon',
      })
    }
  }

  return items.sort((left, right) => left.productName.localeCompare(right.productName, 'ru'))
}

export function mergeNovinkaCatalogItems(
  fromFiles: ProductionCatalogItem[],
  fromSupplies: ProductionCatalogItem[],
): ProductionCatalogItem[] {
  const byOfferId = new Map<string, ProductionCatalogItem>()

  for (const item of fromFiles) {
    byOfferId.set(item.offerId.toUpperCase(), item)
  }

  for (const item of fromSupplies) {
    const key = item.offerId.toUpperCase()
    if (!byOfferId.has(key)) {
      byOfferId.set(key, item)
    }
  }

  return [...byOfferId.values()].sort((left, right) => left.productName.localeCompare(right.productName, 'ru'))
}

export function buildNovinkaCatalogFromFiles(files: ProductionFile[]): ProductionCatalogItem[] {
  const groups = new Map<string, ProductionFile[]>()

  for (const file of files.filter(isNovinkaProductionFile)) {
    const key = getNovinkaCatalogKey(file)
    const bucket = groups.get(key) ?? []
    bucket.push(file)
    groups.set(key, bucket)
  }

  return [...groups.values()]
    .map((group) => {
      const latest = group.reduce((left, right) =>
        new Date(left.createdAt).getTime() >= new Date(right.createdAt).getTime() ? left : right,
      )
      const latestCreatedAt = group.reduce((max, file) =>
        new Date(file.createdAt).getTime() > new Date(max).getTime() ? file.createdAt : max,
      group[0].createdAt)

      return {
        offerId: latest.offerId,
        ozonProductId: latest.ozonProductId || undefined,
        productName: latest.productName,
        productLink: latest.productLink ?? '',
        fileCount: group.length,
        completedAt: latestCreatedAt,
        marketplace: resolveNovinkaMarketplaceForFileGroup(group),
      }
    })
    .sort((left, right) => left.productName.localeCompare(right.productName, 'ru'))
}

export function getProductionFilesForCatalogItem(
  item: ProductionCatalogItem,
  files: ProductionFile[],
) {
  return files.filter(
    (file) =>
      (item.offerId && file.offerId === item.offerId) ||
      (item.ozonProductId && file.ozonProductId === item.ozonProductId) ||
      (item.productLink && file.productLink === item.productLink) ||
      (item.productName &&
        file.productName === item.productName &&
        item.offerId?.startsWith('NV-')),
  )
}

function toProductionCatalogItem(item: ProductionTaskItem): ProductionCatalogItem {
  return {
    offerId: item.offerId,
    ozonProductId: item.ozonProductId > 0 ? item.ozonProductId : undefined,
    productName: item.productName,
    productLink: item.productLink ?? '',
    fileCount: 0,
  }
}

export function getProductionPathsForTaskItem(
  item: ProductionTaskItem,
  paths: ProductionFilePath[],
): ProductionFilePath[] {
  const catalogPaths = getProductionPathsForCatalogItem(toProductionCatalogItem(item), paths)
  const itemPath = item.filePath?.trim()
  if (!itemPath) {
    return catalogPaths
  }

  if (catalogPaths.some((entry) => entry.path === itemPath)) {
    return catalogPaths
  }

  return [
    {
      id: `item-${item.id}`,
      offerId: item.offerId,
      ozonProductId: item.ozonProductId > 0 ? item.ozonProductId : undefined,
      productName: item.productName,
      productLink: item.productLink ?? '',
      path: itemPath,
      createdAt: '',
    },
    ...catalogPaths,
  ]
}

export function getProductionFilesForTaskItem(
  item: { offerId: string; ozonProductId: number; productLink?: string; productName?: string },
  files: ProductionFile[],
) {
  return files.filter(
    (file) =>
      (item.offerId && file.offerId === item.offerId) ||
      (item.ozonProductId > 0 && file.ozonProductId === item.ozonProductId) ||
      (item.productLink && file.productLink === item.productLink) ||
      (item.productName && file.productName === item.productName && item.offerId?.startsWith('NV-')),
  )
}

export function getProductionPathsForCatalogItem(
  item: ProductionCatalogItem,
  paths: ProductionFilePath[],
) {
  return paths.filter((path) => pathsMatchProductionItem(path, item))
}

export function pathsMatchProductionItem(
  path: ProductionFilePath,
  item: {
    offerId?: string
    ozonProductId?: number
    productLink?: string
    productName?: string
  },
) {
  if (
    item.offerId &&
    path.offerId &&
    path.offerId.localeCompare(item.offerId, undefined, { sensitivity: 'accent' }) === 0
  ) {
    return true
  }

  if (item.ozonProductId && path.ozonProductId && path.ozonProductId === item.ozonProductId) {
    return true
  }

  if (
    item.productLink &&
    path.productLink &&
    path.productLink.trim().toLowerCase() === item.productLink.trim().toLowerCase()
  ) {
    return true
  }

  if (
    item.productName &&
    path.productName &&
    path.productName.trim().toLowerCase() === item.productName.trim().toLowerCase()
  ) {
    return true
  }

  return false
}

export function matchesProductionTask(task: ProductionTask, search: string) {
  return [
    task.offerId,
    task.productName,
    task.status,
    task.assignedUserName,
    task.createdByDisplayName,
    task.cancelledByDisplayName,
    task.cancellationComment,
    task.isUrgent ? 'срочно' : '',
    task.requiredQuantity,
    task.actualQuantity,
    ...getProductionTaskItems(task).flatMap((item) => [
      item.offerId,
      item.productName,
      item.productLink,
      item.requiredQuantity,
      item.actualQuantity,
    ]),
  ]
    .filter((value) => value !== undefined && value !== null)
    .some((value) => String(value).toLowerCase().includes(search))
}
