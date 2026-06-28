import type { NovinkaCatalogTab, NovinkaMarketplace } from '../../shopRegion'

export type ProductionFile = {
  id: string
  ozonProductId?: number
  offerId: string
  productName: string
  productLink?: string
  notes: string
  fileName: string
  contentType: string
  createdAt: string
}

export type ProductionFilePath = {
  id: string
  ozonProductId?: number
  offerId: string
  productName: string
  productLink?: string
  path: string
  createdAt: string
}

export type ProductionCatalogItem = {
  offerId: string
  ozonProductId?: number
  productName: string
  productLink: string
  fileCount: number
  completedAt?: string
  marketplace?: NovinkaMarketplace
}

export type ProductionTaskStatus = 'New' | 'InProgress' | 'Cancelled' | 'Completed'

export type ProductionTaskType = 'Ozon' | 'Novinka' | 'Kaspi' | 'Satu' | 'Halyk'

export type ProductionTask = {
  id: string
  ozonProductId: number
  offerId: string
  productName: string
  requiredQuantity: number
  actualQuantity?: number
  status: ProductionTaskStatus
  taskType?: ProductionTaskType
  isUrgent: boolean
  assignedUserName?: string
  createdByUserId?: string
  createdByDisplayName?: string
  createdAt: string
  startedAt?: string
  cancelledAt?: string
  cancelledByUserId?: string
  cancelledByDisplayName?: string
  cancellationComment?: string
  completedAt?: string
  isArchived: boolean
  archivedAt?: string
  items: ProductionTaskItem[]
}

export type ProductionTaskItem = {
  id: string
  ozonProductId: number
  offerId: string
  productName: string
  productLink?: string
  requiredQuantity: number
  actualQuantity?: number
  enforceMinimumQuantity?: boolean
  filePath?: string
}

export type ProductionSubTab = 'products' | 'tasks' | 'inProgress' | 'cancelled' | 'completed' | 'archive'

export type ProductionCatalogTab = 'ozon' | 'kaspi' | 'satu' | 'halyk' | NovinkaCatalogTab | 'editor'

export type TaskFormMode = 'ozon' | 'kaspi' | 'satu' | 'halyk'

export type ProductionAnalyticsSummaryRow = {
  userId?: string
  userName: string
  role: string
  avatarUrl: string
  taskCount: number
  itemCount: number
}

export type ProductionAnalyticsReport = {
  summary: ProductionAnalyticsSummaryRow[]
  tasks: ProductionTask[]
}

export type ProductionAnalyticsAssignee = {
  id: string
  displayName: string
  userName: string
  role: string
  avatarUrl: string
}

export type DraftTaskItem = {
  tempId: string
  ozonProductId: number
  offerId: string
  productName: string
  productLink?: string
  imageUrl: string
  requiredQuantity: number
  enforceMinimumQuantity: boolean
  isNovinka?: boolean
}

export type DraftNovinkaItem = {
  tempId: string
  productName: string
  productLink: string
  offerId?: string
}

export type ProductionTaskTableMode = 'ozon' | 'novinka' | 'mixed'
