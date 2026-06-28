import type { KzMarketplace } from '../../../shopRegion'
import {
  getKzMarketplaceLabel,
  getKzTaskType,
  getNovinkaMarketplaceLabel,
  isKzMarketplaceTaskType,
  resolveKzMarketplaceFromTaskType,
  resolveNovinkaMarketplace,
  resolveNovinkaMarketplaceFromNotes,
} from '../../../shopRegion'
import type { ProductionFile, ProductionTask } from '../../../domain/types/production'
import {
  getProductionFilesForTaskItem,
  resolveNovinkaMarketplaceForFileGroup,
} from './catalogUtils'
import { getProductionTaskItems, isNovinkaTask } from './taskUtils'

export function resolveNovinkaMarketplaceForTask(
  task: ProductionTask,
  productionFiles: ProductionFile[] = [],
) {
  if (!isNovinkaTask(task)) {
    return null
  }

  const items = getProductionTaskItems(task)

  for (const item of items) {
    const fromLinkTag = resolveNovinkaMarketplaceFromNotes(item.productLink)
    if (fromLinkTag) {
      return fromLinkTag
    }
  }

  for (const item of items) {
    const fromUrl = resolveNovinkaMarketplace(item.productLink, '')
    if (fromUrl !== 'ozon') {
      return fromUrl
    }
  }

  for (const item of items) {
    const files = getProductionFilesForTaskItem(item, productionFiles)
    if (files.length > 0) {
      return resolveNovinkaMarketplaceForFileGroup(files)
    }
  }

  return null
}

export function matchesKzProductionMarketplace(
  task: ProductionTask,
  marketplace: KzMarketplace,
  productionFiles: ProductionFile[] = [],
) {
  if (isNovinkaTask(task)) {
    const resolved = resolveNovinkaMarketplaceForTask(task, productionFiles)
    if (resolved === null) {
      return false
    }

    return resolved === marketplace
  }

  return task.taskType === getKzTaskType(marketplace)
}

export function getProductionTaskTypeLabel(task: ProductionTask, productionFiles: ProductionFile[] = []) {
  if (isKzMarketplaceTaskType(task.taskType ?? 'Ozon')) {
    return getKzMarketplaceLabel(resolveKzMarketplaceFromTaskType(task.taskType))
  }

  if (!isNovinkaTask(task)) {
    return 'Ozon'
  }

  const marketplace = resolveNovinkaMarketplaceForTask(task, productionFiles)
  if (marketplace && marketplace !== 'ozon') {
    return `Новинка · ${getNovinkaMarketplaceLabel(marketplace)}`
  }

  return 'Новинка'
}
