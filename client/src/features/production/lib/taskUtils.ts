import type {
  DraftTaskItem,
  ProductionTask,
  ProductionTaskItem,
  ProductionTaskStatus,
} from '../../../domain/types/production'

export type ActiveTaskProductConflict = {
  taskId: string
  status: ProductionTaskStatus
  quantity: number
}

export function matchesProductionCatalogProduct(
  left: { ozonProductId?: number; productId?: number; offerId?: string },
  right: { ozonProductId?: number; productId?: number; offerId?: string },
) {
  const leftProductId = left.ozonProductId ?? left.productId ?? 0
  const rightProductId = right.ozonProductId ?? right.productId ?? 0
  const leftOfferId = (left.offerId ?? '').trim().toLowerCase()
  const rightOfferId = (right.offerId ?? '').trim().toLowerCase()

  if (leftProductId > 0 && rightProductId > 0 && leftProductId === rightProductId) {
    return true
  }

  return leftOfferId !== '' && leftOfferId === rightOfferId
}

export function findProductInActiveProductionTasks(
  tasks: ProductionTask[],
  product: { ozonProductId?: number; productId?: number; offerId?: string },
  options?: { excludeTaskId?: string | null },
): ActiveTaskProductConflict[] {
  const conflicts: ActiveTaskProductConflict[] = []

  for (const task of tasks) {
    if (task.isArchived || (task.status !== 'New' && task.status !== 'InProgress')) {
      continue
    }

    if (options?.excludeTaskId && task.id === options.excludeTaskId) {
      continue
    }

    for (const item of getProductionTaskItems(task)) {
      if (!matchesProductionCatalogProduct(product, item)) {
        continue
      }

      conflicts.push({
        taskId: task.id,
        status: task.status,
        quantity: item.requiredQuantity,
      })
    }
  }

  return conflicts
}

export function formatProductTaskSelectionHint(
  draftItems: DraftTaskItem[],
  activeConflicts: ActiveTaskProductConflict[],
  product: { ozonProductId?: number; productId?: number; offerId?: string },
) {
  const lines: string[] = []
  const draftItem = draftItems.find((item) => matchesProductionCatalogProduct(item, product))

  if (draftItem) {
    lines.push(`Уже добавлен в эту задачу: ${draftItem.requiredQuantity} шт.`)
  }

  for (const conflict of activeConflicts) {
    const statusLabel = conflict.status === 'InProgress' ? 'в работе' : 'созданной'
    lines.push(`Уже в ${statusLabel} задаче: ${conflict.quantity} шт.`)
  }

  return lines.join(' · ')
}

export function getProductionTaskTableMode(
  tasks: ProductionTask[],
  whenEmpty: 'ozon' | 'novinka' | 'mixed' = 'ozon',
) {
  if (tasks.length === 0) {
    return whenEmpty
  }

  if (tasks.every((task) => isNovinkaTask(task))) {
    return 'novinka' as const
  }

  if (tasks.every((task) => !isNovinkaTask(task))) {
    return 'ozon' as const
  }

  return 'mixed' as const
}

export function getProductionTaskTableLabels(tableMode: ReturnType<typeof getProductionTaskTableMode>) {
  const showQuantityColumns = tableMode === 'ozon' || tableMode === 'mixed'
  const showTypeColumn = tableMode === 'ozon' || tableMode === 'mixed'

  return {
    showQuantityColumns,
    showTypeColumn,
    skuHeaderLabel:
      tableMode === 'novinka' ? 'Ссылка' : tableMode === 'mixed' ? 'Артикул / Ссылка' : 'Артикул',
    neededHeaderLabel: tableMode === 'mixed' ? 'План' : 'Нужно',
  }
}

export function getProductionTaskItems(task: ProductionTask) {
  if (task.items?.length) {
    return task.items
  }

  return [{
    id: task.id,
    ozonProductId: task.ozonProductId,
    offerId: task.offerId,
    productName: task.productName,
    requiredQuantity: task.requiredQuantity,
    actualQuantity: task.actualQuantity,
    enforceMinimumQuantity: false,
  }]
}

export function isNovinkaTask(task: ProductionTask) {
  if (task.taskType === 'Novinka') {
    return true
  }

  if (task.taskType === 'Ozon') {
    return false
  }

  return getProductionTaskItems(task).some(
    (item: ProductionTaskItem) =>
      item.ozonProductId <= 0 &&
      (item.offerId.startsWith('NV-') || Boolean(item.productLink?.trim())),
  )
}

export function toDatetimeLocalValue(value?: string) {
  if (!value) {
    return ''
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ''
  }

  const offset = date.getTimezoneOffset()
  const local = new Date(date.getTime() - offset * 60000)
  return local.toISOString().slice(0, 16)
}

export function fromDatetimeLocalValue(value: string) {
  if (!value.trim()) {
    return undefined
  }

  return new Date(value).toISOString()
}

export function getProductionTaskRequiredTotal(task: ProductionTask) {
  return getProductionTaskItems(task).reduce((sum: number, item: ProductionTaskItem) => sum + item.requiredQuantity, 0)
}

export function getProductionTaskActualTotal(task: ProductionTask) {
  return getProductionTaskItems(task).reduce((sum: number, item: ProductionTaskItem) => sum + (item.actualQuantity ?? 0), 0)
}

export function sortProductionTasksByUrgency(tasks: ProductionTask[]) {
  return [...tasks].sort((left, right) => {
    if (left.isUrgent !== right.isUrgent) {
      return left.isUrgent ? -1 : 1
    }

    return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
  })
}

export function translateProductionTaskStatus(status: ProductionTask['status'], isUrgent = false) {
  const statuses: Record<ProductionTask['status'], string> = {
    New: isUrgent ? 'Срочно' : 'Новая',
    InProgress: 'В работе',
    Cancelled: 'Отменена',
    Completed: 'Выполнено',
  }

  return statuses[status] ?? status
}

export function getProductionTaskSummary(task: ProductionTask) {
  const items = getProductionTaskItems(task)
  return items.length === 1 ? items[0].productName : `${items.length} товаров в задаче`
}
