import { memo, useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, FormEvent, ReactNode, SetStateAction } from 'react'
import * as signalR from '@microsoft/signalr'
import { KzMarketplaceTabs, RegionSwitcher } from './KzRegionUi'
import type { KzIntegrationSettings } from './KzRegionUi'
import { KzIntegrationsPanel } from './features/integrations/components/KzIntegrationsPanel'
import { CalculatorPanel } from './features/calculator/components/CalculatorPanel'
import { FinancesPanel } from './features/finances/components/FinancesPanel'
import {
  getKzMarketplaceLabel,
  getKzTaskType,
  getDefaultTaskFormMode,
  getNovinkaMarketplaceLabel,
  getVisibleNovinkaMarketplaces,
  isMarketplaceTaskFormMode,
  isKzMarketplaceTaskType,
  isKzNovinkaMarketplace,
  isNovinkaCatalogTab,
  appendNovinkaMarketplaceNote,
  parseNovinkaCatalogTab,
  resolveNovinkaMarketplaceFromTaskType,
  resolveTaskFormNovinkaMarketplace,
  resolveKzMarketplaceFromTaskType,
  stripNovinkaMarketplaceNote,
  toNovinkaCatalogTab,
  matchesShopRegionTaskType,
  readKzMarketplace,
  readShopRegion,
  SHOP_REGION_STORAGE_KEY,
  KZ_MARKETPLACE_STORAGE_KEY,
  type KzMarketplace,
  type NovinkaMarketplace,
  type ShopRegion,
} from './shopRegion'
import { getApiErrorMessage } from './shared/api/client'
import * as productionApi from './shared/api/productionApi'
import {
  formatAnalyticsDate,
  formatDateTime,
  calculateDaysSinceSupplyDate,
  formatDaysWithoutSales,
  formatFileSize,
  formatInputDate,
  formatLossMoney,
  formatMoney,
  formatOzonCreatedAt,
} from './shared/utils/formatters'
import type {
  DraftNovinkaItem,
  DraftTaskItem,
  ProductionAnalyticsAssignee,
  ProductionAnalyticsReport,
  ProductionCatalogItem,
  ProductionCatalogTab,
  ProductionFile,
  ProductionFilePath,
  ProductionSubTab,
  ProductionTask,
  ProductionTaskEditorKind,
  ProductionTaskItem,
  ProductionTaskType,
  TaskFormMode,
} from './domain/types/production'
import type { OzonProduct } from './domain/types/ozon'
import {
  findProductInActiveProductionTasks,
  formatProductTaskSelectionHint,
  fromDatetimeLocalValue,
  getProductionTaskItems,
  getProductionTaskSummary,
  isNovinkaTask,
  matchesProductionCatalogProduct,
  resolveTaskItemActualQuantity,
  sortProductionTasksByUrgency,
  toDatetimeLocalValue,
} from './features/production/lib/taskUtils'
import {
  buildNovinkaCatalogFromFiles,
  buildNovinkaCatalogFromSupplyReserves,
  filterNovinkaCatalogByMarketplace,
  getProductionFilesForCatalogItem,
  getProductionFilesForTaskItem,
  getProductionPathsForCatalogItem,
  getProductionPathsForTaskItem,
  mergeNovinkaCatalogItems,
  matchesProductionTask,
} from './features/production/lib/catalogUtils'
import {
  getProductionTaskTypeLabel,
  matchesKzProductionMarketplace,
  resolveNovinkaMarketplaceForTask,
} from './features/production/lib/taskDisplayUtils'
import {
  ProductionFilesModal,
  ProductionFileThumb,
  ProductionTaskArchiveTable,
  ProductionTaskTable,
} from './features/production/components/ProductionTaskTables'
import { ProductionAnalyticsRecordEditModal } from './features/production/components/ProductionAnalyticsRecordEditModal'
import { ProductionAnalyticsUserCard } from './features/production/components/ProductionAnalyticsUserCard'
import { NovinkaProductPreview } from './features/production/components/NovinkaProductPreview'
import { NovinkaSearchInput } from './features/production/components/NovinkaSearchInput'
import { ProductCatalogFilesEditor } from './features/production/components/ProductCatalogFilesEditor'
import { ProductSearchInput } from './features/production/components/ProductSearchInput'
import { ProductionPathsPanel } from './features/production/components/ProductionPathsPanel'
import { TaskProductPreview } from './features/production/components/TaskProductPreview'
import { NovinkaExternalLinkButton } from './features/production/components/NovinkaExternalLinkButton'
import { LinkHoverPreview } from './shared/components/LinkPreview'
import { OfferIdCell } from './shared/components/OfferIdCell'
import { ProductImageHoverPreview, ProductThumb } from './shared/components/ProductMedia'
import { UserAvatarPreview } from './shared/components/UserAvatarPreview'
import { appRoles, getRoleLabel } from './shared/constants/appRoles'
import './App.css'

const SYSTEM_USER_ID = '00000000-0000-4000-8000-000000000001'

type HomeBlockConfig = {
  id: string
  enabled: boolean
  actions: string[]
  marketplaces?: KzMarketplace[]
}

const kzHomeSplitBlockIds = new Set(['production', 'analytics', 'products'])
const allKzHomeMarketplaces: KzMarketplace[] = ['kaspi', 'satu', 'halyk']

function getBlockMarketplaces(block: HomeBlockConfig): KzMarketplace[] {
  if (!block.marketplaces?.length) {
    return [...allKzHomeMarketplaces]
  }

  return allKzHomeMarketplaces.filter((marketplace) => block.marketplaces!.includes(marketplace))
}

function withDefaultBlockMarketplaces(block: HomeBlockConfig, enabled: boolean): HomeBlockConfig {
  if (!kzHomeSplitBlockIds.has(block.id)) {
    return { ...block, enabled }
  }

  return {
    ...block,
    enabled,
    marketplaces: enabled ? getBlockMarketplaces(block) : block.marketplaces,
  }
}

type User = {
  id: string
  userName: string
  displayName: string
  position: string
  role: string
  avatarUrl: string
  allowedFeatures: string[]
  homeBlocks?: HomeBlockConfig[]
  canChangeOtherUserPasswords?: boolean
  telegramConnected?: boolean
  telegramConnectedAt?: string | null
  telegramConnectAllowed?: boolean
  isOnline?: boolean
  lastSeenAt?: string
  unreadCount?: number
}

type RoleProfile = {
  role: string
  displayName: string
  allowedFeatures: string[]
  homeBlocks: HomeBlockConfig[]
  canChangeOtherUserPasswords: boolean
}

type AdminUserTelegram = {
  connected: boolean
  chatIdMasked: string
  connectedAt: string | null
  enabledEvents: string[]
  availableEvents: string[]
  enabledEventsKz: string[]
  availableEventsKz: string[]
  connectAllowed: boolean
}

type AdminUserReport = {
  enabled: boolean
  reportTime: string
  timezone: string
  enabledSections: string[]
  availableSections: string[]
  lastSentOn: string | null
  monthlyEnabled: boolean
  monthlyReportTime: string
  monthlyTimezone: string
  monthlyEnabledSections: string[]
  monthlyLastSentOn: string | null
  telegramConnected: boolean
}

type ReportSection = {
  id: string
  group: string
  label: string
}

const accountingReportGroup = 'Учет / Отчетность'
const isAccountingReportSection = (section: ReportSection) => section.group === accountingReportGroup
const isRegularReportSection = (section: ReportSection) => !isAccountingReportSection(section)

type ChatMessage = {
  id: string
  groupId?: string
  senderId: string
  senderDisplayName?: string
  receiverId?: string
  text: string
  attachmentFileName: string
  attachmentContentType: string
  hasAttachment: boolean
  createdAt: string
  isOwn: boolean
}

type ChatThread = {
  type: 'user' | 'group'
  id: string
  title: string
  subtitle: string
  avatarUrl: string
  isOnline: boolean
  unreadCount: number
  memberCount: number
  createdByUserId?: string
  members?: ChatGroupMember[]
}

type ChatGroupMember = {
  userId: string
  userName: string
  displayName: string
  position: string
  avatarUrl: string
}

const accountingPrototypeTabs = ['materials', 'sales'] as const
type AccountingPrototypeTab = (typeof accountingPrototypeTabs)[number]

type AccountingMaterialRow = {
  id: string
  category: string
  name: string
  previewUrl?: string
  norm: number
  available: number
  inTransit: number
  request: number
  orderNote: string
  customFields?: Record<string, string>
}

type AccountingMaterialColumn = {
  id: string
  label: string
}

type AccountingSalesChannelRow = {
  id: string
  channel: string
  orders: number
  lshopAmount: number
  joyAmount: number | null
}

type AccountingSalesChannelApiRow = {
  id: string
  channel?: string
  orders?: number
  lshopAmount?: number
  joyAmount?: number | null
}

const accountingMaterialSeed: AccountingMaterialRow[] = [
  { id: 'roll-badge-58', category: 'Закатные заготовки (значки и магниты)', name: 'Значок D=58 мм', norm: 5000, available: 3700, inTransit: 1000, request: 800, orderNote: '' },
  { id: 'roll-badge-44', category: 'Закатные заготовки (значки и магниты)', name: 'Значок D=44 мм', norm: 2500, available: 1700, inTransit: 1000, request: 800, orderNote: '' },
  { id: 'roll-badge-32', category: 'Закатные заготовки (значки и магниты)', name: 'Значок D=32 мм', norm: 2000, available: 1900, inTransit: 0, request: 100, orderNote: '' },
  { id: 'roll-badge-60x40', category: 'Закатные заготовки (значки и магниты)', name: 'Значок 60x40 мм', norm: 3000, available: 2800, inTransit: 0, request: 200, orderNote: '' },
  { id: 'roll-badge-50x50', category: 'Закатные заготовки (значки и магниты)', name: 'Значок 50x50 мм', norm: 2000, available: 2300, inTransit: 0, request: 0, orderNote: '' },
  { id: 'roll-magnet-58', category: 'Закатные заготовки (значки и магниты)', name: 'Магнит D=58мм', norm: 5000, available: 5500, inTransit: 0, request: 0, orderNote: '' },
  { id: 'roll-magnet-100', category: 'Закатные заготовки (значки и магниты)', name: 'Магнит D=100мм', norm: 1000, available: 974, inTransit: 0, request: 26, orderNote: '' },
  { id: 'roll-magnet-50x50', category: 'Закатные заготовки (значки и магниты)', name: 'Магнит 50x50мм', norm: 2000, available: 2200, inTransit: 0, request: 0, orderNote: '' },
  { id: 'roll-magnet-80x53', category: 'Закатные заготовки (значки и магниты)', name: 'Магнит 80x53мм', norm: 3000, available: 2150, inTransit: 600, request: 600, orderNote: '' },
  { id: 'roll-bag-badge-58', category: 'Закатные заготовки (значки и магниты)', name: 'Пакетики для значков D=58мм', norm: 5000, available: 850, inTransit: 0, request: 4000, orderNote: '' },
  { id: 'roll-bag-badge-44', category: 'Закатные заготовки (значки и магниты)', name: 'Пакетики для значков D=44мм', norm: 2500, available: 2240, inTransit: 0, request: 1500, orderNote: '' },
  { id: 'roll-bag-badge-32', category: 'Закатные заготовки (значки и магниты)', name: 'Пакетики для значков D=32мм', norm: 2000, available: 960, inTransit: 0, request: 1800, orderNote: '' },
  { id: 'roll-bag-magnet-80x53', category: 'Закатные заготовки (значки и магниты)', name: 'Пакетики для магнитов 80x53мм', norm: 3000, available: 2000, inTransit: 0, request: 2800, orderNote: '' },
  { id: 'token-silver-matte', category: 'Заготовки жетонов, цепи и брелоки', name: 'Жетон серебро матовый', norm: 0, available: 64, inTransit: 0, request: 0, orderNote: 'Удаляем' },
  { id: 'token-silver-glossy', category: 'Заготовки жетонов, цепи и брелоки', name: 'Жетон серебро глянцевый', norm: 1000, available: 1055, inTransit: 0, request: 0, orderNote: '' },
  { id: 'token-gold', category: 'Заготовки жетонов, цепи и брелоки', name: 'Жетон золото', norm: 500, available: 371, inTransit: 0, request: 128, orderNote: '' },
  { id: 'token-black', category: 'Заготовки жетонов, цепи и брелоки', name: 'Жетон черный', norm: 150, available: 164, inTransit: 0, request: 0, orderNote: '' },
  { id: 'token-heart', category: 'Заготовки жетонов, цепи и брелоки', name: 'Жетон сердце', norm: 100, available: 99, inTransit: 0, request: 1, orderNote: '' },
  { id: 'chain-token-silver', category: 'Заготовки жетонов, цепи и брелоки', name: 'Цепь для жетона серебро', norm: 1000, available: 1432, inTransit: 0, request: 0, orderNote: '' },
  { id: 'chain-token-gold', category: 'Заготовки жетонов, цепи и брелоки', name: 'Цепь для жетона золото', norm: 500, available: 2, inTransit: 200, request: 500, orderNote: '' },
  { id: 'ring-keychain-silver', category: 'Заготовки жетонов, цепи и брелоки', name: 'Кольцо для Брелка (серебро)', norm: 0, available: 0, inTransit: 0, request: 0, orderNote: '' },
  { id: 'ring-keychain-gold', category: 'Заготовки жетонов, цепи и брелоки', name: 'Кольцо для Брелка (золото)', norm: 0, available: 63, inTransit: 0, request: 0, orderNote: '' },
  { id: 'keychain-clear-round', category: 'Заготовки жетонов, цепи и брелоки', name: 'Брелок прозрачный круглый', norm: 0, available: 100, inTransit: 0, request: 0, orderNote: '' },
  { id: 'keychain-clear-heart', category: 'Заготовки жетонов, цепи и брелоки', name: 'Брелок прозрачный сердце', norm: 0, available: 99, inTransit: 0, request: 0, orderNote: '' },
  { id: 'keychain-clear-40x40', category: 'Заготовки жетонов, цепи и брелоки', name: 'Брелок прозрачный 40x40мм', norm: 0, available: 97, inTransit: 0, request: 0, orderNote: '' },
  { id: 'keychain-clear-34x52', category: 'Заготовки жетонов, цепи и брелоки', name: 'Брелок прозрачный 34x52мм', norm: 0, available: 949, inTransit: 0, request: 0, orderNote: '' },
  { id: 'keychain-ring-chain', category: 'Заготовки жетонов, цепи и брелоки', name: 'Кольцо для брелка (с цепью)', norm: 0, available: 1959, inTransit: 0, request: 0, orderNote: '' },
  { id: 'paper-a4-glossy-115', category: 'Бумага', name: 'Бумага А4 (глянец 115гр)', norm: 10, available: 4, inTransit: 0, request: 6, orderNote: '' },
  { id: 'paper-a4-glossy-300', category: 'Бумага', name: 'Бумага А4 (глянец 300гр)', norm: 10, available: 4, inTransit: 0, request: 0, orderNote: '' },
  { id: 'paper-a4-matte-300', category: 'Бумага', name: 'Бумага А4 (матовая 300гр)', norm: 10, available: 4, inTransit: 0, request: 9, orderNote: '' },
  { id: 'paper-magnet-photo-100x150', category: 'Бумага', name: 'Бумага Magnet photo 100x150мм', norm: 20, available: 19, inTransit: 0, request: 1, orderNote: '' },
  { id: 'mug-beer-500', category: 'Сувенирная посуда', name: 'Бокал для пива 500мл (2шт)', norm: 30, available: 26, inTransit: 0, request: 21, orderNote: '' },
  { id: 'mug-wine-445', category: 'Сувенирная посуда', name: 'Бокал для вина 445мл (2шт)', norm: 30, available: 8, inTransit: 0, request: 20, orderNote: '' },
  { id: 'mug-champagne-210', category: 'Сувенирная посуда', name: 'Бокал для шампанского 210мл (2шт)', norm: 30, available: 10, inTransit: 0, request: 20, orderNote: '' },
  { id: 'mug-beer-660', category: 'Сувенирная посуда', name: 'Кружка для пива 660мл (2шт)', norm: 30, available: 26, inTransit: 0, request: 2, orderNote: '' },
  { id: 'mug-tea-330', category: 'Сувенирная посуда', name: 'Кружка чайная 330мл (1шт)', norm: 100, available: 92, inTransit: 0, request: 49, orderNote: '' },
  { id: 'shot-glass-60', category: 'Сувенирная посуда', name: 'Стопки для водки 60мл. (6шт)', norm: 30, available: 10, inTransit: 0, request: 20, orderNote: '' },
  { id: 'plate-big-203', category: 'Сувенирная посуда', name: 'Тарелка большая D=203мм', norm: 30, available: 24, inTransit: 0, request: 6, orderNote: '' },
  { id: 'plate-small', category: 'Сувенирная посуда', name: 'Тарелка малая D=', norm: 30, available: 0, inTransit: 0, request: 30, orderNote: '' },
  { id: 'shirt-embroidery-black', category: 'Текстиль', name: 'Футболка для вышивки (черные)', norm: 20, available: 1, inTransit: 0, request: 19, orderNote: '' },
  { id: 'shirt-embroidery-white', category: 'Текстиль', name: 'Футболка для вышивки (белые)', norm: 20, available: 0, inTransit: 0, request: 20, orderNote: '' },
  { id: 'shirt-embroidery-gray', category: 'Текстиль', name: 'Футболка для вышивки (серые)', norm: 20, available: 0, inTransit: 0, request: 20, orderNote: '' },
  { id: 'shirt-sublimation-black', category: 'Текстиль', name: 'Футболка для сублимации (черные)', norm: 20, available: 0, inTransit: 0, request: 20, orderNote: '' },
  { id: 'shirt-sublimation-white', category: 'Текстиль', name: 'Футболка для сублимации (белые)', norm: 20, available: 0, inTransit: 0, request: 20, orderNote: '' },
  { id: 'shirt-sublimation-gray', category: 'Текстиль', name: 'Футболка для сублимации (серые)', norm: 20, available: 0, inTransit: 0, request: 20, orderNote: '' },
  { id: 'mousepad-180x220', category: 'Текстиль', name: 'Коврик для мыши 180x220мм', norm: 20, available: 10, inTransit: 0, request: 10, orderNote: '' },
  { id: 'mousepad-210x260', category: 'Текстиль', name: 'Коврик для мыши 210x260мм.', norm: 20, available: 8, inTransit: 0, request: 12, orderNote: '' },
  { id: 'mousepad-heart', category: 'Текстиль', name: 'Коврик для мыши (Сердце)', norm: 20, available: 9, inTransit: 0, request: 11, orderNote: '' },
  { id: 'cap-sublimation-black', category: 'Текстиль', name: 'Кепки Сублимация (черные)', norm: 20, available: 0, inTransit: 0, request: 20, orderNote: '' },
  { id: 'cap-sublimation-white', category: 'Текстиль', name: 'Кепки Сублимация (белые)', norm: 20, available: 0, inTransit: 0, request: 20, orderNote: '' },
  { id: 'puzzle-sublimation-200x290', category: 'Прочее', name: 'Пазл (сублимация) 200x290мм', norm: 20, available: 6, inTransit: 0, request: 14, orderNote: '' },
]

const accountingSalesSeed: AccountingSalesChannelRow[] = [
  { id: 'kaspi-express', channel: 'Kaspi Express', orders: 54, lshopAmount: 436_400, joyAmount: 128_500 },
  { id: 'kaspi-zamler', channel: 'Kaspi Zamler', orders: 18, lshopAmount: 145_200, joyAmount: 42_300 },
  { id: 'kaspi-pickup', channel: 'Kaspi Самовывоз / Покупатели', orders: 9, lshopAmount: 74_900, joyAmount: 18_600 },
  { id: 'satu-halyk', channel: 'Satu / Halyk', orders: 7, lshopAmount: 56_700, joyAmount: 0 },
]

function toNumber(value: string) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function toOptionalNumber(value: string) {
  const trimmed = value.trim()
  return trimmed === '' ? null : toNumber(trimmed)
}

function readStoredJsonValue<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeStoredJsonValue<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value))
}

type AuditLog = {
  id: string
  userName: string
  displayName: string
  action: string
  entityType: string
  entityId: string
  details: string
  createdAt: string
}

type SystemHealth = {
  databaseOk: boolean
  serverTime: string
  uptime: string
  machineName: string
  dotnetVersion: string
  adminerUrl?: string | null
}

type OzonIntegrationSettings = {
  configured: boolean
  baseUrl: string
  clientIdMasked: string
  apiKeyMasked: string
  hasStoredClientId: boolean
  hasStoredApiKey: boolean
  updatedAt: string | null
}

type TelegramNotificationEvent = {
  id: string
  group: string
  label: string
  shopRegion?: string
}

type TelegramIntegrationInfo = {
  botConfigured: boolean
  botUsername: string | null
  botDisplayName: string | null
  connected: boolean
  chatIdMasked: string
  connectedAt: string | null
  connectUrl: string | null
  enabledEvents: string[]
  availableEvents: string[]
  enabledEventsKz: string[]
  availableEventsKz: string[]
  connectAllowed: boolean
}

type BackupFile = {
  fileName: string
  sizeBytes: number
  createdAt: string
}

type OzonStock = {
  productId: number
  offerId: string
  sku?: number
  name: string
  price: number
  oldPrice: number
  minPrice: number
  currencyCode: string
  fboPresent: number
  fbsPresent: number
  productUrl: string
  imageUrl: string
}

type ProductCostProfile = {
  productId: number
  offerId: string
  productName: string
  isPurchased: boolean
  costTypeId?: string | null
  costTypeName?: string | null
  useIndividualCost: boolean
  purchaseCost?: number | null
  packagingCost?: number | null
  productionCost?: number | null
  costTotal?: number | null
}

type ProductCostType = {
  id: string
  name: string
  isPurchased: boolean
  purchaseCost?: number | null
  packagingCost?: number | null
  productionCost?: number | null
  costTotal?: number | null
}

type InternalAnalyticsData = {
  stockCostTotal: number
  stockSalesNetTotal: number
  stockProfitTotal: number
  stockQuantity: number
  costedStockQuantity: number
  productsWithStock: number
  productsWithoutCost: number
  suppliesShippingTotal: number
  suppliesCount: number
  suppliesItemQuantity: number
  suppliesWithoutShippingCost: number
  periodDateFrom: string
  periodDateTo: string
  periodOrdersCount: number
  periodOrderedAmount: number
  periodPayoutTotal: number
  periodCommissionTotal: number
  periodLogisticsTotal: number
  periodServicesTotal: number
  periodDeductionsTotal: number
  periodSupplyShippingTotal: number
  periodExpensesTotal: number
  periodExpensesCount: number
  periodSoldCostTotal: number
  periodSoldCostedQuantity: number
  periodSoldWithoutCostQuantity: number
  periodNetProfit: number
}

type OzonAnalyticsSnapshot = {
  totalProductsCount: number
  sellingProductsCount: number
  readyForSaleProductsCount: number
  archivedProductsCount: number
  accountBalance?: number | null
  accountBalanceCurrency: string
  timestamp: string
}

type HomeSalesChartMetric = 'orders' | 'revenue'
type HomeSalesChartGroupBy = 'day' | 'month'

type HomeSalesChartConfig = {
  metric: HomeSalesChartMetric
  groupBy: HomeSalesChartGroupBy
  dateFrom: string
  dateTo: string
}

type HomeSalesChartPoint = {
  label: string
  periodKey: string
  orders: number
  revenue: number
}

type HomeSalesChartData = {
  points: HomeSalesChartPoint[]
  currencyCode: string
  totalOrders: number
  totalRevenue: number
}

type OzonAnalytics = {
  rows: Array<{
    sku: number
    offerId: string
    productName: string
    status: string
    postingNumber: string
    quantity: number
    revenue: number
    commissionPercent: number
    commissionAmount: number
    payout: number
    currencyCode: string
    logisticsAmount: number
    operationDate: string
  }>
  orderRows: Array<{
    sku: number
    offerId: string
    productName: string
    status: string
    postingNumber: string
    quantity: number
    revenue: number
    commissionPercent: number
    commissionAmount: number
    payout: number
    currencyCode: string
    logisticsAmount: number
    operationDate: string
  }>
  topProducts: Array<{
    sku: number
    offerId: string
    productName: string
    quantity: number
    revenue: number
    currencyCode: string
    stockTotal: number
  }>
  unsoldProducts: Array<{
    sku: number
    offerId: string
    productName: string
    price: number
    currencyCode: string
    stockTotal: number
    status: string
    imageUrl: string
    ozonSellingSince?: string
    daysWithoutSales?: number | null
  }>
  orderedUnitsTotal: number
  revenueTotal: number
  commissionTotal: number
  payoutTotal: number
  logisticsTotal: number
  servicesTotal: number
  awaitingDeliverCount: number
  awaitingDeliverAmount: number
  deliveringCount: number
  deliveredCount: number
  salesTotalCount: number
  salesAmountTotal: number
  inTransitCount: number
  inTransitAmount: number
  deliveredProductCount: number
  deliveredAmount: number
  cancelledCount: number
  cancelledAmount: number
  cancelledLogisticsTotal: number
  cancelledMissedProfitTotal: number
  accountBalance?: number | null
  accountBalanceCurrency: string
  sellingProductsCount: number
  readyForSaleProductsCount: number
  archivedProductsCount: number
  timestamp: string
}

type SupplyStatus = 'Created' | 'Sent' | 'Accepted'
type SupplyItemKind = 'Product' | 'Consumable' | 'MaterialAsset'

type SupplyItem = {
  id: string
  ozonProductId?: number
  offerId: string
  productName: string
  quantity: number
  isReserve: boolean
  itemKind: SupplyItemKind
}

type SupplyHistoryItem = {
  id: string
  userName: string
  displayName: string
  action: string
  details: string
  createdAt: string
}

type Supply = {
  id: string
  status: SupplyStatus
  createdAt: string
  sentAt?: string
  acceptedAt?: string
  shippingCost?: number | null
  isArchived: boolean
  archivedAt?: string
  items: SupplyItem[]
  history: SupplyHistoryItem[]
}

type SupplyAnalyticsItem = SupplyItem & {
  supplyId: string
  status: SupplyStatus
  isArchived?: boolean
  archivedAt?: string
  createdAt: string
  sentAt?: string
  acceptedAt?: string
  shippingCost?: number | null
}

type SupplyFboSummary = {
  shippedToOzon: number
  remainingToShip: number
  remainingItems: SupplyFboRemainingItem[]
}

type SupplyFboRemainingItem = {
  key: string
  productName: string
  offerId: string
  acceptedQuantity: number
  shippedQuantity: number
  remainingQuantity: number
}

type SupplyFboDefect = {
  id: string
  productKey: string
  offerId: string
  productName: string
  quantity: number
  createdAt: string
}

type SupplyExpense = {
  id: string
  name: string
  amount: number
  purchasedAt: string
  createdAt: string
  createdByUserId: string
  createdByDisplayName: string
}

type SupplyExpensesResponse = {
  items: SupplyExpense[]
  totalAmount: number
}

type OzonSupplyShipmentQuantity = {
  sku: number
  offerId: string
  productId: number
  quantity: number
  productName?: string
}

type DraftSupplyItem = {
  tempId: string
  id?: string
  ozonProductId?: number
  offerId: string
  productName: string
  imageUrl?: string
  quantity: number
  isReserve: boolean
  itemKind: SupplyItemKind
}

function formatSupplyItemKind(item: Pick<SupplyItem, 'isReserve' | 'offerId' | 'itemKind'>) {
  if (item.itemKind === 'Consumable') {
    return 'Расходный материал'
  }

  if (item.itemKind === 'MaterialAsset') {
    return 'Мат. ценность'
  }

  return item.isReserve ? (item.offerId.startsWith('NV-') ? 'Новинка' : 'Новый') : 'Постоянный'
}

function isSupplyProductKind(itemKind?: string | null) {
  return itemKind !== 'Consumable' && itemKind !== 'MaterialAsset'
}

function parseMoneyInput(value: string) {
  const normalized = value.trim().replace(',', '.')
  if (!normalized) {
    return null
  }

  const number = Number(normalized)
  return Number.isFinite(number) && number > 0 ? number : null
}

function isDateStringInRange(value: string | null | undefined, from: string, to: string) {
  const date = value?.trim().slice(0, 10)
  if (!date) {
    return false
  }

  if (from && date < from) {
    return false
  }

  if (to && date > to) {
    return false
  }

  return true
}

function dateInputValue(value: string | null | undefined) {
  return value?.trim().slice(0, 10) || ''
}

function normalizeMarketplaceOfferId(offerId: string) {
  const value = offerId.trim().toUpperCase()
  const match = /^([A-ZА-Я]+)-?0*(\d+)$/.exec(value)
  return match ? `${match[1]}:${Number(match[2])}` : value
}

function getOfferMatchKeys(offerId: string) {
  const value = offerId.trim()
  if (!value) {
    return []
  }

  return [`offer:${value}`, `offer-normalized:${normalizeMarketplaceOfferId(value)}`]
}

function normalizeSupplyProductName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function getSupplyProductNameKey(value: string) {
  const normalized = normalizeSupplyProductName(value)
  return normalized ? `name:${normalized}` : ''
}

function createTempId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function groupItemsByField<T>(items: T[], getKey: (item: T) => string): Array<[string, T[]]> {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const key = getKey(item)
    const bucket = map.get(key) ?? []
    bucket.push(item)
    map.set(key, bucket)
  }
  return Array.from(map.entries())
}

function getDefaultAnalyticsDateFrom() {
  const date = new Date()
  date.setDate(1)
  return formatInputDate(date)
}

function getDefaultAnalyticsDateTo() {
  return formatInputDate(new Date())
}

function getYearChartDefaultFrom() {
  const date = new Date()
  return formatInputDate(new Date(date.getFullYear(), 0, 1))
}

function getMonthChartDefaultFrom() {
  const date = new Date()
  return formatInputDate(new Date(date.getFullYear(), date.getMonth(), 1))
}

function createDefaultYearChartConfig(): HomeSalesChartConfig {
  return {
    metric: 'orders',
    groupBy: 'month',
    dateFrom: getYearChartDefaultFrom(),
    dateTo: getDefaultAnalyticsDateTo(),
  }
}

function createDefaultMonthChartConfig(): HomeSalesChartConfig {
  return {
    metric: 'orders',
    groupBy: 'day',
    dateFrom: getMonthChartDefaultFrom(),
    dateTo: getDefaultAnalyticsDateTo(),
  }
}

function getChartFilterDayCount(dateFrom: string, dateTo: string) {
  const from = new Date(`${dateFrom}T00:00:00`)
  const to = new Date(`${dateTo}T00:00:00`)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) {
    return 0
  }

  return Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1
}

const reportTimezoneOptions = [
  { value: 'Europe/Moscow', label: 'Москва' },
  { value: 'Asia/Almaty', label: 'Алматы' },
] as const

function normalizeReportTimezone(timezone?: string) {
  if (timezone === 'Europe/Moscow' || timezone === 'Russian Standard Time') {
    return 'Europe/Moscow'
  }

  if (timezone === 'Asia/Almaty') {
    return 'Asia/Almaty'
  }

  return 'Asia/Almaty'
}

const tabs = [
  { id: 'home', label: 'Главная' },
  { id: 'production', label: 'Производство' },
  { id: 'products', label: 'Товары' },
  { id: 'analytics', label: 'Аналитика' },
  { id: 'pooling', label: 'Склад' },
  { id: 'supplies', label: 'Поставки' },
  { id: 'chats', label: 'Чаты' },
  { id: 'integrations', label: 'Интеграции' },
  { id: 'accounting', label: 'Учет / Отчетность' },
  { id: 'users', label: 'Пользователи' },
  { id: 'settings', label: 'Настройки' },
] as const

const featureGroups = [
  {
    title: 'Главная',
    items: [{ id: 'home', label: 'Раздел' }],
    homeBlocks: true,
  },
  {
    title: 'Производство',
    items: [
      { id: 'production', label: 'Раздел' },
      { id: 'production.products', label: 'Список товаров' },
      { id: 'production.tasks', label: 'Задачи' },
      { id: 'production.tasks.designer', label: 'Видимость задач для дизайнеров' },
      { id: 'production.tasks.production', label: 'Видимость задач для производства' },
      { id: 'production.inProgress', label: 'В работе' },
      { id: 'production.readyToShip', label: 'Готовые к отгрузке' },
      { id: 'production.cancelled', label: 'Отменённые' },
      { id: 'production.completed', label: 'Выполненные' },
      { id: 'production.archive', label: 'Архив задач' },
      { id: 'production.createTask', label: 'Создание задач' },
      { id: 'production.editTasks', label: 'Редактирование задач' },
      { id: 'production.changeTaskType', label: 'Смена типа задачи' },
      { id: 'production.taskDeadline', label: 'Срок выполнения задач' },
      { id: 'production.cancelTasks', label: 'Отмена задач' },
      { id: 'production.editProducts', label: 'Редактирование товара' },
      { id: 'production.packItems', label: 'Упаковка товаров' },
      { id: 'production.deleteFiles', label: 'Удаление превью' },
      { id: 'production.deleteFilePaths', label: 'Удаление путей к файлам' },
    ],
  },
  {
    title: 'Товары',
    items: [
      { id: 'products', label: 'Раздел' },
      { id: 'products.edit', label: 'Изменение данных' },
    ],
  },
  {
    title: 'Аналитика',
    items: [
      { id: 'analytics', label: 'Раздел' },
      { id: 'analytics.summary', label: 'Сводка аналитики' },
      { id: 'analytics.topProducts', label: 'Топ товары' },
      { id: 'analytics.noSales', label: 'Без продаж' },
      { id: 'analytics.production', label: 'Производство' },
      { id: 'analytics.internal', label: 'Внутренняя аналитика' },
      { id: 'analytics.calculator', label: 'Калькулятор' },
      { id: 'analytics.calculator.edit', label: 'Калькулятор: настройки и синхронизация' },
      { id: 'analytics.finances', label: 'Финансы' },
    ],
  },
  {
    title: 'Склад',
    items: [
      { id: 'pooling', label: 'Раздел' },
      { id: 'pooling.editPrices', label: 'Редактирование цен' },
    ],
  },
  {
    title: 'Поставки',
    items: [
      { id: 'supplies', label: 'Раздел' },
      { id: 'supplies.create', label: 'Создать поставку' },
      { id: 'supplies.editor', label: 'Редактор поставок' },
      { id: 'supplies.all', label: 'Все поставки' },
      { id: 'supplies.archive', label: 'Архив поставок' },
      { id: 'supplies.analytics', label: 'Аналитика поставок' },
      { id: 'supplies.expenses', label: 'Расходники' },
      { id: 'supplies.edit', label: 'Изменение поставок' },
    ],
  },
  {
    title: 'Чаты',
    items: [
      { id: 'chats', label: 'Раздел' },
      { id: 'chats.edit', label: 'Отправка сообщений' },
      { id: 'chats.groups', label: 'Создание групп' },
    ],
  },
  {
    title: 'Интеграции',
    items: [
      { id: 'integrations', label: 'Раздел' },
      { id: 'integrations.ozon', label: 'Ozon: просмотр' },
      { id: 'integrations.ozon.edit', label: 'Ozon: настройка' },
      { id: 'integrations.telegram', label: 'Telegram: просмотр' },
      { id: 'integrations.telegram.connect', label: 'Telegram: подключение' },
      { id: 'integrations.telegram.notifications', label: 'Оповещения: просмотр' },
      { id: 'integrations.telegram.notifications.edit', label: 'Оповещения: настройка' },
      { id: 'integrations.telegram.reports', label: 'Отчёты: просмотр' },
      { id: 'integrations.telegram.reports.edit', label: 'Отчёты: настройка' },
    ],
  },
  {
    title: 'Учет / Отчетность',
    items: [
      { id: 'accounting', label: 'Раздел' },
      { id: 'accounting.sales', label: 'Отчет продаж' },
      { id: 'accounting.materials', label: 'Отчет материалов' },
      { id: 'accounting.send', label: 'Отправка в Telegram' },
    ],
  },
  {
    title: 'Пользователи',
    items: [
      { id: 'users', label: 'Раздел' },
      { id: 'users.create', label: 'Добавление пользователей' },
      { id: 'users.edit', label: 'Управление' },
    ],
  },
  {
    title: 'Настройки',
    items: [
      { id: 'settings', label: 'Раздел' },
      { id: 'settings.edit', label: 'Изменение настроек' },
    ],
  },
]

const homeBlockDefinitions = [
  {
    id: 'production',
    label: 'Производство',
    actions: [
      { id: 'production.tasks', label: 'Задачи' },
      { id: 'production.inProgress', label: 'В работе' },
      { id: 'production.readyToShip', label: 'Готовые к отгрузке' },
      { id: 'production.cancelled', label: 'Отменённые' },
      { id: 'production.completed', label: 'Выполненные' },
      { id: 'production.createTask', label: 'Создание задач' },
    ],
  },
  {
    id: 'analytics',
    label: 'Аналитика',
    actions: [
      { id: 'analytics.summary', label: 'Сводка' },
      { id: 'analytics.topProducts', label: 'Топ товары' },
      { id: 'analytics.noSales', label: 'Без продаж' },
      { id: 'analytics.production', label: 'Производство' },
      { id: 'analytics.internal', label: 'Внутренняя аналитика' },
      { id: 'analytics.calculator', label: 'Калькулятор' },
      { id: 'analytics.calculator.edit', label: 'Калькулятор: настройки и синхронизация' },
      { id: 'analytics.finances', label: 'Финансы' },
    ],
  },
  {
    id: 'supplies',
    label: 'Поставки',
    actions: [
      { id: 'supplies.create', label: 'Создать' },
      { id: 'supplies.all', label: 'Все поставки' },
      { id: 'supplies.editor', label: 'Редактор' },
      { id: 'supplies.analytics', label: 'Аналитика' },
      { id: 'supplies.expenses', label: 'Расходники' },
    ],
  },
  {
    id: 'products',
    label: 'Товары',
    actions: [{ id: 'products', label: 'Каталог' }],
  },
] as const

function resolveUserHomeBlocks(user: User, roleProfiles: RoleProfile[]): HomeBlockConfig[] {
  if (user.homeBlocks && user.homeBlocks.length > 0) {
    return user.homeBlocks
  }

  return getRoleProfileHomeBlocks(user.role, roleProfiles)
}

function getRoleProfileHomeBlocks(role: string, roleProfiles: RoleProfile[]): HomeBlockConfig[] {
  if (role === 'Admin') {
    return homeBlockDefinitions.map((block) => ({
      id: block.id,
      enabled: true,
      actions: block.actions.map((action) => action.id),
      ...(kzHomeSplitBlockIds.has(block.id) ? { marketplaces: [...allKzHomeMarketplaces] } : {}),
    }))
  }

  return roleProfiles.find((entry) => entry.role === role)?.homeBlocks ?? []
}

const UserHomeBlocksEditor = memo(function UserHomeBlocksEditor({
  homeBlocks,
  onChange,
  disabled = false,
}: {
  homeBlocks: HomeBlockConfig[]
  onChange: (nextBlocks: HomeBlockConfig[]) => void
  disabled?: boolean
}) {
  function updateBlock(nextBlock: HomeBlockConfig) {
    onChange([...homeBlocks.filter((entry) => entry.id !== nextBlock.id), nextBlock])
  }

  return (
    <div className="home-blocks-cards">
      <p className="home-blocks-cards-hint">Блоки на главной странице</p>
      {homeBlockDefinitions.map((block) => {
        const blockEdit =
          homeBlocks.find((entry) => entry.id === block.id) ??
          ({ id: block.id, enabled: false, actions: [] } satisfies HomeBlockConfig)

        return (
          <details key={block.id} className="home-block-card">
            <summary className="home-block-card-summary">
              <label
                className="home-block-card-title"
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => event.stopPropagation()}
              >
                <input
                  type="checkbox"
                  checked={blockEdit.enabled}
                  disabled={disabled}
                  onChange={(event) => {
                    const enabled = event.target.checked
                    updateBlock(
                      withDefaultBlockMarketplaces(
                        {
                          ...blockEdit,
                          enabled,
                          actions: enabled ? block.actions.map((action) => action.id) : [],
                          marketplaces:
                            enabled && kzHomeSplitBlockIds.has(block.id)
                              ? [...allKzHomeMarketplaces]
                              : blockEdit.marketplaces,
                        },
                        enabled,
                      ),
                    )
                  }}
                />
                <span>{block.label}</span>
              </label>
              {!blockEdit.enabled && <span className="home-block-card-off">Выключен</span>}
            </summary>

            {blockEdit.enabled && (
              <div className="home-block-card-body">
                {kzHomeSplitBlockIds.has(block.id) && (
                  <div className="home-block-card-section">
                    <p className="home-block-card-section-title">Маркетплейсы KZ</p>
                    <div className="permission-options-grid">
                      {allKzHomeMarketplaces.map((marketplace) => (
                        <label key={marketplace} className="permission-option">
                          <input
                            type="checkbox"
                            checked={getBlockMarketplaces(blockEdit).includes(marketplace)}
                            disabled={disabled}
                            onChange={(event) => {
                              const current = getBlockMarketplaces(blockEdit)
                              const nextMarketplaces = event.target.checked
                                ? [...current, marketplace]
                                : current.filter((item) => item !== marketplace)
                              updateBlock({
                                ...blockEdit,
                                marketplaces: nextMarketplaces,
                              })
                            }}
                          />
                          {getKzMarketplaceLabel(marketplace)}
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {block.actions.length > 0 && (
                  <div className="home-block-card-section">
                    <p className="home-block-card-section-title">Кнопки и действия</p>
                    <div className="permission-options-grid">
                      {block.actions.map((action) => (
                        <label key={action.id} className="permission-option">
                          <input
                            type="checkbox"
                            checked={blockEdit.actions.includes(action.id)}
                            disabled={disabled}
                            onChange={(event) => {
                              const nextActions = event.target.checked
                                ? [...blockEdit.actions, action.id]
                                : blockEdit.actions.filter((value) => value !== action.id)
                              updateBlock({ ...blockEdit, actions: nextActions })
                            }}
                          />
                          {action.label}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </details>
        )
      })}
    </div>
  )
})

const UserPermissionsEditor = memo(function UserPermissionsEditor({
  role,
  allowedFeatures,
  onFeaturesChange,
  homeBlocks,
  onHomeBlocksChange,
  featuresDisabled = false,
  isRoleTemplate = false,
}: {
  role: string
  allowedFeatures: string[]
  onFeaturesChange: (nextFeatures: string[]) => void
  homeBlocks: HomeBlockConfig[]
  onHomeBlocksChange: (nextBlocks: HomeBlockConfig[]) => void
  featuresDisabled?: boolean
  isRoleTemplate?: boolean
}) {
  const isAdmin = role === 'Admin' && !isRoleTemplate

  return (
    <div className="user-permissions-cards">
      <p className="user-permissions-hint">
        Права по разделам. Карточку «Главная» — что видно на стартовой странице, остальные — доступ к функциям внутри разделов.
      </p>
      {featureGroups.map((group) => {
        const enabledCount = group.items.filter((feature) =>
          isAdmin || allowedFeatures.includes(feature.id),
        ).length

        return (
        <details key={group.title} className="permission-card">
          <summary className="permission-card-summary">
            <span className="permission-card-title">{group.title}</span>
            <span className="permission-card-count">
              {enabledCount} из {group.items.length}
            </span>
          </summary>
          <div className="permission-card-body">
            {group.title === 'Главная' && (
              <p className="permission-card-note">Доступ к разделу и блоки на главной странице</p>
            )}
            <div className="permission-options-grid">
              {group.items.map((feature) => (
                <label key={feature.id} className="permission-option">
                  <input
                    type="checkbox"
                    checked={isAdmin || allowedFeatures.includes(feature.id)}
                    disabled={featuresDisabled || isAdmin}
                    onChange={(event) =>
                      onFeaturesChange(
                        event.target.checked
                          ? [...allowedFeatures, feature.id]
                          : allowedFeatures.filter((item) => item !== feature.id),
                      )
                    }
                  />
                  {feature.label}
                </label>
              ))}
            </div>
            {'homeBlocks' in group && group.homeBlocks && (!isAdmin || isRoleTemplate) && (
              <>
                <div className="permission-section-divider" />
                <UserHomeBlocksEditor
                  homeBlocks={homeBlocks}
                  onChange={onHomeBlocksChange}
                  disabled={featuresDisabled}
                />
              </>
            )}
          </div>
        </details>
        )
      })}
    </div>
  )
})

function LazyUserSettingsDetails({
  summary,
  className,
  children,
}: {
  summary: ReactNode
  className?: string
  children: ReactNode
}) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <details className={className} onToggle={(event) => setIsOpen(event.currentTarget.open)}>
      <summary>{summary}</summary>
      {isOpen ? children : null}
    </details>
  )
}

function hasExplicitProductionTaskVisibility(features: string[] | undefined) {
  return Boolean(
    features?.includes('production.tasks.designer') || features?.includes('production.tasks.production'),
  )
}

function canSeeNovinkaProductionTasks(role: string | undefined, features: string[] | undefined) {
  if (!role || role === 'Admin') {
    return true
  }

  if (features?.includes('production.tasks.designer')) {
    return true
  }

  if (hasExplicitProductionTaskVisibility(features)) {
    return false
  }

  return role === 'Designer' || role === 'Leadership'
}

function canSeeOzonProductionTasks(role: string | undefined, features: string[] | undefined) {
  if (!role || role === 'Admin') {
    return true
  }

  if (features?.includes('production.tasks.production')) {
    return true
  }

  if (hasExplicitProductionTaskVisibility(features)) {
    return false
  }

  return role === 'Production' || role === 'Leadership'
}

function isProductionTaskVisibleForUser(
  _task: ProductionTask,
  role: string | undefined,
  features: string[] | undefined,
) {
  return canSeeNovinkaProductionTasks(role, features) || canSeeOzonProductionTasks(role, features)
}

const defaultUserFeatures = ['home', 'production', 'production.products', 'production.tasks', 'production.inProgress', 'production.readyToShip', 'production.cancelled', 'production.completed', 'products', 'supplies', 'supplies.create', 'supplies.all', 'supplies.expenses', 'chats', 'chats.edit', 'integrations', 'integrations.telegram', 'integrations.telegram.connect', 'accounting', 'accounting.sales', 'accounting.materials', 'accounting.send', 'analytics.internal']

type TabId = (typeof tabs)[number]['id']
const tabIds = tabs.map((tab) => tab.id) as TabId[]
const supplySubTabs = ['create', 'editor', 'all', 'archive', 'analytics', 'expenses'] as const
const analyticsSubTabs = ['summary', 'topProducts', 'noSales', 'production', 'internal', 'calculator', 'finances'] as const

/**
 * Начало «всего периода» для кнопки быстрого выбора дат.
 * Ozon хранит финансовые операции ограниченный срок, поэтому уходить
 * дальше смысла нет — только лишние запросы в пустоту.
 */
const ALL_PERIOD_START = '2024-01-01'
const productionSubTabs = ['products', 'tasks', 'inProgress', 'readyToShip', 'cancelled', 'completed', 'archive'] as const
type SupplySubTab = (typeof supplySubTabs)[number]
type AnalyticsSubTab = (typeof analyticsSubTabs)[number]

function readStoredUiValue<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  if (typeof window === 'undefined') {
    return fallback
  }

  const value = window.localStorage.getItem(key)
  return value && allowed.includes(value as T) ? (value as T) : fallback
}

function writeStoredUiValue(key: string, value: string) {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(key, value)
}

function UsersAdminPanel({
  token,
  users,
  usersLoadError,
  roleProfiles,
  currentUser,
  canCreateUsers,
  canEditUsers,
  canChangeOtherPasswords,
  onUsersChange,
  onCurrentUserChange,
  onOpenUserProfile,
}: {
  token: string
  users: User[]
  usersLoadError: string
  roleProfiles: RoleProfile[]
  currentUser: User | null
  canCreateUsers: boolean
  canEditUsers: boolean
  canChangeOtherPasswords: boolean
  onUsersChange: Dispatch<SetStateAction<User[]>>
  onCurrentUserChange: (user: User) => void
  onOpenUserProfile: (user: User) => void
}) {
  const [newUser, setNewUser] = useState({
    userName: '',
    displayName: '',
    position: '',
    password: '',
    role: 'Production',
    allowedFeatures: defaultUserFeatures,
    homeBlocks: [] as HomeBlockConfig[],
  })
  const [passwordEdits, setPasswordEdits] = useState<Record<string, string>>({})
  const [userSettingsEdits, setUserSettingsEdits] = useState<Record<string, User>>({})
  const [savedUserSettingsIds, setSavedUserSettingsIds] = useState<Record<string, true>>({})
  const savedUserSettingsTimeoutsRef = useRef<Record<string, number>>({})

  useEffect(() => {
    return () => {
      Object.values(savedUserSettingsTimeoutsRef.current).forEach((timeoutId) => {
        window.clearTimeout(timeoutId)
      })
    }
  }, [])

  function markUserSettingsSaved(userId: string) {
    setSavedUserSettingsIds((current) => ({ ...current, [userId]: true }))

    const existingTimeout = savedUserSettingsTimeoutsRef.current[userId]
    if (existingTimeout) {
      window.clearTimeout(existingTimeout)
    }

    savedUserSettingsTimeoutsRef.current[userId] = window.setTimeout(() => {
      setSavedUserSettingsIds((current) => {
        const next = { ...current }
        delete next[userId]
        return next
      })
      delete savedUserSettingsTimeoutsRef.current[userId]
    }, 3000)
  }

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const response = await fetch('/api/admin/users', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userName: newUser.userName,
        displayName: newUser.displayName,
        position: newUser.position,
        password: newUser.password,
        role: newUser.role,
        allowedFeatures: newUser.allowedFeatures,
        homeBlocks:
          newUser.homeBlocks.length > 0
            ? newUser.homeBlocks
            : getRoleProfileHomeBlocks(newUser.role, roleProfiles),
      }),
    })

    if (!response.ok) {
      return
    }

    const createdUser = await response.json()
    onUsersChange((current) => [...current, createdUser])
    setNewUser({
      userName: '',
      displayName: '',
      position: '',
      password: '',
      role: 'Production',
      allowedFeatures: defaultUserFeatures,
      homeBlocks: getRoleProfileHomeBlocks('Production', roleProfiles),
    })
  }

  async function saveUserSettings(id: string) {
    const edit = userSettingsEdits[id]
    if (!edit) {
      return
    }

    const response = await fetch(`/api/admin/users/${id}/settings`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        displayName: edit.displayName,
        position: edit.position,
        role: edit.role,
        allowedFeatures: edit.allowedFeatures,
        homeBlocks: edit.homeBlocks ?? resolveUserHomeBlocks(edit, roleProfiles),
      }),
    })

    if (!response.ok) {
      return
    }

    const updatedUser: User = await response.json()
    onUsersChange((current) => current.map((item) => (item.id === id ? updatedUser : item)))
    if (currentUser?.id === id) {
      onCurrentUserChange(updatedUser)
    }
    setUserSettingsEdits((current) => {
      const next = { ...current }
      delete next[id]
      return next
    })
    markUserSettingsSaved(id)
  }

  async function deleteUser(id: string) {
    const response = await fetch(`/api/admin/users/${id}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      return
    }

    onUsersChange((current) => current.filter((item) => item.id !== id))
  }

  async function changeUserPassword(id: string) {
    const password = passwordEdits[id]
    if (!password) {
      return
    }

    const response = await fetch(`/api/admin/users/${id}/password`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ password }),
    })

    if (!response.ok) {
      return
    }

    setPasswordEdits((current) => ({ ...current, [id]: '' }))
  }

  return (
    <section className="admin-panel">
      <div className="section-title">
        <h2>Пользователи</h2>
        <p>
          {canEditUsers
            ? 'Создание и редактирование учётных записей'
            : canCreateUsers
              ? 'Добавление учётных записей'
              : 'Просмотр учётных записей'}
        </p>
      </div>

      {canCreateUsers && (
        <form className="user-form" onSubmit={createUser}>
          <label>
            <span>Логин</span>
            <input
              placeholder="Логин"
              value={newUser.userName}
              onChange={(event) => setNewUser((current) => ({ ...current, userName: event.target.value }))}
              required
            />
          </label>
          <label>
            <span>Имя</span>
            <input
              placeholder="Имя"
              value={newUser.displayName}
              onChange={(event) => setNewUser((current) => ({ ...current, displayName: event.target.value }))}
              required
            />
          </label>
          <label>
            <span>Должность</span>
            <input
              placeholder="Должность"
              value={newUser.position}
              onChange={(event) => setNewUser((current) => ({ ...current, position: event.target.value }))}
            />
          </label>
          <label>
            <span>Пароль</span>
            <input
              placeholder="Пароль"
              type="password"
              value={newUser.password}
              onChange={(event) => setNewUser((current) => ({ ...current, password: event.target.value }))}
              required
            />
          </label>
          <label>
            <span>Роль</span>
            <select
              value={newUser.role}
              onChange={(event) => {
                const role = event.target.value
                const profile = roleProfiles.find((item) => item.role === role)
                setNewUser((current) => ({
                  ...current,
                  role,
                  allowedFeatures:
                    role === 'Admin' ? current.allowedFeatures : profile?.allowedFeatures ?? defaultUserFeatures,
                  homeBlocks: getRoleProfileHomeBlocks(role, roleProfiles),
                }))
              }}
            >
              {appRoles
                .filter((role) => canEditUsers || role.value !== 'Admin')
                .map((role) => (
                  <option key={role.value} value={role.value}>
                    {role.label}
                  </option>
                ))}
            </select>
          </label>
          <button type="submit" className="user-form-submit">
            Добавить
          </button>
          <div className="user-form-features">
            <UserPermissionsEditor
              role={newUser.role}
              allowedFeatures={newUser.allowedFeatures}
              onFeaturesChange={(allowedFeatures) =>
                setNewUser((current) => ({ ...current, allowedFeatures }))
              }
              homeBlocks={newUser.homeBlocks}
              onHomeBlocksChange={(homeBlocks) => setNewUser((current) => ({ ...current, homeBlocks }))}
              featuresDisabled={newUser.role === 'Admin'}
            />
          </div>
        </form>
      )}

      {usersLoadError && (
        <div className="empty-state users-load-error">
          <strong>Не удалось загрузить список пользователей</strong>
          <p>{usersLoadError}</p>
        </div>
      )}

      <ul className="users-list">
        {users.map((item) => {
          if (item.id === SYSTEM_USER_ID) {
            return (
              <li key={item.id} className="user-list-item user-list-item-system">
                <div className="user-list-row user-list-row-system">
                  <span className="user-card-head">
                    <UserAvatarPreview
                      avatarUrl={item.avatarUrl}
                      displayName={item.displayName || item.userName}
                    />
                    <span className="user-card-info">
                      <strong>{item.displayName || item.userName}</strong>
                      <small>Системный аккаунт · не настраивается</small>
                    </span>
                  </span>
                  <span className="user-badge user-badge-role">Система</span>
                </div>
              </li>
            )
          }

          const edit = userSettingsEdits[item.id] ?? {
            ...item,
            homeBlocks: resolveUserHomeBlocks(item, roleProfiles),
          }
          const editFeatures = edit.allowedFeatures ?? []
          const editHomeBlocks = edit.homeBlocks ?? resolveUserHomeBlocks(edit, roleProfiles)
          const showPasswordControls =
            canChangeOtherPasswords && item.id !== currentUser?.id && canEditUsers
          const showDelete = item.id !== SYSTEM_USER_ID && canEditUsers

          return (
            <li key={item.id} className="user-list-item">
              <div className="user-list-row">
                <button type="button" className="user-card-open" onClick={() => onOpenUserProfile(item)}>
                  <span className="user-card-head">
                    <UserAvatarPreview
                      avatarUrl={item.avatarUrl}
                      displayName={item.displayName || item.userName}
                    />
                    <span className="user-card-info">
                      <strong>{item.displayName || item.userName}</strong>
                      <small>Логин: {item.userName}</small>
                      <small>{item.position || 'Должность не указана'}</small>
                    </span>
                  </span>
                </button>
                <div className="user-list-badges">
                  <span className="user-badge user-badge-role">{getRoleLabel(item.role)}</span>
                  <span className={`user-badge user-badge-telegram ${item.telegramConnected ? 'is-online' : 'is-offline'}`}>
                    Telegram: {item.telegramConnected ? 'подключён' : 'не подключён'}
                  </span>
                  <span className={`user-badge user-badge-online ${item.isOnline ? 'is-online' : 'is-offline'}`}>
                    {item.isOnline ? 'В сети' : 'Не в сети'}
                    {!item.isOnline && item.lastSeenAt && (
                      <small>Р‘С‹Р»: {formatDateTime(item.lastSeenAt)}</small>
                    )}
                  </span>
                </div>
                <div className="user-list-actions">
                  <input
                    className={`user-password-input ${showPasswordControls ? '' : 'is-slot-hidden'}`}
                    placeholder="Новый пароль"
                    type="password"
                    autoComplete="new-password"
                    tabIndex={showPasswordControls ? 0 : -1}
                    aria-hidden={!showPasswordControls}
                    disabled={!showPasswordControls}
                    value={passwordEdits[item.id] ?? ''}
                    onChange={(event) =>
                      setPasswordEdits((current) => ({
                        ...current,
                        [item.id]: event.target.value,
                      }))
                    }
                  />
                  <button
                    type="button"
                    className={`user-action-btn ${showPasswordControls ? '' : 'is-slot-hidden'}`}
                    tabIndex={showPasswordControls ? 0 : -1}
                    aria-hidden={!showPasswordControls}
                    disabled={!showPasswordControls}
                    onClick={() => void changeUserPassword(item.id)}
                  >
                    Сменить пароль
                  </button>
                  <button
                    type="button"
                    className={`user-action-btn danger ${showDelete ? '' : 'is-slot-hidden'}`}
                    tabIndex={showDelete ? 0 : -1}
                    aria-hidden={!showDelete}
                    disabled={!showDelete}
                    onClick={() => void deleteUser(item.id)}
                  >
                    Удалить
                  </button>
                </div>
              </div>
              {canEditUsers && (
                <LazyUserSettingsDetails className="user-settings-panel" summary="Настройки пользователя">
                  <div className="user-settings-grid">
                    <label>
                      <span>Имя</span>
                      <input
                        placeholder="Имя"
                        value={edit.displayName}
                        onChange={(event) =>
                          setUserSettingsEdits((current) => ({
                            ...current,
                            [item.id]: { ...edit, displayName: event.target.value },
                          }))
                        }
                      />
                    </label>
                    <label>
                      <span>Должность</span>
                      <input
                        placeholder="Должность"
                        value={edit.position}
                        onChange={(event) =>
                          setUserSettingsEdits((current) => ({
                            ...current,
                            [item.id]: { ...edit, position: event.target.value },
                          }))
                        }
                      />
                    </label>
                    <label>
                      <span>Роль</span>
                      <select
                        value={edit.role}
                        onChange={(event) => {
                          const role = event.target.value
                          const profile = roleProfiles.find((entry) => entry.role === role)
                          setUserSettingsEdits((current) => ({
                            ...current,
                            [item.id]: {
                              ...edit,
                              role,
                              allowedFeatures:
                                role === 'Admin'
                                  ? edit.allowedFeatures
                                  : profile?.allowedFeatures ?? edit.allowedFeatures,
                              homeBlocks: getRoleProfileHomeBlocks(role, roleProfiles),
                            },
                          }))
                        }}
                      >
                        {appRoles.map((role) => (
                          <option key={role.value} value={role.value}>
                            {role.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <UserPermissionsEditor
                      role={edit.role}
                      allowedFeatures={editFeatures}
                      onFeaturesChange={(allowedFeatures) =>
                        setUserSettingsEdits((current) => ({
                          ...current,
                          [item.id]: { ...edit, allowedFeatures },
                        }))
                      }
                      homeBlocks={editHomeBlocks}
                      onHomeBlocksChange={(homeBlocks) =>
                        setUserSettingsEdits((current) => ({
                          ...current,
                          [item.id]: { ...edit, homeBlocks },
                        }))
                      }
                      featuresDisabled={edit.role === 'Admin'}
                    />
                    <button
                      type="button"
                      className="user-action-btn user-settings-save"
                      onClick={() => void saveUserSettings(item.id)}
                    >
                      {savedUserSettingsIds[item.id] ? 'Сохранено' : 'Сохранить настройки'}
                    </button>
                  </div>
                </LazyUserSettingsDetails>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function AccountingReportsPrototype({ token }: { token: string }) {
  const today = new Date().toISOString().slice(0, 10)
  const [activeAccountingTab, setActiveAccountingTab] = useState<AccountingPrototypeTab>(() =>
    readStoredUiValue('lshop.accountingTab', accountingPrototypeTabs, 'materials'),
  )
  const [materialsReportDate, setMaterialsReportDate] = useState(today)
  const [salesReportDateFrom, setSalesReportDateFrom] = useState(today)
  const [salesReportDateTo, setSalesReportDateTo] = useState(today)
  const [materials, setMaterials] = useState<AccountingMaterialRow[]>(() =>
    readStoredJsonValue<AccountingMaterialRow[]>('lshop.accounting.materials', accountingMaterialSeed),
  )
  const [materialSections, setMaterialSections] = useState(() =>
    readStoredJsonValue<string[]>(
      'lshop.accounting.materialSections',
      Array.from(new Set(accountingMaterialSeed.map((row) => row.category.trim()).filter(Boolean))),
    ),
  )
  const [materialColumns] = useState<AccountingMaterialColumn[]>([])
  const [newMaterialSectionName, setNewMaterialSectionName] = useState('')
  const [materialFilter, setMaterialFilter] = useState('')
  const [salesRows, setSalesRows] = useState<AccountingSalesChannelRow[]>(() =>
    readStoredJsonValue<AccountingSalesChannelRow[]>('lshop.accounting.salesRows', accountingSalesSeed),
  )
  const [notice, setNotice] = useState('')
  const [salesReportLoading, setSalesReportLoading] = useState(false)
  const [accountingReportReady, setAccountingReportReady] = useState<Record<AccountingPrototypeTab, boolean>>({
    materials: false,
    sales: false,
  })
  const [manualSalesFields, setManualSalesFields] = useState(() =>
    readStoredJsonValue('lshop.accounting.salesManual', {
    previousReturns: 12_400,
    designerSales: 64_000,
    buyerCancels: 3,
    buyerCancelAmount: 19_800,
    managerCancels: 1,
    newKaspiPositions: 14,
    newSatuPositions: 3,
    quality: 'Хорошо',
    responsible: 'Валентин',
    manager: 'Таир',
    driver: 'Мухит',
    comment: 'Проверить отмены и возвраты перед отправкой директору.',
    }),
  )

  function getSalesReportRange() {
    const from = salesReportDateFrom || today
    const to = salesReportDateTo || from
    return from <= to ? { from, to } : { from: to, to: from }
  }

  function getSalesReportPeriodLabel() {
    const { from, to } = getSalesReportRange()
    return from === to ? from : `${from} - ${to}`
  }

  function getSalesReportFileDate() {
    const { from, to } = getSalesReportRange()
    return from === to ? from : `${from}_${to}`
  }

  useEffect(() => {
    writeStoredUiValue('lshop.accountingTab', activeAccountingTab)
  }, [activeAccountingTab])

  const filteredMaterials = useMemo(() => {
    const query = materialFilter.trim().toLowerCase()
    if (!query) {
      return materials
    }

    return materials.filter((row) => {
      const customValues = Object.values(row.customFields ?? {}).join(' ')
      return `${row.category} ${row.name} ${row.orderNote} ${customValues}`.toLowerCase().includes(query)
    })
  }, [materialFilter, materials])

  const materialSummary = useMemo(() => {
    const shortageRows = filteredMaterials.filter((row) => row.available - row.norm < 0)
    return {
      total: filteredMaterials.length,
      shortages: shortageRows.length,
      requestTotal: filteredMaterials.reduce((sum, row) => sum + row.request, 0),
      critical: shortageRows.filter((row) => row.available + row.inTransit < row.norm).length,
    }
  }, [filteredMaterials])

  const materialGroups = useMemo(() => {
    const groups = new Map<string, AccountingMaterialRow[]>(materialSections.map((section) => [section, []]))
    filteredMaterials.forEach((row) => {
      const category = row.category.trim() || 'Без раздела'
      groups.set(category, [...(groups.get(category) ?? []), row])
    })

    return Array.from(groups.entries())
      .map(([category, rows]) => ({
        category,
        rows,
        shortages: rows.filter((row) => row.available - row.norm < 0).length,
        requestTotal: rows.reduce((sum, row) => sum + row.request, 0),
      }))
      .filter((group) => group.rows.length > 0 || !materialFilter.trim())
  }, [filteredMaterials, materialFilter, materialSections])

  const salesSummary = useMemo(() => {
    const orders = salesRows.reduce((sum, row) => sum + row.orders, 0)
    const lshopAmount = salesRows.reduce((sum, row) => sum + row.lshopAmount, 0)
    const joyAmount = salesRows.reduce((sum, row) => sum + (row.joyAmount ?? 0), 0)
    const gross = lshopAmount + joyAmount

    return { orders, lshopAmount, joyAmount, gross, finalAmount: gross }
  }, [salesRows])
  const hasAnyJoySalesAmount = salesRows.some((row) => row.joyAmount !== null)
  const materialGridTemplate = `minmax(260px, 1.6fr) repeat(5, minmax(92px, 0.65fr)) ${materialColumns
    .map(() => 'minmax(150px, 0.8fr)')
    .join(' ')} minmax(210px, 1.3fr) minmax(120px, 0.55fr)`
  const materialGridMinWidth = `${1100 + materialColumns.length * 170}px`

  function updateMaterial(id: string, patch: Partial<AccountingMaterialRow>) {
    setMaterials((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  }

  function updateMaterialCustomField(rowId: string, columnId: string, value: string) {
    setMaterials((current) =>
      current.map((row) =>
        row.id === rowId
          ? {
              ...row,
              customFields: {
                ...(row.customFields ?? {}),
                [columnId]: value,
              },
            }
          : row,
      ),
    )
  }

  function updateSalesRow(id: string, patch: Partial<AccountingSalesChannelRow>) {
    setSalesRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)))
  }

  function addMaterialRow(category = 'Ручной ввод') {
    const sectionName = category.trim() || 'Ручной ввод'
    setMaterialSections((current) => (current.includes(sectionName) ? current : [...current, sectionName]))
    setMaterials((current) => [
      ...current,
      {
        id: `manual-${Date.now()}`,
        category: sectionName,
        name: 'Новая позиция',
        previewUrl: '',
        norm: 0,
        available: 0,
        inTransit: 0,
        request: 0,
        orderNote: '',
        customFields: Object.fromEntries(materialColumns.map((column) => [column.id, ''])),
      },
    ])
  }

  function addMaterialSection() {
    const sectionName = newMaterialSectionName.trim()
    if (!sectionName) {
      setNotice('Введите название нового раздела материалов.')
      return
    }

    setMaterialSections((current) => (current.includes(sectionName) ? current : [...current, sectionName]))
    setNewMaterialSectionName('')
    setNotice(`Раздел «${sectionName}» добавлен. Добавляй строки внутри него.`)
  }

  function buildAccountingReport() {
    setAccountingReportReady((current) => ({ ...current, [activeAccountingTab]: true }))
    setNotice('')
  }

  function persistAccountingChanges(message = 'Изменения сохранены.') {
    writeStoredJsonValue('lshop.accounting.materials', materials)
    writeStoredJsonValue('lshop.accounting.materialSections', materialSections)
    writeStoredJsonValue('lshop.accounting.salesRows', salesRows)
    writeStoredJsonValue('lshop.accounting.salesManual', manualSalesFields)
    setNotice(message)
  }

  function saveAccountingMaterialRow(row: AccountingMaterialRow) {
    const nextMaterials = materials.map((item) => (item.id === row.id ? row : item))
    writeStoredJsonValue('lshop.accounting.materials', nextMaterials)
    writeStoredJsonValue('lshop.accounting.materialSections', materialSections)
    setNotice(`Позиция «${row.name || 'без названия'}» сохранена.`)
  }

  function saveAccountingSalesRow(row: AccountingSalesChannelRow) {
    const nextRows = salesRows.map((item) => (item.id === row.id ? row : item))
    writeStoredJsonValue('lshop.accounting.salesRows', nextRows)
    writeStoredJsonValue('lshop.accounting.salesManual', manualSalesFields)
    setNotice(`Строка «${row.channel || 'продажи'}» сохранена.`)
  }

  async function loadKzAccountingAnalytics(marketplace: KzMarketplace) {
    const { from, to } = getSalesReportRange()
    const params = new URLSearchParams({
      dateFrom: from,
      dateTo: to,
      forceRefresh: 'true',
    })

    const response = await fetch(`/api/kz/${marketplace}/analytics?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      throw new Error(getApiErrorMessage(await response.text(), `Не удалось обновить ${getKzMarketplaceLabel(marketplace)}`))
    }

    return (await response.json()) as OzonAnalytics
  }

  async function loadKaspiAccountingSalesChannels() {
    const { from, to } = getSalesReportRange()
    const params = new URLSearchParams({
      dateFrom: from,
      dateTo: to,
    })

    const response = await fetch(`/api/kz/kaspi/sales-channels?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      throw new Error(getApiErrorMessage(await response.text(), 'Не удалось обновить каналы Kaspi.'))
    }

    return (await response.json()) as AccountingSalesChannelApiRow[]
  }

  async function refreshSalesAccountingReport() {
    setSalesReportLoading(true)
    const periodLabel = getSalesReportPeriodLabel()
    setNotice('Обновляем отчет продаж за выбранный период...')

    try {
      const [kaspiChannelsResult, kaspiResult, satuResult, halykResult] = await Promise.allSettled([
        loadKaspiAccountingSalesChannels(),
        loadKzAccountingAnalytics('kaspi'),
        loadKzAccountingAnalytics('satu'),
        loadKzAccountingAnalytics('halyk'),
      ])
      const kaspiChannels = kaspiChannelsResult.status === 'fulfilled' ? kaspiChannelsResult.value : null
      const kaspi = kaspiResult.status === 'fulfilled' ? kaspiResult.value : null
      const satu = satuResult.status === 'fulfilled' ? satuResult.value : null
      const halyk = halykResult.status === 'fulfilled' ? halykResult.value : null

      if (!kaspi && !satu) {
        const message =
          kaspiResult.status === 'rejected'
            ? kaspiResult.reason instanceof Error
              ? kaspiResult.reason.message
              : 'Не удалось обновить Kaspi.'
            : satuResult.status === 'rejected' && satuResult.reason instanceof Error
              ? satuResult.reason.message
              : 'Не удалось обновить отчет продаж.'
        throw new Error(message)
      }

      const kaspiRowsById = new Map((kaspiChannels ?? []).map((row) => [row.id, row]))
      const hasKaspiChannelRows = kaspiRowsById.size > 0
      const nextRows = salesRows.map((row) => {
        if (row.id.startsWith('kaspi-')) {
          const kaspiChannel = kaspiRowsById.get(row.id)
          if (kaspiChannel) {
            return {
              ...row,
              channel: kaspiChannel.channel || row.channel,
              orders: toNumber(String(kaspiChannel.orders ?? 0)),
              lshopAmount: toNumber(String(kaspiChannel.lshopAmount ?? 0)),
              joyAmount: kaspiChannel.joyAmount == null ? null : toNumber(String(kaspiChannel.joyAmount)),
            }
          }

          if (hasKaspiChannelRows) {
            return {
              ...row,
              orders: 0,
              lshopAmount: 0,
              joyAmount: null,
            }
          }

          if (row.id === 'kaspi-express' && kaspi) {
            return {
              ...row,
              orders: kaspi.salesTotalCount,
              lshopAmount: kaspi.salesAmountTotal,
              joyAmount: null,
            }
          }

          return {
            ...row,
            orders: 0,
            lshopAmount: 0,
            joyAmount: null,
          }
        }

        if (row.id === 'satu-halyk') {
          const satuOrders = satu?.salesTotalCount ?? 0
          const halykOrders = halyk?.salesTotalCount ?? 0
          return {
            ...row,
            orders: satuOrders + halykOrders,
            lshopAmount: satu?.salesAmountTotal ?? 0,
            joyAmount: halyk ? halyk.salesAmountTotal : null,
          }
        }

        return row
      })

      setSalesRows(nextRows)
      writeStoredJsonValue('lshop.accounting.salesRows', nextRows)
      setAccountingReportReady((current) => ({ ...current, sales: false }))
      setNotice(
        halykResult.status === 'rejected'
          ? `Отчет продаж обновлен за ${periodLabel} без Halyk.`
          : `Отчет продаж обновлен за ${periodLabel}.`,
      )
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Не удалось обновить отчет продаж.')
    } finally {
      setSalesReportLoading(false)
    }
  }

  function buildAccountingRowsForTab(reportType: AccountingPrototypeTab) {
    if (reportType === 'materials') {
      const header = [
        'Раздел',
        'Наименование',
        'Норма',
        'Наличие',
        'Итого',
        'В пути',
        'Заявка',
        ...materialColumns.map((column) => column.label),
        'Заказать / комментарий',
      ]
      return [
        [`Отчет материалов за ${materialsReportDate}`],
        header,
        ...materials.map((row) => [
          row.category,
          row.name,
          String(row.norm),
          String(row.available),
          String(row.available - row.norm),
          String(row.inTransit),
          String(row.request),
          ...materialColumns.map((column) => row.customFields?.[column.id] ?? ''),
          row.orderNote,
        ]),
      ]
    }

    return [
      [`Отчет продаж за ${getSalesReportPeriodLabel()}`],
      ['Канал', 'Заказы', 'LShop', 'Joy', 'Всего'],
      ...salesRows.map((row) => [
        row.channel,
        String(row.orders),
        String(row.lshopAmount),
        row.joyAmount === null ? '-' : String(row.joyAmount),
        String(row.lshopAmount + (row.joyAmount ?? 0)),
      ]),
      [],
      ['Всего заказов', String(salesSummary.orders)],
      ['LShop', String(salesSummary.lshopAmount)],
      ['JOY Mart', hasAnyJoySalesAmount ? String(salesSummary.joyAmount) : '-'],
      ['Итог продаж', String(salesSummary.finalAmount)],
      ['Качество работы магазина', manualSalesFields.quality],
      ['Сумма возвратов за предыдущий день', String(manualSalesFields.previousReturns)],
      ['Отмены покупателями', String(manualSalesFields.buyerCancels)],
      ['Сумма отмен', String(manualSalesFields.buyerCancelAmount)],
      ['Отмены менеджерами', String(manualSalesFields.managerCancels)],
      ['Новые позиции Kaspi', String(manualSalesFields.newKaspiPositions)],
      ['Новые позиции Satu', String(manualSalesFields.newSatuPositions)],
      ['Руководитель', manualSalesFields.responsible],
      ['Менеджер', manualSalesFields.manager],
      ['Водитель', manualSalesFields.driver],
      ['Комментарий', manualSalesFields.comment],
    ]
  }

  async function downloadAccountingReport() {
    const rows = buildAccountingRowsForTab(activeAccountingTab)
    const reportDate = activeAccountingTab === 'sales' ? getSalesReportFileDate() : materialsReportDate
    const reportName = activeAccountingTab === 'sales' ? 'sales' : 'materials'
    const response = await fetch('/api/accounting/export', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sheetName: activeAccountingTab === 'sales' ? 'Sales' : 'Materials',
        fileName: reportName + '-' + reportDate + '.xlsx',
        rows,
      }),
    })

    if (!response.ok) {
      setNotice(getApiErrorMessage(await response.text(), 'Не удалось скачать Excel.'))
      return
    }

    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = reportName + '-' + reportDate + '.xlsx'
    document.body.append(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
    setNotice('Excel сформирован и скачан.')
  }

  async function sendAccountingReportToTelegram() {
    if (!accountingReportReady[activeAccountingTab]) {
      setNotice('Сначала сформируйте Excel и проверьте отчет перед отправкой.')
      return
    }

    setNotice('Отправляем отчет в Telegram...')
    const rows = buildAccountingRowsForTab(activeAccountingTab)
    const reportDate = activeAccountingTab === 'sales' ? getSalesReportFileDate() : materialsReportDate
    const reportName = activeAccountingTab === 'sales' ? 'sales' : 'materials'
    const response = await fetch('/api/accounting/telegram/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sheetName: activeAccountingTab === 'sales' ? 'Sales' : 'Materials',
        fileName: reportName + '-' + reportDate + '.xlsx',
        reportType: activeAccountingTab,
        rows,
      }),
    })

    if (!response.ok) {
      setNotice(getApiErrorMessage(await response.text(), 'Не удалось отправить отчет в Telegram.'))
      return
    }

    const result = (await response.json()) as { sent?: number; recipients?: number }
    const sent = result.sent ?? 0
    const recipients = result.recipients ?? 0
    setNotice(
      recipients === 0
        ? 'Нет получателей: включите нужную галочку отчетности в Интеграции -> Оповещения.'
        : `Отчет отправлен в Telegram: ${sent} из ${recipients}.`,
    )
  }

  return (
    <section className="tab-panel accounting-panel">
      <div className="section-title">
        <div>
          <h2>Учет / Отчетность</h2>
          <p>Локальный прототип отчетов для директора: материалы заполняются вручную, продажи считаются из полей.</p>
        </div>
      </div>

      <div className="inner-tabs">
        {[
          ['materials', 'Материалы'],
          ['sales', 'Продажи'],
        ].map(([id, label]) => (
          <button
            type="button"
            key={id}
            className={activeAccountingTab === id ? 'active' : ''}
            onClick={() => setActiveAccountingTab(id as AccountingPrototypeTab)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="accounting-tab-actions">
        <strong>{activeAccountingTab === 'materials' ? 'Отчет материалов' : 'Отчет продаж'}</strong>
        <span className="section-actions">
          <button type="button" className="header-action" onClick={buildAccountingReport}>
            {activeAccountingTab === 'materials' ? 'Сформировать Excel материалов' : 'Сформировать Excel продаж'}
          </button>
          {accountingReportReady[activeAccountingTab] && (
            <button type="button" className="header-action secondary" onClick={() => void downloadAccountingReport()}>
              {activeAccountingTab === 'materials' ? 'Скачать Excel материалов' : 'Скачать Excel продаж'}
            </button>
          )}
          <button type="button" className="header-action green" onClick={() => void sendAccountingReportToTelegram()}>
            {activeAccountingTab === 'materials' ? 'Отправить материалы в Telegram' : 'Отправить продажи в Telegram'}
          </button>
        </span>
      </div>

      {notice && <div className="accounting-notice">{notice}</div>}

      {activeAccountingTab === 'materials' && (
        <>
          <div className="toolbar-row accounting-toolbar">
            <label>
              <span>С</span>
              <input type="date" value={materialsReportDate} onChange={(event) => setMaterialsReportDate(event.target.value)} />
            </label>
            <label className="accounting-filter-field">
              <span>Фильтр</span>
              <input
                value={materialFilter}
                placeholder="Раздел, наименование, комментарий"
                onChange={(event) => setMaterialFilter(event.target.value)}
              />
            </label>
            <label className="accounting-add-section">
              <span>Новый раздел</span>
              <input
                value={newMaterialSectionName}
                placeholder="Например: бумага, текстиль, жетоны"
                onChange={(event) => setNewMaterialSectionName(event.target.value)}
              />
            </label>
            <button type="button" onClick={addMaterialSection}>
              Добавить раздел
            </button>
            <button type="button" className="secondary accounting-save-button" onClick={() => persistAccountingChanges()}>
              Сохранить изменения
            </button>
          </div>

          <div className="accounting-metrics">
            <span><small>Позиций</small><strong>{materialSummary.total}</strong></span>
            <span><small>Ниже нормы</small><strong>{materialSummary.shortages}</strong></span>
            <span><small>К заявке</small><strong>{materialSummary.requestTotal}</strong></span>
            <span className={materialSummary.critical > 0 ? 'danger' : ''}><small>Критично</small><strong>{materialSummary.critical}</strong></span>
          </div>

          <div className="accounting-material-sections">
            {materialGroups.length === 0 && (
              <div className="empty-state">По фильтру ничего не найдено.</div>
            )}
            {materialGroups.map((group) => (
              <details className="accounting-material-section" key={group.category}>
                <summary>
                  <span>
                    <strong>{group.category}</strong>
                    <small>{group.rows.length} позиций</small>
                  </span>
                  <span>Ниже нормы: {group.shortages}</span>
                  <span>К заявке: {group.requestTotal}</span>
                </summary>
                <div className="accounting-material-section-actions">
                  <button type="button" onClick={() => addMaterialRow(group.category)}>
                    Добавить строку в раздел
                  </button>
                </div>
                <div className="data-table accounting-material-table">
                  <div className="table-row table-head" style={{ gridTemplateColumns: materialGridTemplate, minWidth: materialGridMinWidth }}>
                    <span>Наименование</span><span>Норма</span><span>Наличие</span><span>Итого</span><span>В пути</span><span>Заявка</span>
                    {materialColumns.map((column) => (
                      <span key={column.id}>{column.label}</span>
                    ))}
                    <span>Заказать / комментарий</span><span>Действия</span>
                  </div>
                  {group.rows.map((row) => {
                    const total = row.available - row.norm
                    const materialPreviewUrl = (row.previewUrl ?? '').trim()
                    return (
                      <div className="table-row accounting-material-row" key={row.id} style={{ gridTemplateColumns: materialGridTemplate, minWidth: materialGridMinWidth }}>
                        <span data-label="Наименование" className="accounting-material-name-cell">
                          <span className="accounting-material-name-hover">
                            <input value={row.name} onChange={(event) => updateMaterial(row.id, { name: event.target.value })} />
                            {materialPreviewUrl && (
                              <span className="accounting-material-preview-popover" role="tooltip">
                                <img src={materialPreviewUrl} alt={`Превью ${row.name}`} />
                              </span>
                            )}
                          </span>
                          <input
                            className="accounting-material-category-input"
                            value={row.category}
                            placeholder="Раздел"
                            onChange={(event) => updateMaterial(row.id, { category: event.target.value })}
                          />
                          <input
                            className="accounting-material-preview-input"
                            value={row.previewUrl ?? ''}
                            placeholder="Ссылка на превью"
                            onChange={(event) => updateMaterial(row.id, { previewUrl: event.target.value })}
                          />
                        </span>
                        <span data-label="Норма"><input type="number" value={row.norm} onChange={(event) => updateMaterial(row.id, { norm: toNumber(event.target.value) })} /></span>
                        <span data-label="Наличие"><input type="number" value={row.available} onChange={(event) => updateMaterial(row.id, { available: toNumber(event.target.value) })} /></span>
                        <span data-label="Итого" className={total < 0 ? 'accounting-negative' : 'accounting-positive'}>{total}</span>
                        <span data-label="В пути"><input type="number" value={row.inTransit} onChange={(event) => updateMaterial(row.id, { inTransit: toNumber(event.target.value) })} /></span>
                        <span data-label="Заявка"><input type="number" value={row.request} onChange={(event) => updateMaterial(row.id, { request: toNumber(event.target.value) })} /></span>
                        {materialColumns.map((column) => (
                          <span data-label={column.label} key={column.id}>
                            <input
                              value={row.customFields?.[column.id] ?? ''}
                              placeholder={column.label}
                              onChange={(event) => updateMaterialCustomField(row.id, column.id, event.target.value)}
                            />
                          </span>
                        ))}
                        <span data-label="Заказать"><input value={row.orderNote} placeholder="Что заказать / комментарий" onChange={(event) => updateMaterial(row.id, { orderNote: event.target.value })} /></span>
                        <span data-label="Действия" className="accounting-row-save-cell">
                          <button type="button" className="secondary accounting-row-save-button" onClick={() => saveAccountingMaterialRow(row)}>
                            Сохранить
                          </button>
                        </span>
                      </div>
                    )
                  })}
                </div>
              </details>
            ))}
          </div>

          <div className="data-table accounting-material-table accounting-material-table-legacy">
            <div className="table-row table-head" style={{ gridTemplateColumns: materialGridTemplate, minWidth: materialGridMinWidth }}>
              <span>Раздел</span><span>Наименование</span><span>Норма</span><span>Наличие</span><span>Итого</span><span>В пути</span><span>Заявка</span>
              {materialColumns.map((column) => (
                <span key={column.id}>{column.label}</span>
              ))}
              <span>Заказать / комментарий</span><span>Действия</span>
            </div>
            {materials.map((row) => {
              const total = row.available - row.norm
              return (
                <div className="table-row accounting-material-row" key={row.id} style={{ gridTemplateColumns: materialGridTemplate, minWidth: materialGridMinWidth }}>
                  <span data-label="Раздел"><input value={row.category} onChange={(event) => updateMaterial(row.id, { category: event.target.value })} /></span>
                  <span data-label="Наименование"><input value={row.name} onChange={(event) => updateMaterial(row.id, { name: event.target.value })} /></span>
                  <span data-label="Норма"><input type="number" value={row.norm} onChange={(event) => updateMaterial(row.id, { norm: toNumber(event.target.value) })} /></span>
                  <span data-label="Наличие"><input type="number" value={row.available} onChange={(event) => updateMaterial(row.id, { available: toNumber(event.target.value) })} /></span>
                  <span data-label="Итого" className={total < 0 ? 'accounting-negative' : 'accounting-positive'}>{total}</span>
                  <span data-label="В пути"><input type="number" value={row.inTransit} onChange={(event) => updateMaterial(row.id, { inTransit: toNumber(event.target.value) })} /></span>
                  <span data-label="Заявка"><input type="number" value={row.request} onChange={(event) => updateMaterial(row.id, { request: toNumber(event.target.value) })} /></span>
                  {materialColumns.map((column) => (
                    <span data-label={column.label} key={column.id}>
                      <input
                        value={row.customFields?.[column.id] ?? ''}
                        placeholder={column.label}
                        onChange={(event) => updateMaterialCustomField(row.id, column.id, event.target.value)}
                      />
                    </span>
                  ))}
                  <span data-label="Заказать"><input value={row.orderNote} placeholder="Что заказать / комментарий" onChange={(event) => updateMaterial(row.id, { orderNote: event.target.value })} /></span>
                  <span data-label="Действия" className="accounting-row-save-cell">
                    <button type="button" className="secondary accounting-row-save-button" onClick={() => saveAccountingMaterialRow(row)}>
                      Сохранить
                    </button>
                  </span>
                </div>
              )
            })}
          </div>
          <div className="accounting-bottom-actions">
            <button type="button" className="secondary accounting-save-button" onClick={() => persistAccountingChanges()}>
              Сохранить изменения
            </button>
          </div>
        </>
      )}

      {activeAccountingTab === 'sales' && (
        <>
          <div className="toolbar-row accounting-toolbar">
            <label>
              <span>С</span>
              <input type="date" value={salesReportDateFrom} onChange={(event) => setSalesReportDateFrom(event.target.value)} />
            </label>
            <label>
              <span>По</span>
              <input type="date" value={salesReportDateTo} onChange={(event) => setSalesReportDateTo(event.target.value)} />
            </label>
            <label>
              <span>Качество работы магазина</span>
              <select value={manualSalesFields.quality} onChange={(event) => setManualSalesFields((current) => ({ ...current, quality: event.target.value }))}>
                <option>Отлично</option><option>Хорошо</option><option>Нормально</option><option>Плохо</option>
              </select>
            </label>
            <button type="button" className="secondary accounting-save-button" onClick={() => void refreshSalesAccountingReport()} disabled={salesReportLoading}>
              {salesReportLoading ? 'Обновляем...' : 'Обновить отчет'}
            </button>
          </div>

          <div className="accounting-metrics">
            <span><small>Всего заказов</small><strong>{salesSummary.orders}</strong></span>
            <span><small>L-Shop</small><strong>{formatMoney(salesSummary.lshopAmount, 'KZT')}</strong></span>
            <span><small>JOY Mart</small><strong>{hasAnyJoySalesAmount ? formatMoney(salesSummary.joyAmount, 'KZT') : '-'}</strong></span>
            <span><small>Итог продаж</small><strong>{formatMoney(salesSummary.finalAmount, 'KZT')}</strong></span>
          </div>

          <div className="data-table accounting-sales-table">
            <div className="table-row table-head">
              <span>Канал</span><span>Заказы</span><span>L-Shop</span><span>JOY Mart</span><span>Всего</span><span>Действия</span>
            </div>
            {salesRows.map((row) => (
              <div className="table-row accounting-sales-row" key={row.id}>
                <span data-label="Канал">{row.channel}</span>
                <span data-label="Заказы"><input type="number" value={row.orders} onChange={(event) => updateSalesRow(row.id, { orders: toNumber(event.target.value) })} /></span>
                <span data-label="L-Shop"><input type="number" value={row.lshopAmount} onChange={(event) => updateSalesRow(row.id, { lshopAmount: toNumber(event.target.value) })} /></span>
                <span data-label="JOY Mart"><input type="number" value={row.joyAmount ?? ''} placeholder="-" onChange={(event) => updateSalesRow(row.id, { joyAmount: toOptionalNumber(event.target.value) })} /></span>
                <span data-label="Всего">{formatMoney(row.lshopAmount + (row.joyAmount ?? 0), 'KZT')}</span>
                <span data-label="Действия" className="accounting-row-save-cell">
                  <button type="button" className="secondary accounting-row-save-button" onClick={() => saveAccountingSalesRow(row)}>
                    Сохранить
                  </button>
                </span>
              </div>
            ))}
          </div>

          <div className="accounting-manual-grid">
            <label><span>Сумма возвратов за предыдущий день</span><input type="number" value={manualSalesFields.previousReturns} onChange={(event) => setManualSalesFields((current) => ({ ...current, previousReturns: toNumber(event.target.value) }))} /></label>
            <label><span>Отмены покупателями</span><input type="number" value={manualSalesFields.buyerCancels} onChange={(event) => setManualSalesFields((current) => ({ ...current, buyerCancels: toNumber(event.target.value) }))} /></label>
            <label><span>Сумма отмен</span><input type="number" value={manualSalesFields.buyerCancelAmount} onChange={(event) => setManualSalesFields((current) => ({ ...current, buyerCancelAmount: toNumber(event.target.value) }))} /></label>
            <label><span>Отмены менеджерами</span><input type="number" value={manualSalesFields.managerCancels} onChange={(event) => setManualSalesFields((current) => ({ ...current, managerCancels: toNumber(event.target.value) }))} /></label>
            <label><span>Новые позиции Kaspi</span><input type="number" value={manualSalesFields.newKaspiPositions} onChange={(event) => setManualSalesFields((current) => ({ ...current, newKaspiPositions: toNumber(event.target.value) }))} /></label>
            <label><span>Новые позиции Satu</span><input type="number" value={manualSalesFields.newSatuPositions} onChange={(event) => setManualSalesFields((current) => ({ ...current, newSatuPositions: toNumber(event.target.value) }))} /></label>
            <label><span>Руководитель</span><input value={manualSalesFields.responsible} onChange={(event) => setManualSalesFields((current) => ({ ...current, responsible: event.target.value }))} /></label>
            <label><span>Менеджер</span><input value={manualSalesFields.manager} onChange={(event) => setManualSalesFields((current) => ({ ...current, manager: event.target.value }))} /></label>
            <label><span>Водитель</span><input value={manualSalesFields.driver} onChange={(event) => setManualSalesFields((current) => ({ ...current, driver: event.target.value }))} /></label>
            <label className="accounting-wide-field"><span>Комментарий вручную</span><textarea value={manualSalesFields.comment} onChange={(event) => setManualSalesFields((current) => ({ ...current, comment: event.target.value }))} /></label>
          </div>
          <div className="accounting-bottom-actions">
            <button type="button" className="secondary accounting-save-button" onClick={() => persistAccountingChanges()}>
              Сохранить изменения
            </button>
          </div>
        </>
      )}

    </section>
  )
}

function App() {
  const [token, setToken] = useState(() => localStorage.getItem('authToken') ?? '')
  const [user, setUser] = useState<User | null>(() => {
    const value = localStorage.getItem('authUser')
    return value ? JSON.parse(value) : null
  })
  const [users, setUsers] = useState<User[]>([])
  const [usersLoadError, setUsersLoadError] = useState('')
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([])
  const [auditSearch, setAuditSearch] = useState('')
  const [auditDateFrom, setAuditDateFrom] = useState('')
  const [auditDateTo, setAuditDateTo] = useState('')
  const [auditUserId, setAuditUserId] = useState('')
  const [auditStatus, setAuditStatus] = useState('')
  const [systemHealth, setSystemHealth] = useState<SystemHealth | null>(null)
  const [systemHealthStatus, setSystemHealthStatus] = useState('')
  const [ozonSettingsData, setOzonSettingsData] = useState<OzonIntegrationSettings | null>(null)
  const [ozonSettingsForm, setOzonSettingsForm] = useState({ clientId: '', apiKey: '', baseUrl: 'https://api-seller.ozon.ru' })
  const [ozonSettingsStatus, setOzonSettingsStatus] = useState('')
  const [ozonSettingsSaving, setOzonSettingsSaving] = useState(false)
  const [telegramIntegration, setTelegramIntegration] = useState<TelegramIntegrationInfo | null>(null)
  const [telegramEvents, setTelegramEvents] = useState<TelegramNotificationEvent[]>([])
  const [telegramStatus, setTelegramStatus] = useState('')
  const [backupFiles, setBackupFiles] = useState<BackupFile[]>([])
  const [backupStatus, setBackupStatus] = useState('')
  const [activeTab, setActiveTab] = useState<TabId>(() => readStoredUiValue('lshop.activeTab', tabIds, 'home'))
  const [shopRegion, setShopRegion] = useState<ShopRegion>(() => readShopRegion())
  const [kzMarketplace, setKzMarketplace] = useState<KzMarketplace>(() => readKzMarketplace())
  const [kzTaskMarketplace, setKzTaskMarketplace] = useState<KzMarketplace>(() => readKzMarketplace())
  const [isLoading, setIsLoading] = useState(true)
  const [loginError, setLoginError] = useState('')
  const [ozonStatus, setOzonStatus] = useState('')
  const [ozonProducts, setOzonProducts] = useState<OzonProduct[]>([])
  const [productCostModalProduct, setProductCostModalProduct] = useState<OzonProduct | null>(null)
  const [productCostForm, setProductCostForm] = useState({
    useIndividualCost: true,
    costTypeId: '',
    isPurchased: false,
    purchaseCost: '',
    packagingCost: '',
    productionCost: '',
  })
  const [productCostTypes, setProductCostTypes] = useState<ProductCostType[]>([])
  const [productCostTypeForm, setProductCostTypeForm] = useState({
    name: '',
    isPurchased: false,
    purchaseCost: '',
    packagingCost: '',
    productionCost: '',
  })
  const [productCostTypeEditForm, setProductCostTypeEditForm] = useState({
    id: '',
    name: '',
    isPurchased: false,
    purchaseCost: '',
    packagingCost: '',
    productionCost: '',
  })
  const [productCostTypeEditModalOpen, setProductCostTypeEditModalOpen] = useState(false)
  const [productsInnerTab, setProductsInnerTab] = useState<'catalog' | 'costTypes'>('catalog')
  const [productCostProfiles, setProductCostProfiles] = useState<ProductCostProfile[]>([])
  const [expandedProductCostTypeId, setExpandedProductCostTypeId] = useState<string | null>(null)
  const [productCostTypesStatus, setProductCostTypesStatus] = useState('')
  const [productCostTypeSaving, setProductCostTypeSaving] = useState(false)
  const [productCostStatus, setProductCostStatus] = useState('')
  const [productCostSaving, setProductCostSaving] = useState(false)
  const [productSearch, setProductSearch] = useState('')
  const [productStatusFilter, setProductStatusFilter] = useState<'all' | 'selling' | 'ready' | 'archived'>('all')
  const [kzProductsLoading, setKzProductsLoading] = useState(false)
  const [kzProductsLoadingAll, setKzProductsLoadingAll] = useState(false)
  const [kzProductsPageFull, setKzProductsPageFull] = useState<Record<KzMarketplace, boolean>>({
    kaspi: false,
    satu: false,
    halyk: false,
  })
  const [stockStatus, setStockStatus] = useState('')
  const [ozonStocks, setOzonStocks] = useState<OzonStock[]>([])
  const [stockSearch, setStockSearch] = useState('')
  const [stockSortDirection, setStockSortDirection] = useState<'desc' | 'asc' | null>(null)
  const [priceStatus, setPriceStatus] = useState('')
  const [editingPrices, setEditingPrices] = useState<Record<number, string>>({})
  const [analyticsStatus, setAnalyticsStatus] = useState('')
  const [kzUnsoldProducts, setKzUnsoldProducts] = useState<OzonAnalytics['unsoldProducts']>([])
  const [kzUnsoldTotal, setKzUnsoldTotal] = useState(0)
  const [rfUnsoldProducts, setRfUnsoldProducts] = useState<OzonAnalytics['unsoldProducts']>([])
  const [rfUnsoldTotal, setRfUnsoldTotal] = useState(0)
  const [rfUnsoldTimestamp, setRfUnsoldTimestamp] = useState('')
  const [analytics, setAnalytics] = useState<OzonAnalytics | null>(null)
  const [analyticsSnapshot, setAnalyticsSnapshot] = useState<OzonAnalyticsSnapshot | null>(null)
  const [homeAnalytics, setHomeAnalytics] = useState<OzonAnalytics | null>(null)
  const [homeAnalyticsStatus, setHomeAnalyticsStatus] = useState('')
  const [homeKzAnalytics, setHomeKzAnalytics] = useState<Record<KzMarketplace, OzonAnalytics | null>>({
    kaspi: null,
    satu: null,
    halyk: null,
  })
  const [homeKzAnalyticsStatus, setHomeKzAnalyticsStatus] = useState<Record<KzMarketplace, string>>({
    kaspi: '',
    satu: '',
    halyk: '',
  })
  const [analyticsSubTab, setAnalyticsSubTab] = useState<AnalyticsSubTab>(() =>
    readStoredUiValue('lshop.analyticsSubTab', analyticsSubTabs, 'summary'),
  )
  const [analyticsDateFrom, setAnalyticsDateFrom] = useState(getDefaultAnalyticsDateFrom)
  const [analyticsDateTo, setAnalyticsDateTo] = useState(getDefaultAnalyticsDateTo)
  const [productionAnalyticsDateFrom, setProductionAnalyticsDateFrom] = useState(getDefaultAnalyticsDateFrom)
  const [productionAnalyticsDateTo, setProductionAnalyticsDateTo] = useState(getDefaultAnalyticsDateTo)
  const [productionAnalyticsUserId, setProductionAnalyticsUserId] = useState('')
  const [productionAnalyticsAssignees, setProductionAnalyticsAssignees] = useState<ProductionAnalyticsAssignee[]>([])
  const [productionAnalyticsReport, setProductionAnalyticsReport] = useState<ProductionAnalyticsReport | null>(null)
  const [productionAnalyticsStatus, setProductionAnalyticsStatus] = useState('')
  const [productionAnalyticsExpandedUserKey, setProductionAnalyticsExpandedUserKey] = useState<string | null>(null)
  const [productionAnalyticsExpandedTaskId, setProductionAnalyticsExpandedTaskId] = useState<string | null>(null)
  const [productionAnalyticsEditingTask, setProductionAnalyticsEditingTask] = useState<ProductionTask | null>(null)
  const [analyticsRowSearch, setAnalyticsRowSearch] = useState('')
  const [analyticsStatusFilter, setAnalyticsStatusFilter] = useState<
    'all' | 'awaiting_deliver' | 'delivering' | 'delivered' | 'cancelled'
  >('all')
  const [unsoldProductStatusFilter, setUnsoldProductStatusFilter] = useState<'all' | 'selling' | 'ready'>('all')
  const [expandedAnalyticsProductKeys, setExpandedAnalyticsProductKeys] = useState<Record<string, boolean>>({})
  const [productionSearch, setProductionSearch] = useState('')
  const [productionSubTab, setProductionSubTab] = useState<ProductionSubTab>(() =>
    readStoredUiValue('lshop.productionSubTab', productionSubTabs, 'products'),
  )
  const [productionTaskAssigneeFilter, setProductionTaskAssigneeFilter] = useState('')
  const [productionTaskTypeFilter, setProductionTaskTypeFilter] = useState<'all' | 'design' | 'production'>('all')
  const [taskFormMode, setTaskFormMode] = useState<TaskFormMode>(() =>
    getDefaultTaskFormMode(readShopRegion(), undefined, readKzMarketplace()),
  )
  const [taskEditorKind, setTaskEditorKind] = useState<ProductionTaskEditorKind>('production')
  const [productionCatalogTab, setProductionCatalogTab] = useState<ProductionCatalogTab>(() =>
    readShopRegion() === 'rf' ? 'ozon' : readKzMarketplace(),
  )
  const [kzProducts, setKzProducts] = useState<Record<KzMarketplace, OzonProduct[]>>({
    kaspi: [],
    satu: [],
    halyk: [],
  })
  const [kzCatalogSummary, setKzCatalogSummary] = useState<
    Record<KzMarketplace, { total: number; selling: number; ready: number; archived: number } | null>
  >({
    kaspi: null,
    satu: null,
    halyk: null,
  })
  const [kzStocks, setKzStocks] = useState<Record<KzMarketplace, OzonStock[]>>({
    kaspi: [],
    satu: [],
    halyk: [],
  })
  const [kzProductsStatus, setKzProductsStatus] = useState<Record<KzMarketplace, string>>({
    kaspi: '',
    satu: '',
    halyk: '',
  })
  const [kzSatuSyncStatus, setKzSatuSyncStatus] = useState<{
    status: string
    lastSyncStartedAt: string | null
    lastSyncCompletedAt: string | null
    totalProducts: number
    syncedProducts: number
    errorMessage: string | null
    isFullSync: boolean
    localProductCount: number
  } | null>(null)
  const [kzProductPage, setKzProductPage] = useState(0)
  const kzProductPageSize = 50
  const kzProductSearchDebounceRef = useRef<number | null>(null)
  const [kzStocksStatus, setKzStocksStatus] = useState<Record<KzMarketplace, string>>({
    kaspi: '',
    satu: '',
    halyk: '',
  })
  const [kzIntegrationSettings, setKzIntegrationSettings] = useState<Record<KzMarketplace, KzIntegrationSettings | null>>({
    kaspi: null,
    satu: null,
    halyk: null,
  })
  const [kzIntegrationForms, setKzIntegrationForms] = useState<Record<KzMarketplace, { merchantId: string; apiKey: string }>>({
    kaspi: { merchantId: '', apiKey: '' },
    satu: { merchantId: '', apiKey: '' },
    halyk: { merchantId: '', apiKey: '' },
  })
  const [kzIntegrationStatus, setKzIntegrationStatus] = useState<Record<KzMarketplace, string>>({
    kaspi: '',
    satu: '',
    halyk: '',
  })
  const [kzIntegrationSaving, setKzIntegrationSaving] = useState<Record<KzMarketplace, boolean>>({
    kaspi: false,
    satu: false,
    halyk: false,
  })
  const [editorNovinkaOfferId, setEditorNovinkaOfferId] = useState('')
  const [editorOzonProductId, setEditorOzonProductId] = useState('')
  const [productEditorStatus, setProductEditorStatus] = useState('')
  const [productEditorSaving, setProductEditorSaving] = useState(false)
  const [draftNovinkaItems, setDraftNovinkaItems] = useState<DraftNovinkaItem[]>([])
  const [novinkaProductName, setNovinkaProductName] = useState('')
  const [novinkaProductLink, setNovinkaProductLink] = useState('')
  const [novinkaTaskMarketplace, setNovinkaTaskMarketplace] = useState<NovinkaMarketplace>(() =>
    readShopRegion() === 'rf' ? 'ozon' : readKzMarketplace(),
  )
  const [selectedNovinkaOfferId, setSelectedNovinkaOfferId] = useState('')
  const [productionFiles, setProductionFiles] = useState<ProductionFile[]>([])
  const [productionFilePaths, setProductionFilePaths] = useState<ProductionFilePath[]>([])
  const [productionFilesModal, setProductionFilesModal] = useState<{
    productName: string
    files: ProductionFile[]
  } | null>(null)
  const [productionTasks, setProductionTasks] = useState<ProductionTask[]>([])
  const [productionDesigners, setProductionDesigners] = useState<User[]>([])
  const [taskSearch, setTaskSearch] = useState('')
  const [taskUrgencyFilter, setTaskUrgencyFilter] = useState<'all' | 'urgent' | 'normal'>('all')
  const [archiveTaskStatusFilter, setArchiveTaskStatusFilter] = useState<'all' | 'Completed' | 'Cancelled'>('all')
  const [productionStatus, setProductionStatus] = useState('')
  const [taskStatus, setTaskStatus] = useState('')
  const [taskFormStatus, setTaskFormStatus] = useState('')
  const [taskFormSaving, setTaskFormSaving] = useState(false)
  const [selectedTaskProductId, setSelectedTaskProductId] = useState('')
  const [selectedTaskNovinkaOfferId, setSelectedTaskNovinkaOfferId] = useState('')
  const [taskQuantity, setTaskQuantity] = useState('')
  const [taskNovinkaQuantity, setTaskNovinkaQuantity] = useState('')
  const [showCreateTaskModal, setShowCreateTaskModal] = useState(false)
  const [showCreateNovinkaTaskModal, setShowCreateNovinkaTaskModal] = useState(false)
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [taskIsUrgent, setTaskIsUrgent] = useState(false)
  const [taskDueAt, setTaskDueAt] = useState('')
  const [cancelTaskId, setCancelTaskId] = useState<string | null>(null)
  const [cancelTaskComment, setCancelTaskComment] = useState('')
  const [transferDesignerItem, setTransferDesignerItem] = useState<{
    task: ProductionTask
    item: ProductionTaskItem
  } | null>(null)
  const [transferDesignerUserId, setTransferDesignerUserId] = useState('')
  const [draftTaskItems, setDraftTaskItems] = useState<DraftTaskItem[]>([])
  const [actualQuantities, setActualQuantities] = useState<Record<string, string>>({})
  const [supplySubTab, setSupplySubTab] = useState<SupplySubTab>(() =>
    readStoredUiValue('lshop.supplySubTab', supplySubTabs, 'create'),
  )
  const [supplies, setSupplies] = useState<Supply[]>([])
  const [supplySearch, setSupplySearch] = useState('')
  const [supplyStatusFilter, setSupplyStatusFilter] = useState<'all' | SupplyStatus>('all')
  const [supplyAnalytics, setSupplyAnalytics] = useState<SupplyAnalyticsItem[]>([])
  const [ozonSupplyShipments, setOzonSupplyShipments] = useState<OzonSupplyShipmentQuantity[]>([])
  const [supplyStatus, setSupplyStatus] = useState('')
  const [supplyProductId, setSupplyProductId] = useState('')
  const [supplyQuantity, setSupplyQuantity] = useState('')
  const [reserveQuantity, setReserveQuantity] = useState('')
  const [supplyMaterialName, setSupplyMaterialName] = useState('')
  const [supplyMaterialQuantity, setSupplyMaterialQuantity] = useState('')
  const [supplyMaterialKind, setSupplyMaterialKind] = useState<Exclude<SupplyItemKind, 'Product'>>('Consumable')
  const [draftSupplyItems, setDraftSupplyItems] = useState<DraftSupplyItem[]>([])
  const [replaceProducts, setReplaceProducts] = useState<Record<string, string>>({})
  const [editingSupplyId, setEditingSupplyId] = useState<string | null>(null)
  const [editSupplyItems, setEditSupplyItems] = useState<DraftSupplyItem[]>([])
  const [editSupplyProductId, setEditSupplyProductId] = useState('')
  const [editSupplyQuantity, setEditSupplyQuantity] = useState('')
  const [editSupplyShippingCost, setEditSupplyShippingCost] = useState('')
  const [editReserveQuantity, setEditReserveQuantity] = useState('')
  const [editSupplyMaterialName, setEditSupplyMaterialName] = useState('')
  const [editSupplyMaterialQuantity, setEditSupplyMaterialQuantity] = useState('')
  const [editSupplyMaterialKind, setEditSupplyMaterialKind] =
    useState<Exclude<SupplyItemKind, 'Product'>>('Consumable')
  const [analyticsProductKey, setAnalyticsProductKey] = useState('')
  const [showSupplyFboRemaining, setShowSupplyFboRemaining] = useState(false)
  const [showSupplyFboDefects, setShowSupplyFboDefects] = useState(false)
  const [supplyFboDefects, setSupplyFboDefects] = useState<SupplyFboDefect[]>([])
  const [supplyExpenses, setSupplyExpenses] = useState<SupplyExpense[]>([])
  const [supplyExpensesTotal, setSupplyExpensesTotal] = useState(0)
  const [internalSupplyExpenses, setInternalSupplyExpenses] = useState<SupplyExpense[]>([])
  const [internalSupplyExpensesTotal, setInternalSupplyExpensesTotal] = useState(0)
  const [supplyExpenseSearch, setSupplyExpenseSearch] = useState('')
  const [supplyExpenseDateFrom, setSupplyExpenseDateFrom] = useState(getDefaultAnalyticsDateFrom)
  const [supplyExpenseDateTo, setSupplyExpenseDateTo] = useState(getDefaultAnalyticsDateTo)
  const [supplyExpenseName, setSupplyExpenseName] = useState('')
  const [supplyExpenseAmount, setSupplyExpenseAmount] = useState('')
  const [supplyExpenseDate, setSupplyExpenseDate] = useState(getDefaultAnalyticsDateTo)
  const [showSupplyHelp, setShowSupplyHelp] = useState(false)
  const [showCreateSupplyModal, setShowCreateSupplyModal] = useState(false)
  const [shippingCostModalSupply, setShippingCostModalSupply] = useState<Supply | null>(null)
  const [shippingCostDraft, setShippingCostDraft] = useState('')
  const [supplyImportFile, setSupplyImportFile] = useState<File | null>(null)
  const [roleProfiles, setRoleProfiles] = useState<RoleProfile[]>([])
  const [roleProfileEdits, setRoleProfileEdits] = useState<Record<string, RoleProfile>>({})
  const [roleProfilesStatus, setRoleProfilesStatus] = useState('')
  const [userTelegramData, setUserTelegramData] = useState<Record<string, AdminUserTelegram>>({})
  const [userTelegramEvents, setUserTelegramEvents] = useState<Record<string, string[]>>({})
  const [userTelegramEventsKz, setUserTelegramEventsKz] = useState<Record<string, string[]>>({})
  const [userTelegramStatus, setUserTelegramStatus] = useState<Record<string, string>>({})
  const [userReportData, setUserReportData] = useState<Record<string, AdminUserReport>>({})
  const [userReportSections, setUserReportSections] = useState<Record<string, string[]>>({})
  const [userMonthlyReportSections, setUserMonthlyReportSections] = useState<Record<string, string[]>>({})
  const [userReportStatus, setUserReportStatus] = useState<Record<string, string>>({})
  const [reportSections, setReportSections] = useState<ReportSection[]>([])
  const [reportsStatus, setReportsStatus] = useState('')
  const [integrationsSubTab, setIntegrationsSubTab] = useState<'connections' | 'telegram-notifications' | 'telegram-reports'>('connections')
  const [telegramNotificationsRegion, setTelegramNotificationsRegion] = useState<ShopRegion>('rf')
  const [integrationKzMarketplace, setIntegrationKzMarketplace] = useState<KzMarketplace>('satu')
  const [integrationAdminUserId, setIntegrationAdminUserId] = useState('')
  const [profilePasswordForm, setProfilePasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [profileModalUser, setProfileModalUser] = useState<User | null>(null)
  const [profileForm, setProfileForm] = useState({ displayName: '', position: '' })
  const [profileAvatar, setProfileAvatar] = useState<File | null>(null)
  const [profileStatus, setProfileStatus] = useState('')
  const [chatThreads, setChatThreads] = useState<ChatThread[]>([])
  const [chatPickerUsers, setChatPickerUsers] = useState<User[]>([])
  const [selectedChatType, setSelectedChatType] = useState<'user' | 'group'>('user')
  const [selectedChatId, setSelectedChatId] = useState('')
  const [chatGroupDetail, setChatGroupDetail] = useState<{
    id: string
    name: string
    createdByUserId: string
    members: ChatGroupMember[]
  } | null>(null)
  const [showCreateGroupModal, setShowCreateGroupModal] = useState(false)
  const [createGroupHint, setCreateGroupHint] = useState('')
  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupMemberIds, setNewGroupMemberIds] = useState<string[]>([])
  const [showGroupMembersModal, setShowGroupMembersModal] = useState(false)
  const [groupMembersModalState, setGroupMembersModalState] = useState<{
    groupId: string
    loading: boolean
    error: string
    detail: {
      id: string
      name: string
      createdByUserId: string
      members: ChatGroupMember[]
    } | null
  } | null>(null)
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatText, setChatText] = useState('')
  const [chatFile, setChatFile] = useState<File | null>(null)
  const [chatStatus, setChatStatus] = useState('')
  const [showNotifications, setShowNotifications] = useState(false)
  const [seenNewTaskNotificationIds, setSeenNewTaskNotificationIds] = useState<string[]>([])
  const [seenInProgressTaskNotificationIds, setSeenInProgressTaskNotificationIds] = useState<string[]>([])
  const [seenCancelledTaskNotificationIds, setSeenCancelledTaskNotificationIds] = useState<string[]>([])
  const [seenCompletedTaskNotificationIds, setSeenCompletedTaskNotificationIds] = useState<string[]>([])
  const [seenCreatedSupplyIds, setSeenCreatedSupplyIds] = useState<string[]>([])
  const [seenSupplyAnalyticsKeys, setSeenSupplyAnalyticsKeys] = useState<string[]>([])
  const knownNewTaskIdsRef = useRef<Set<string> | null>(null)
  const knownCancelledForCreatorRef = useRef<Set<string> | null>(null)
  const knownNewSupplyIdsRef = useRef<Set<string> | null>(null)
  const productionTaskStatusRef = useRef<Record<string, ProductionTask['status']>>({})
  const knownChatUnreadCountsRef = useRef<Record<string, number> | null>(null)
  const knownChatMessageIdsRef = useRef<Record<string, Set<string>>>({})
  const chatMessagesEndRef = useRef<HTMLDivElement | null>(null)
  const selectedChatTypeRef = useRef<'user' | 'group'>('user')
  const selectedChatIdRef = useRef('')
  const selectedChatKey = `${selectedChatType}:${selectedChatId}`
  const selectedChatKeyRef = useRef('')
  const loadChatThreadsSeqRef = useRef(0)
  const creatingGroupRef = useRef(false)

  useEffect(() => {
    writeStoredUiValue('lshop.activeTab', activeTab)
  }, [activeTab])

  useEffect(() => {
    writeStoredUiValue('lshop.productionSubTab', productionSubTab)
  }, [productionSubTab])

  useEffect(() => {
    writeStoredUiValue('lshop.supplySubTab', supplySubTab)
  }, [supplySubTab])

  useEffect(() => {
    writeStoredUiValue('lshop.analyticsSubTab', analyticsSubTab)
  }, [analyticsSubTab])

  const normalizedProductSearch = productSearch.trim().toLowerCase()
  const activeKzProducts = kzProducts[kzMarketplace]
  const activeKzStocks = kzStocks[kzMarketplace]
  const catalogProductsSource = shopRegion === 'rf' ? ozonProducts : activeKzProducts
  const catalogStocksSource = shopRegion === 'rf' ? ozonStocks : activeKzStocks
  const catalogProductsStatus = shopRegion === 'rf' ? ozonStatus : kzProductsStatus[kzMarketplace]
  const kzMatchedCatalogTotal = useMemo(() => {
    if (shopRegion !== 'kz') {
      return 0
    }

    const summary = kzCatalogSummary[kzMarketplace]
    if (!summary) {
      return 0
    }

    switch (productStatusFilter) {
      case 'selling':
        return summary.selling
      case 'ready':
        return summary.ready
      case 'archived':
        return summary.archived
      default:
        return summary.total
    }
  }, [shopRegion, kzCatalogSummary, kzMarketplace, productStatusFilter])
  const kzHasMoreProducts =
    shopRegion === 'kz' &&
    kzMarketplace !== 'satu' &&
    (catalogProductsSource.length < kzMatchedCatalogTotal || kzProductsPageFull[kzMarketplace])
  const kzSatuHasNextPage =
    shopRegion === 'kz' &&
    kzMarketplace === 'satu' &&
    (kzProductPage + 1) * kzProductPageSize < kzMatchedCatalogTotal
  const catalogStocksStatus = shopRegion === 'rf' ? stockStatus : kzStocksStatus[kzMarketplace]
  const productionLookupProducts =
    shopRegion === 'rf'
      ? ozonProducts
      : activeTab === 'production' && productionSubTab !== 'products'
        ? kzProducts[kzTaskMarketplace]
        : kzProducts[kzMarketplace]
  const productStatusCounts = useMemo(() => {
    if (shopRegion === 'kz') {
      const summary = kzCatalogSummary[kzMarketplace]
      const summaryStatsTotal = (summary?.selling ?? 0) + (summary?.ready ?? 0) + (summary?.archived ?? 0)
      const hasAuthoritativeSummary = Boolean(summary && summary.total > 0 && summaryStatsTotal > 0)

      if (hasAuthoritativeSummary && summary) {
        return {
          all: summary.total,
          selling: summary.selling,
          ready: summary.ready,
          archived: summary.archived,
        }
      }
    }

    const counts = {
      all: catalogProductsSource.length,
      selling: 0,
      ready: 0,
      archived: 0,
    }

    for (const product of catalogProductsSource) {
      const group = getProductStatusGroup(product.status)

      if (group === 'selling') {
        counts.selling++
      } else if (group === 'ready') {
        counts.ready++
      } else if (group === 'archived') {
        counts.archived++
      }
    }

    if (shopRegion === 'kz') {
      const summary = kzCatalogSummary[kzMarketplace]
      if (summary && summary.total > counts.all) {
        counts.all = summary.total
      }
    }

    return counts
  }, [catalogProductsSource, shopRegion, kzCatalogSummary, kzMarketplace])
  const filteredCatalogProducts = [...((
    shopRegion === 'kz' && kzMarketplace === 'satu'
      ? catalogProductsSource
      : shopRegion === 'kz'
        ? catalogProductsSource
        : productStatusFilter !== 'all'
          ? catalogProductsSource.filter((item) => getProductStatusGroup(item.status) === productStatusFilter)
          : catalogProductsSource
  ).filter((item) =>
    shopRegion === 'kz' && kzMarketplace === 'satu'
      ? true
      : normalizedProductSearch
      ? [
          item.productId,
          item.offerId,
          item.sku,
          item.name,
          item.price,
          item.oldPrice,
          item.minPrice,
          item.currencyCode,
          item.status,
          item.productUrl,
        ]
          .filter((value) => value !== undefined && value !== null)
          .some((value) => String(value).toLowerCase().includes(normalizedProductSearch))
      : true,
  ))].sort((left, right) => left.offerId.localeCompare(right.offerId, 'ru'))
  const normalizedTaskSearch = taskSearch.trim().toLowerCase()
  const visibleProductionTasks = useMemo(
    () =>
      productionTasks.filter(
        (task) =>
          isProductionTaskVisibleForUser(task, user?.role, user?.allowedFeatures) &&
          matchesShopRegionTaskType(shopRegion, task.taskType ?? 'Ozon') &&
          (shopRegion === 'rf' ||
            matchesKzProductionMarketplace(task, kzTaskMarketplace, productionFiles)),
      ),
    [productionTasks, user?.role, user?.allowedFeatures, shopRegion, kzTaskMarketplace, productionFiles],
  )
  const canSeeDesignerProductionTasks = canSeeNovinkaProductionTasks(user?.role, user?.allowedFeatures)
  const canSeeOzonProductionTasksFlag = canSeeOzonProductionTasks(user?.role, user?.allowedFeatures)
  const canStartVisibleProductionTask = (task: ProductionTask) =>
    isNovinkaTask(task) ? canSeeDesignerProductionTasks : canSeeOzonProductionTasksFlag
  const roleTaskTableContext =
    canSeeDesignerProductionTasks && canSeeOzonProductionTasksFlag
      ? 'mixed'
      : canSeeDesignerProductionTasks
        ? 'novinka'
        : canSeeOzonProductionTasksFlag
          ? 'ozon'
          : 'mixed'
  const filteredProductionTasks = normalizedTaskSearch
    ? visibleProductionTasks.filter((task) => matchesProductionTask(task, normalizedTaskSearch))
    : visibleProductionTasks
  const allNewProductionTasks = visibleProductionTasks.filter((task) => task.status === 'New' && !task.isArchived)
  const allInProgressProductionTasks = visibleProductionTasks.filter((task) => task.status === 'InProgress' && !task.isArchived)
  const allCancelledProductionTasks = visibleProductionTasks.filter((task) => task.status === 'Cancelled' && !task.isArchived)
  const allCompletedProductionTasks = visibleProductionTasks.filter((task) => task.status === 'Completed' && !task.isArchived)
  const isPackedProductionTask = (task: ProductionTask) => {
    const taskItems = getProductionTaskItems(task)
    return (
      !isNovinkaTask(task) &&
      taskItems.length > 0 &&
      taskItems.every((item) => Boolean(item.packedAt) && !item.packedSupplyId)
    )
  }
  const allReadyToShipProductionTasks = allCompletedProductionTasks.filter(isPackedProductionTask)
  const productionTaskFilterAssignees = useMemo(() => {
    const assignees = new Set<string>()

    for (const task of [...allInProgressProductionTasks, ...allCompletedProductionTasks]) {
      const name = task.assignedUserName?.trim()
      if (name) {
        assignees.add(name)
      }
    }

    return Array.from(assignees).sort((left, right) => left.localeCompare(right, 'ru'))
  }, [allInProgressProductionTasks, allCompletedProductionTasks])
  const matchesProductionTaskListFilters = (task: ProductionTask) => {
    if (productionTaskAssigneeFilter && task.assignedUserName !== productionTaskAssigneeFilter) {
      return false
    }

    if (productionTaskTypeFilter === 'design') {
      return isNovinkaTask(task)
    }

    if (productionTaskTypeFilter === 'production') {
      return !isNovinkaTask(task)
    }

    return true
  }
  const newProductionTasks = filteredProductionTasks.filter((task) => task.status === 'New' && !task.isArchived)
  const filteredNewProductionTasks = sortProductionTasksByUrgency(
    newProductionTasks.filter((task) => {
    if (taskUrgencyFilter === 'urgent') {
      return task.isUrgent
    }

    if (taskUrgencyFilter === 'normal') {
      return !task.isUrgent
    }

    return true
    }),
  )
  const inProgressProductionTasks = sortProductionTasksByUrgency(
    filteredProductionTasks.filter(
      (task) => task.status === 'InProgress' && !task.isArchived && matchesProductionTaskListFilters(task),
    ),
  )
  const cancelledProductionTasks = sortProductionTasksByUrgency(
    filteredProductionTasks.filter((task) => task.status === 'Cancelled' && !task.isArchived),
  )
  const completedProductionTasks = sortProductionTasksByUrgency(
    filteredProductionTasks.filter(
      (task) =>
        task.status === 'Completed' &&
        !task.isArchived &&
        !isPackedProductionTask(task) &&
        matchesProductionTaskListFilters(task),
    ),
  )
  const readyToShipProductionTasks = sortProductionTasksByUrgency(
    filteredProductionTasks.filter((task) => task.status === 'Completed' && !task.isArchived && isPackedProductionTask(task)),
  )
  const archivedProductionTasks = filteredProductionTasks.filter((task) => task.isArchived)
  const filteredArchivedProductionTasks = archivedProductionTasks.filter(
    (task) => archiveTaskStatusFilter === 'all' || task.status === archiveTaskStatusFilter,
  )
  const ozonProductionCatalogItems = useMemo((): ProductionCatalogItem[] => {
    return ozonProducts.map((product) => ({
      offerId: product.offerId,
      ozonProductId: product.productId,
      productName: product.name,
      productLink: product.productUrl ?? '',
      fileCount: productionFiles.filter(
        (file) => file.offerId === product.offerId || file.ozonProductId === product.productId,
      ).length,
    }))
  }, [ozonProducts, productionFiles])
  const buildMarketplaceCatalogItems = (products: OzonProduct[]) =>
    products.map((product) => ({
      offerId: product.offerId,
      ozonProductId: product.productId,
      productName: product.name,
      productLink: product.productUrl ?? '',
      fileCount: productionFiles.filter(
        (file) => file.offerId === product.offerId || file.ozonProductId === product.productId,
      ).length,
    }))
  const kzProductionCatalogItems = useMemo(
    () => ({
      kaspi: buildMarketplaceCatalogItems(kzProducts.kaspi),
      satu: buildMarketplaceCatalogItems(kzProducts.satu),
      halyk: buildMarketplaceCatalogItems(kzProducts.halyk),
    }),
    [kzProducts, productionFiles],
  )
  const novinkaProductionCatalogItems = useMemo(
    (): ProductionCatalogItem[] =>
      mergeNovinkaCatalogItems(
        buildNovinkaCatalogFromFiles(productionFiles),
        buildNovinkaCatalogFromSupplyReserves(supplies),
      ),
    [productionFiles, supplies],
  )
  const activeNovinkaCatalogMarketplace = parseNovinkaCatalogTab(productionCatalogTab)
  const taskFormNovinkaCatalogItems = useMemo(
    () =>
      filterNovinkaCatalogByMarketplace(
        novinkaProductionCatalogItems,
        resolveTaskFormNovinkaMarketplace(shopRegion, taskFormMode, kzTaskMarketplace),
      ),
    [novinkaProductionCatalogItems, shopRegion, taskFormMode, kzTaskMarketplace],
  )
  const taskFormProductDuplicateHint = useMemo(() => {
    if (!selectedTaskProductId) {
      return ''
    }

    const productsSource = getTaskFormProducts()
    const product = productsSource.find((item) => String(item.productId) === selectedTaskProductId)

    if (!product) {
      return ''
    }

    const activeConflicts = findProductInActiveProductionTasks(productionTasks, product, {
      excludeTaskId: editingTaskId,
    })

    return formatProductTaskSelectionHint(draftTaskItems, activeConflicts, product)
  }, [
    selectedTaskProductId,
    draftTaskItems,
    productionTasks,
    editingTaskId,
    shopRegion,
    taskFormMode,
    ozonProducts,
    kzProducts,
    kzTaskMarketplace,
  ])
  const taskFormNovinkaDuplicateHint = useMemo(() => {
    if (!selectedTaskNovinkaOfferId) {
      return ''
    }

    const novinka = taskFormNovinkaCatalogItems.find((item) => item.offerId === selectedTaskNovinkaOfferId)
    if (!novinka) {
      return ''
    }

    const activeConflicts = findProductInActiveProductionTasks(productionTasks, novinka, {
      excludeTaskId: editingTaskId,
    })

    return formatProductTaskSelectionHint(draftTaskItems, activeConflicts, novinka)
  }, [
    selectedTaskNovinkaOfferId,
    draftTaskItems,
    productionTasks,
    editingTaskId,
    taskFormNovinkaCatalogItems,
  ])
  const editorNovinkaCatalogItems = useMemo(
    () =>
      filterNovinkaCatalogByMarketplace(
        novinkaProductionCatalogItems,
        shopRegion === 'rf' ? 'ozon' : (activeNovinkaCatalogMarketplace ?? kzMarketplace),
      ),
    [novinkaProductionCatalogItems, shopRegion, activeNovinkaCatalogMarketplace, kzMarketplace],
  )
  const supplyPackedCatalogItems = useMemo((): ProductionCatalogItem[] => {
    const byOfferId = new Map<string, ProductionCatalogItem>()

    for (const task of allCompletedProductionTasks) {
      if (isNovinkaTask(task)) {
        continue
      }

      for (const item of getProductionTaskItems(task)) {
        if (!item.packedAt || item.packedSupplyId || !item.offerId) {
          continue
        }

        const packedQuantity = item.actualQuantity ?? item.requiredQuantity
        const existing = byOfferId.get(item.offerId)

        if (existing) {
          byOfferId.set(item.offerId, {
            ...existing,
            packedQuantity: (existing.packedQuantity ?? 0) + packedQuantity,
            completedAt:
              existing.completedAt && new Date(existing.completedAt).getTime() > new Date(item.packedAt).getTime()
                ? existing.completedAt
                : item.packedAt,
          })
          continue
        }

        byOfferId.set(item.offerId, {
          offerId: item.offerId,
          ozonProductId: item.ozonProductId,
          productName: item.productName,
          productLink: item.productLink ?? '',
          fileCount: 0,
          completedAt: item.packedAt,
          marketplace: 'ozon',
          packedQuantity,
        })
      }
    }

    return Array.from(byOfferId.values()).sort((left, right) =>
      left.productName.localeCompare(right.productName, 'ru'),
    )
  }, [allCompletedProductionTasks])
  const activeProductionCatalog =
    activeNovinkaCatalogMarketplace !== null
      ? filterNovinkaCatalogByMarketplace(novinkaProductionCatalogItems, activeNovinkaCatalogMarketplace)
      : shopRegion === 'rf' && productionCatalogTab === 'ozon'
        ? ozonProductionCatalogItems
        : productionCatalogTab === 'kaspi' ||
            productionCatalogTab === 'satu' ||
            productionCatalogTab === 'halyk'
          ? kzProductionCatalogItems[productionCatalogTab] ?? []
          : []
  const isMarketplaceProductionCatalogTab =
    (shopRegion === 'rf' && productionCatalogTab === 'ozon') ||
    productionCatalogTab === 'kaspi' ||
    productionCatalogTab === 'satu' ||
    productionCatalogTab === 'halyk'
  const editorSelectedNovinka = editorNovinkaCatalogItems.find(
    (item) => item.offerId === editorNovinkaOfferId,
  )
  const editorSelectedOzon = productionLookupProducts.find(
    (product) => String(product.productId) === editorOzonProductId,
  )
  const normalizedCatalogSearch = productionSearch.trim().toLowerCase()
  const filteredProductionCatalog = activeProductionCatalog.filter((item) =>
    !normalizedCatalogSearch
      ? true
      : [item.offerId, item.productName, item.productLink]
          .some((value) => value.toLowerCase().includes(normalizedCatalogSearch)),
  )
  const filteredSupplyAnalytics = analyticsProductKey
    ? supplyAnalytics.filter((item) =>
        item.isReserve
          ? `reserve:${item.productName}` === analyticsProductKey
          : `product:${item.ozonProductId}` === analyticsProductKey,
      )
    : supplyAnalytics
  const supplyFboSummary = useMemo((): SupplyFboSummary => {
    const acceptedProductQuantities = new Map<
      string,
      { productName: string; offerId: string; quantity: number; keys: string[] }
    >()
    const totalOzonShippedQuantity = ozonSupplyShipments.reduce(
      (sum, item) => sum + item.quantity,
      0,
    )

    const catalogKeysByPrimaryKey = new Map<string, string[]>()
    const catalogProductNameByKey = new Map<string, string>()
    const registerProductKeys = (keys: string[], productName = '') => {
      const uniqueKeys = [...new Set(keys.filter(Boolean))]
      for (const key of uniqueKeys) {
        catalogKeysByPrimaryKey.set(key, uniqueKeys)
        if (productName.trim()) {
          catalogProductNameByKey.set(key, productName)
        }
      }
    }

    for (const product of ozonProducts) {
      registerProductKeys([
        ...getOfferMatchKeys(product.offerId),
        product.productId > 0 ? `product:${product.productId}` : '',
        product.sku && product.sku > 0 ? `sku:${product.sku}` : '',
      ], product.name)
    }

    for (const item of supplyAnalytics) {
      if (
        item.status !== 'Accepted' ||
        !isSupplyProductKind(item.itemKind)
      ) {
        continue
      }

      const offerKeys = getOfferMatchKeys(item.offerId)
      const productKey = item.ozonProductId ? `product:${item.ozonProductId}` : ''
      const key = [offerKeys[1], offerKeys[0], productKey, `supply-item:${item.id}`].find(Boolean) ?? ''
      if (!key || key === 'offer:') {
        continue
      }

      const productNameKey = getSupplyProductNameKey(item.productName)
      const keys = [
        ...new Set([...offerKeys, ...(catalogKeysByPrimaryKey.get(key) ?? [key]), productNameKey].filter(Boolean)),
      ]
      const current = acceptedProductQuantities.get(key)
      acceptedProductQuantities.set(key, {
        productName: current?.productName || item.productName,
        offerId: current?.offerId || item.offerId,
        quantity: (current?.quantity ?? 0) + item.quantity,
        keys: [...new Set([...(current?.keys ?? []), ...keys])],
      })
    }

    const shippedByKey = new Map<string, number>()
    for (const item of ozonSupplyShipments) {
      const shipmentKeys = [
        item.productId > 0 ? `product:${item.productId}` : '',
        ...getOfferMatchKeys(item.offerId),
        item.sku > 0 ? `sku:${item.sku}` : '',
      ].filter(Boolean)
      const catalogProductNameKeys = shipmentKeys
        .map((key) => getSupplyProductNameKey(catalogProductNameByKey.get(key) ?? ''))
        .filter(Boolean)
      const directProductNameKey = getSupplyProductNameKey(item.productName ?? '')
      const keys = [
        ...new Set([
          ...shipmentKeys.flatMap((key) => catalogKeysByPrimaryKey.get(key) ?? [key]),
          directProductNameKey,
          ...catalogProductNameKeys,
        ].filter(Boolean)),
      ]

      for (const key of keys) {
        shippedByKey.set(key, (shippedByKey.get(key) ?? 0) + item.quantity)
      }
    }

    const defectQuantityByKey = new Map(
      supplyFboDefects.map((defect) => [defect.productKey, Math.max(0, defect.quantity)]),
    )
    const remainingItems: SupplyFboRemainingItem[] = []
    for (const [key, accepted] of acceptedProductQuantities) {
      const shippedQuantity = Math.min(
        accepted.quantity,
        Math.max(...accepted.keys.map((itemKey) => shippedByKey.get(itemKey) ?? 0), shippedByKey.get(key) ?? 0),
      )
      const defectQuantity = Math.max(
        ...accepted.keys.map((itemKey) => defectQuantityByKey.get(itemKey) ?? 0),
        defectQuantityByKey.get(key) ?? 0,
      )
      const visibleRemainingQuantity = Math.max(0, accepted.quantity - shippedQuantity - defectQuantity)

      if (visibleRemainingQuantity > 0) {
        remainingItems.push({
          key,
          productName: accepted.productName,
          offerId: accepted.offerId,
          acceptedQuantity: accepted.quantity,
          shippedQuantity,
          remainingQuantity: visibleRemainingQuantity,
        })
      }
    }

    return {
      shippedToOzon: totalOzonShippedQuantity,
      remainingToShip: remainingItems.reduce((sum, item) => sum + item.remainingQuantity, 0),
      remainingItems: remainingItems.sort((first, second) => second.remainingQuantity - first.remainingQuantity),
    }
  }, [supplyAnalytics, ozonSupplyShipments, ozonProducts, supplyFboDefects])
  const normalizedSupplySearch = supplySearch.trim().toLowerCase()
  const searchedSupplies = normalizedSupplySearch
    ? supplies.filter((supply) => matchesSupply(supply, normalizedSupplySearch))
    : supplies
  const activeSupplies = searchedSupplies.filter((supply) => !supply.isArchived)
  const archivedSupplies = searchedSupplies.filter((supply) => supply.isArchived)
  const createdSupplies = activeSupplies.filter((supply) => supply.status === 'Created')
  const editableSupplies = activeSupplies.filter((supply) => supply.status !== 'Created')
  const visibleAllSupplies = activeSupplies.filter((supply) =>
    supplyStatusFilter === 'all' ? true : supply.status === supplyStatusFilter,
  )
  const normalizedStockSearch = stockSearch.trim().toLowerCase()
  const filteredOzonStocks = normalizedStockSearch
    ? catalogStocksSource.filter((stock) =>
        [stock.name, stock.offerId, stock.sku, stock.productId, stock.price, stock.currencyCode]
          .filter((value) => value !== undefined && value !== null)
          .some((value) => String(value).toLowerCase().includes(normalizedStockSearch)),
      )
    : catalogStocksSource
  const sortedOzonStocks = [...filteredOzonStocks].sort((left, right) => {
    if (stockSortDirection) {
      const leftTotal = left.fboPresent + left.fbsPresent
      const rightTotal = right.fboPresent + right.fbsPresent
      const byStock = stockSortDirection === 'desc' ? rightTotal - leftTotal : leftTotal - rightTotal
      if (byStock !== 0) {
        return byStock
      }
    }

    return left.offerId.localeCompare(right.offerId, 'ru')
  })
  const analyticsProductImages = useMemo(() => {
    const map = new Map<string, string>()
    const products = shopRegion === 'kz' ? kzProducts[kzMarketplace] : ozonProducts

    for (const product of products) {
      if (!product.imageUrl) {
        continue
      }

      if (product.sku) {
        map.set(`sku:${product.sku}`, product.imageUrl)
      }

      if (product.offerId) {
        map.set(`offer:${product.offerId}`, product.imageUrl)
      }
    }

    return map
  }, [ozonProducts, kzProducts, kzMarketplace, shopRegion])
  const showKzFullAnalytics = shopRegion === 'kz' && (kzMarketplace === 'kaspi' || kzMarketplace === 'satu')
  const showFullAnalytics = shopRegion === 'rf' || showKzFullAnalytics
  const analyticsMarketplaceLabel = shopRegion === 'rf' ? 'OZON' : getKzMarketplaceLabel(kzMarketplace)
  const topAnalyticsProducts = (analytics?.topProducts ?? [])
    .map((row) => ({
      ...row,
      key: row.sku ? `sku:${row.sku}` : `offer:${row.offerId}`,
    }))
    .sort((left, right) => right.quantity - left.quantity)
  const unsoldAnalyticsProducts = (shopRegion === 'rf'
    ? rfUnsoldProducts
    : showKzFullAnalytics
      ? kzUnsoldProducts
      : (analytics?.unsoldProducts ?? []))
    .map((row) => ({
      ...row,
      key: row.sku ? `sku:${row.sku}` : `offer:${row.offerId}`,
    }))
    .sort((left, right) => {
      const leftDays = calculateDaysSinceSupplyDate(left.ozonSellingSince) ?? 0
      const rightDays = calculateDaysSinceSupplyDate(right.ozonSellingSince) ?? 0
      return rightDays - leftDays || left.offerId.localeCompare(right.offerId, 'ru')
    })
  const unsoldProductStatusCounts = useMemo(() => {
    const counts = {
      all: shopRegion === 'rf' ? rfUnsoldTotal : showKzFullAnalytics ? kzUnsoldTotal : unsoldAnalyticsProducts.length,
      selling: 0,
      ready: 0,
    }

    for (const row of unsoldAnalyticsProducts) {
      const group = getProductStatusGroup(row.status)
      if (group === 'selling') {
        counts.selling += 1
      } else if (group === 'ready') {
        counts.ready += 1
      }
    }

    return counts
  }, [unsoldAnalyticsProducts, showKzFullAnalytics, kzUnsoldTotal, shopRegion, rfUnsoldTotal])
  const filteredUnsoldAnalyticsProducts = useMemo(() => {
    if (unsoldProductStatusFilter === 'all') {
      return unsoldAnalyticsProducts
    }

    return unsoldAnalyticsProducts.filter(
      (row) => getProductStatusGroup(row.status) === unsoldProductStatusFilter,
    )
  }, [unsoldAnalyticsProducts, unsoldProductStatusFilter])
  const analyticsOrderRows =
    analytics?.orderRows && analytics.orderRows.length > 0 ? analytics.orderRows : (analytics?.rows ?? [])
  const groupedAnalyticsProducts = useMemo(
    () => groupAnalyticsProducts(analyticsOrderRows),
    [analyticsOrderRows],
  )
  const analyticsStatusCounts = useMemo(() => {
    const counts: Record<string, number> = { all: analyticsOrderRows.length }
    for (const row of analyticsOrderRows) {
      const status = normalizeOrderStatus(row.status)
      counts[status] = (counts[status] ?? 0) + 1
    }
    return counts
  }, [analyticsOrderRows])
  const filteredAnalyticsOrderRows = useMemo(() => {
    if (analyticsStatusFilter === 'all') {
      return analyticsOrderRows
    }

    return analyticsOrderRows.filter((row) => normalizeOrderStatus(row.status) === analyticsStatusFilter)
  }, [analyticsOrderRows, analyticsStatusFilter])
  const filteredGroupedAnalyticsProducts = useMemo(() => {
    const query = analyticsRowSearch.trim().toLowerCase()
    const grouped = groupAnalyticsProducts(filteredAnalyticsOrderRows)

    if (!query) {
      return grouped
    }

    return grouped.filter((group) =>
      [group.productName, group.offerId, String(group.sku), group.status]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(query)),
    )
  }, [filteredAnalyticsOrderRows, analyticsRowSearch])
  const exportableAnalyticsRows = useMemo(
    () => filteredGroupedAnalyticsProducts.flatMap((group) => group.byDate.flatMap((dateGroup) => dateGroup.rows)),
    [filteredGroupedAnalyticsProducts],
  )
  const filteredAnalytics = useMemo(
    () => buildFilteredAnalytics(analytics, exportableAnalyticsRows),
    [analytics, exportableAnalyticsRows],
  )
  const internalAnalytics = useMemo<InternalAnalyticsData>(() => {
    const productCostById = new Map<number, number>()
    const productCostByOfferId = new Map<string, number>()
    const productCostBySku = new Map<number, number>()
    const productPriceById = new Map<number, number>()
    for (const product of ozonProducts) {
      if (product.productId && typeof product.costTotal === 'number' && Number.isFinite(product.costTotal) && product.costTotal > 0) {
        const cost = product.costTotal
        productCostById.set(product.productId, cost)
        if (product.offerId) {
          productCostByOfferId.set(product.offerId.trim().toLowerCase(), cost)
        }
        if (typeof product.sku === 'number' && Number.isFinite(product.sku) && product.sku > 0) {
          productCostBySku.set(product.sku, cost)
        }
      }

      if (product.productId && typeof product.price === 'number' && Number.isFinite(product.price) && product.price > 0) {
        productPriceById.set(product.productId, product.price)
      }
    }

    const productsWithStockIds = new Set<number>()
    const productsWithoutCostIds = new Set<number>()
    let stockQuantity = 0
    let costedStockQuantity = 0
    let stockCostTotal = 0
    let stockSalesGrossTotal = 0

    for (const stock of ozonStocks) {
      const quantity = Math.max(0, (stock.fboPresent ?? 0) + (stock.fbsPresent ?? 0))
      if (quantity <= 0) {
        continue
      }

      productsWithStockIds.add(stock.productId)
      stockQuantity += quantity
      const sellingPrice =
        typeof stock.price === 'number' && Number.isFinite(stock.price) && stock.price > 0
          ? stock.price
          : productPriceById.get(stock.productId) ?? 0
      stockSalesGrossTotal += sellingPrice * quantity

      const cost = productCostById.get(stock.productId)
      if (typeof cost === 'number' && Number.isFinite(cost) && cost > 0) {
        costedStockQuantity += quantity
        stockCostTotal += cost * quantity
      } else {
        productsWithoutCostIds.add(stock.productId)
      }
    }

    const sentOrAcceptedSupplies = supplies.filter(
      (supply) => !supply.isArchived && (supply.status === 'Sent' || supply.status === 'Accepted'),
    )
    const suppliesShippingTotal = sentOrAcceptedSupplies.reduce(
      (sum, supply) => sum + (typeof supply.shippingCost === 'number' ? supply.shippingCost : 0),
      0,
    )
    const suppliesItemQuantity = sentOrAcceptedSupplies.reduce(
      (sum, supply) =>
        sum +
        supply.items.reduce((itemsSum, item) => itemsSum + (isSupplyProductKind(item.itemKind) ? item.quantity : 0), 0),
      0,
    )
    const suppliesWithoutShippingCost = sentOrAcceptedSupplies.filter(
      (supply) => !supply.shippingCost || supply.shippingCost <= 0,
    ).length
    const periodSupplies = sentOrAcceptedSupplies.filter((supply) =>
      isDateStringInRange(supply.sentAt || supply.acceptedAt || supply.createdAt, analyticsDateFrom, analyticsDateTo),
    )
    const periodSupplyShippingTotal = periodSupplies.reduce(
      (sum, supply) => sum + (typeof supply.shippingCost === 'number' ? supply.shippingCost : 0),
      0,
    )
    const periodRows = analytics?.orderRows && analytics.orderRows.length > 0 ? analytics.orderRows : (analytics?.rows ?? [])
    const periodOrdersCount = analytics?.salesTotalCount ?? countDistinctPostings(periodRows)
    const periodOrderedAmount = analytics?.salesAmountTotal ?? 0
    const periodPayoutTotal = analytics?.payoutTotal ?? 0
    const periodCommissionTotal = Math.abs(analytics?.commissionTotal ?? 0)
    const periodLogisticsTotal = Math.abs(analytics?.logisticsTotal ?? 0) + Math.abs(analytics?.cancelledLogisticsTotal ?? 0)
    const periodServicesTotal = Math.abs(analytics?.servicesTotal ?? 0)
    const periodDeductionsTotal = periodCommissionTotal + periodLogisticsTotal + periodServicesTotal
    let periodSoldCostTotal = 0
    let periodSoldCostedQuantity = 0
    let periodSoldWithoutCostQuantity = 0

    for (const row of periodRows) {
      if (normalizeOrderStatus(row.status) !== 'delivered') {
        continue
      }

      const quantity = Math.max(0, row.quantity ?? 0)
      if (quantity <= 0) {
        continue
      }

      const offerKey = row.offerId?.trim().toLowerCase() ?? ''
      const cost = productCostBySku.get(row.sku) ?? productCostByOfferId.get(offerKey)
      if (typeof cost === 'number' && Number.isFinite(cost) && cost > 0) {
        periodSoldCostTotal += cost * quantity
        periodSoldCostedQuantity += quantity
      } else {
        periodSoldWithoutCostQuantity += quantity
      }
    }

    const periodExpensesTotal = internalSupplyExpensesTotal
    const periodExpensesCount = internalSupplyExpenses.length
    const periodNetProfit =
      periodPayoutTotal - periodSoldCostTotal - periodSupplyShippingTotal - periodExpensesTotal

    return {
      stockCostTotal,
      stockSalesNetTotal: stockSalesGrossTotal * 0.55,
      stockProfitTotal: stockSalesGrossTotal * 0.55 - stockCostTotal,
      stockQuantity,
      costedStockQuantity,
      productsWithStock: productsWithStockIds.size,
      productsWithoutCost: productsWithoutCostIds.size,
      suppliesShippingTotal,
      suppliesCount: sentOrAcceptedSupplies.length,
      suppliesItemQuantity,
      suppliesWithoutShippingCost,
      periodDateFrom: analyticsDateFrom,
      periodDateTo: analyticsDateTo,
      periodOrdersCount,
      periodOrderedAmount,
      periodPayoutTotal,
      periodCommissionTotal,
      periodLogisticsTotal,
      periodServicesTotal,
      periodDeductionsTotal,
      periodSupplyShippingTotal,
      periodExpensesTotal,
      periodExpensesCount,
      periodSoldCostTotal,
      periodSoldCostedQuantity,
      periodSoldWithoutCostQuantity,
      periodNetProfit,
    }
  }, [
    analytics,
    analyticsDateFrom,
    analyticsDateTo,
    internalSupplyExpenses.length,
    internalSupplyExpensesTotal,
    ozonProducts,
    ozonStocks,
    supplies,
  ])
  const selectedChatThread = chatThreads.find(
    (item) => item.type === selectedChatType && isSameChatId(item.id, selectedChatId),
  )
  const chatUnreadTotal = chatThreads.reduce((sum, item) => sum + (item.unreadCount ?? 0), 0)
  const unseenNewProductionTasks = allNewProductionTasks.filter(
    (task) =>
      !seenNewTaskNotificationIds.includes(task.id) &&
      !isSameUserId(task.createdByUserId, user?.id),
  )
  const unseenInProgressProductionTasks = allInProgressProductionTasks.filter(
    (task) => !seenInProgressTaskNotificationIds.includes(task.id),
  )
  const unseenCancelledProductionTasks = allCancelledProductionTasks.filter(
    (task) => !seenCancelledTaskNotificationIds.includes(task.id),
  )
  const unseenCancelledForCreator = allCancelledProductionTasks.filter(
    (task) =>
      !seenCancelledTaskNotificationIds.includes(task.id) &&
      isSameUserId(task.createdByUserId, user?.id) &&
      !isSameUserId(task.cancelledByUserId, user?.id),
  )
  const unseenCompletedProductionTasks = allCompletedProductionTasks.filter(
    (task) => !seenCompletedTaskNotificationIds.includes(task.id),
  )
  const allActiveSupplies = supplies.filter((supply) => !supply.isArchived)
  const unseenSupplies = allActiveSupplies.filter((supply) => !seenCreatedSupplyIds.includes(supply.id))
  const unseenCreatedSupplies = unseenSupplies.filter((supply) => supply.status === 'Created')
  const unseenSupplyAnalytics = supplyAnalytics.filter(
    (item) => !seenSupplyAnalyticsKeys.includes(getSupplyAnalyticsRowKey(item)),
  )
  const hasFeature = (feature: string) =>
    user?.role === 'Admin' || Boolean(user?.allowedFeatures?.includes(feature))
  const hasSubFeature = (feature: string, _fallback: string) => hasFeature(feature)
  const canViewIntegrationsOzon = () => hasFeature('integrations.ozon')
  const canEditIntegrationsOzon = () => hasFeature('integrations.ozon.edit')
  const canViewIntegrationsTelegram = () => hasFeature('integrations.telegram')
  const canConnectIntegrationsTelegram = () => hasFeature('integrations.telegram.connect')
  const canViewIntegrationsNotifications = () => hasFeature('integrations.telegram.notifications')
  const canEditIntegrationsNotifications = () => hasFeature('integrations.telegram.notifications.edit')
  const canViewIntegrationsReports = () => hasFeature('integrations.telegram.reports')
  const canEditIntegrationsReports = () => hasFeature('integrations.telegram.reports.edit')
  const canManageIntegrationUsers =
    canViewIntegrationsNotifications() || canViewIntegrationsReports()
  const canEditProductionTasks = () => hasFeature('production.editTasks')
  const canChangeProductionTaskType = () => hasFeature('production.changeTaskType')
  const canCreateProductionTasks = () =>
    user?.role === 'Admin' || Boolean(user?.allowedFeatures?.includes('production.createTask'))
  const canManageProductionTaskDeadline = () => hasFeature('production.taskDeadline')
  const canCancelProductionTasks = () => hasFeature('production.cancelTasks')
  const canEditProductionProducts = () => hasFeature('production.editProducts')
  const canPackProductionItems = () => hasFeature('production.packItems')
  const canDeleteProductionFiles = () => hasFeature('production.deleteFiles')
  const canArchiveProductionTasks = () => hasFeature('production.archive')
  const designerTransferUsers = productionDesigners.filter(
    (item) => item.id !== user?.id && item.role === 'Designer',
  )
  const currentUserAliases = useMemo(
    () =>
      [user?.displayName, user?.userName].filter(
        (value): value is string => Boolean(value?.trim()),
      ),
    [user?.displayName, user?.userName],
  )
  const canEditChats = () => hasFeature('chats.edit')
  const canManageChatGroups = () => hasFeature('chats.groups')
  const canEditPoolingPrices = () => hasFeature('pooling.editPrices')
  const canViewUsers = () =>
    user?.role === 'Admin' ||
    hasFeature('users') ||
    hasFeature('users.create') ||
    hasFeature('users.edit')
  const canCreateUsers = () =>
    user?.role === 'Admin' || hasFeature('users.create') || hasFeature('users.edit')
  const canEditUsers = () => user?.role === 'Admin' || hasFeature('users.edit')
  const canViewSettings = () => hasFeature('settings')
  const canEditSettings = () => hasFeature('settings.edit')
  const isHomeBlockEnabled = (blockId: string) =>
    user?.role === 'Admin' || Boolean(user?.homeBlocks?.some((block) => block.id === blockId && block.enabled))
  const getHomeBlockKzMarketplaces = (blockId: string): KzMarketplace[] => {
    if (!isHomeBlockEnabled(blockId) || !kzHomeSplitBlockIds.has(blockId)) {
      return []
    }

    if (user?.role === 'Admin') {
      return [...allKzHomeMarketplaces]
    }

    const block = user?.homeBlocks?.find((entry) => entry.id === blockId && entry.enabled)
    return block ? getBlockMarketplaces(block) : []
  }
  const hasVisibleKzHomeBlock = (blockId: string) =>
    shopRegion === 'kz' ? getHomeBlockKzMarketplaces(blockId).length > 0 : isHomeBlockEnabled(blockId)
  const hasHomeAction = (blockId: string, action: string) =>
    user?.role === 'Admin' ||
    Boolean(
      user?.homeBlocks?.some((block) => block.id === blockId && block.enabled && block.actions.includes(action)),
    )
  const canChangeOtherPasswords = user?.role === 'Admin' || Boolean(user?.canChangeOtherUserPasswords)
  const canSeeProductionNotifications = hasFeature('production')
  const canSeeSupplyNotifications = hasFeature('supplies')
  const canSeeChatNotifications = hasFeature('chats')
  const notificationItems = [
    ...(canSeeProductionNotifications
      ? unseenNewProductionTasks.map((task) => ({
          key: `task-new-${task.id}`,
          label: `Новая задача: ${getProductionTaskSummary(task)}`,
          target: 'tasks' as const,
          taskId: task.id,
        }))
      : []),
    ...(canSeeProductionNotifications
      ? unseenCancelledForCreator.map((task) => ({
          key: `task-cancelled-${task.id}`,
          label: `Задача отменена: ${getProductionTaskSummary(task)}`,
          target: 'cancelled' as const,
          taskId: task.id,
        }))
      : []),
    ...(canSeeSupplyNotifications
      ? unseenCreatedSupplies.map((supply) => ({
          key: `supply-new-${supply.id}`,
          label: `Новая поставка: ${getSupplyNotificationSummary(supply)}`,
          target: 'supplies-all' as const,
          supplyId: supply.id,
        }))
      : []),
    ...(canSeeChatNotifications
      ? chatThreads
          .filter((item) => (item.unreadCount ?? 0) > 0)
          .map((item) => ({
            key: `chat-${item.type}-${item.id}`,
            label: `Новое сообщение · ${item.title}: ${item.unreadCount}`,
            target: 'chat' as const,
            chatType: item.type,
            chatId: item.id,
          }))
      : []),
  ]
  const productionNotificationTotal = canSeeProductionNotifications
    ? unseenNewProductionTasks.length + unseenCancelledForCreator.length
    : 0
  const supplyNotificationTotal = canSeeSupplyNotifications
    ? unseenCreatedSupplies.length + unseenSupplyAnalytics.length
    : 0
  const isTransientProductionStatus = (value: string) =>
    Boolean(value) &&
    !value.startsWith('Задач:') &&
    !value.startsWith('Найдено записей:') &&
    value !== 'Записей пока нет' &&
    value !== 'Фото, данные и задачи'
  const productionRegionSuffix = useMemo(() => {
    if (shopRegion === 'rf') {
      return ' · LShop РФ'
    }

    if (productionSubTab === 'products') {
      const marketplace =
        productionCatalogTab === 'kaspi' ||
        productionCatalogTab === 'satu' ||
        productionCatalogTab === 'halyk'
          ? productionCatalogTab
          : activeNovinkaCatalogMarketplace && isKzNovinkaMarketplace(activeNovinkaCatalogMarketplace)
            ? activeNovinkaCatalogMarketplace
            : kzMarketplace

      return ` · ${getKzMarketplaceLabel(marketplace)}`
    }

    return ` · ${getKzMarketplaceLabel(kzTaskMarketplace)}`
  }, [
    shopRegion,
    productionSubTab,
    productionCatalogTab,
    activeNovinkaCatalogMarketplace,
    kzMarketplace,
    kzTaskMarketplace,
  ])
  const productionSectionSubtitle = useMemo(() => {
    if (productionSubTab === 'tasks') {
      if (isTransientProductionStatus(taskStatus)) {
        return taskStatus
      }

      return allNewProductionTasks.length
        ? `Задач: ${allNewProductionTasks.length}${productionRegionSuffix}`
        : `Задач пока нет${productionRegionSuffix}`
    }

    if (productionSubTab === 'inProgress') {
      return allInProgressProductionTasks.length
        ? `В работе: ${allInProgressProductionTasks.length}${productionRegionSuffix}`
        : `Задач в работе пока нет${productionRegionSuffix}`
    }

    if (productionSubTab === 'readyToShip') {
      return allReadyToShipProductionTasks.length
        ? `Готовы к отгрузке: ${allReadyToShipProductionTasks.length}${productionRegionSuffix}`
        : `Готовых к отгрузке задач пока нет${productionRegionSuffix}`
    }

    if (productionSubTab === 'cancelled') {
      return allCancelledProductionTasks.length
        ? `Отменённых: ${allCancelledProductionTasks.length}${productionRegionSuffix}`
        : `Отменённых задач пока нет${productionRegionSuffix}`
    }

    if (productionSubTab === 'completed') {
      return allCompletedProductionTasks.length
        ? `Выполненных: ${allCompletedProductionTasks.length}${productionRegionSuffix}`
        : `Выполненных задач пока нет${productionRegionSuffix}`
    }

    if (isTransientProductionStatus(productionStatus)) {
      return productionStatus
    }

    if (productionSubTab === 'products') {
      return filteredProductionCatalog.length
        ? `Найдено записей: ${filteredProductionCatalog.length}${productionRegionSuffix}`
        : `Записей пока нет${productionRegionSuffix}`
    }

    return productionStatus || 'Фото, данные и задачи'
  }, [
    productionSubTab,
    taskStatus,
    productionStatus,
    allNewProductionTasks.length,
    allInProgressProductionTasks.length,
    allReadyToShipProductionTasks.length,
    allCancelledProductionTasks.length,
    allCompletedProductionTasks.length,
    filteredProductionCatalog.length,
    productionRegionSuffix,
  ])
  const notificationTotal =
    productionNotificationTotal + supplyNotificationTotal + (canSeeChatNotifications ? chatUnreadTotal : 0)
  const visibleTabs = tabs.filter((tab) => {
    if (tab.id === 'home') {
      return Boolean(user)
    }

    if (tab.id === 'users') {
      return canViewUsers()
    }

    if (tab.id === 'supplies' && shopRegion === 'kz') {
      return false
    }

    return hasFeature(tab.id)
  })
  const homeProductionStats = useMemo(
    () => computeHomeProductionStats(visibleProductionTasks),
    [visibleProductionTasks],
  )
  const homeKzProductionStats = useMemo(() => {
    const baseTasks = productionTasks.filter(
      (task) =>
        isProductionTaskVisibleForUser(task, user?.role, user?.allowedFeatures) &&
        matchesShopRegionTaskType('kz', task.taskType ?? 'Ozon'),
    )

    return Object.fromEntries(
      (['kaspi', 'satu', 'halyk'] as const).map((marketplace) => [
        marketplace,
        computeHomeProductionStats(
          baseTasks.filter((task) => matchesKzProductionMarketplace(task, marketplace, productionFiles)),
        ),
      ]),
    ) as Record<KzMarketplace, ReturnType<typeof computeHomeProductionStats>>
  }, [productionTasks, user?.role, user?.allowedFeatures, productionFiles])
  const homeSupplyStats = useMemo(() => {
    const active = supplies.filter((supply) => !supply.isArchived)

    return {
      created: active.filter((supply) => supply.status === 'Created').length,
      sent: active.filter((supply) => supply.status === 'Sent').length,
      accepted: active.filter((supply) => supply.status === 'Accepted').length,
      total: active.length,
    }
  }, [supplies])
  const homeMonthPeriodLabel = useMemo(() => {
    const from = new Date(getDefaultAnalyticsDateFrom())
    const to = new Date(getDefaultAnalyticsDateTo())
    return `${from.toLocaleDateString('ru-RU')} — ${to.toLocaleDateString('ru-RU')}`
  }, [])
  const homeProductStats = useMemo(() => computeCatalogProductStats(ozonProducts), [ozonProducts])
  const visibleProductionAnalyticsReport = useMemo((): ProductionAnalyticsReport | null => {
    if (!productionAnalyticsReport || shopRegion === 'rf') {
      return productionAnalyticsReport
    }

    const activeTaskType = getKzTaskType(kzMarketplace)
    const tasks = productionAnalyticsReport.tasks.filter(
      (task) =>
        task.taskType === activeTaskType ||
        (task.taskType === 'Novinka' && matchesKzProductionMarketplace(task, kzMarketplace)),
    )
    const activeUserNames = new Set(tasks.map((task) => task.assignedUserName || '—'))
    const summary = productionAnalyticsReport.summary
      .filter((row) => activeUserNames.has(row.userName))
      .map((row) => {
        const userTasks = tasks.filter((task) => (task.assignedUserName || '—') === row.userName)
        const itemCount = userTasks.reduce(
          (sum, task) => sum + getProductionTaskItems(task).length,
          0,
        )

        return {
          ...row,
          taskCount: userTasks.length,
          itemCount,
        }
      })

    return { summary, tasks }
  }, [productionAnalyticsReport, shopRegion, kzMarketplace])

  useEffect(() => {
    if (!token) {
      setIsLoading(false)
      return
    }

    loadCurrentUser()
    setIsLoading(false)
  }, [token])

  useEffect(() => {
    if (!user?.id) {
      setSeenNewTaskNotificationIds([])
      setSeenInProgressTaskNotificationIds([])
      setSeenCancelledTaskNotificationIds([])
      setSeenCompletedTaskNotificationIds([])
      setSeenCreatedSupplyIds([])
      setSeenSupplyAnalyticsKeys([])
      return
    }

    setSeenNewTaskNotificationIds(readStringListFromStorage(getTaskNotificationStorageKey(user.id, 'new')))
    setSeenInProgressTaskNotificationIds(readStringListFromStorage(getTaskNotificationStorageKey(user.id, 'in-progress')))
    setSeenCancelledTaskNotificationIds(readStringListFromStorage(getTaskNotificationStorageKey(user.id, 'cancelled')))
    setSeenCompletedTaskNotificationIds(readStringListFromStorage(getTaskNotificationStorageKey(user.id, 'completed')))
    setSeenCreatedSupplyIds(readStringListFromStorage(getSupplyNotificationStorageKey(user.id)))
    setSeenSupplyAnalyticsKeys(readStringListFromStorage(getSupplyAnalyticsNotificationStorageKey(user.id)))
  }, [user?.id])

  useEffect(() => {
    if (activeTab !== 'production' || !user?.id) {
      return
    }

    if (productionSubTab === 'tasks') {
      markTaskNotificationsSeen('new', allNewProductionTasks.map((task) => task.id))
    } else if (productionSubTab === 'inProgress') {
      markTaskNotificationsSeen('in-progress', allInProgressProductionTasks.map((task) => task.id))
    } else if (productionSubTab === 'cancelled') {
      markTaskNotificationsSeen('cancelled', allCancelledProductionTasks.map((task) => task.id))
    } else if (productionSubTab === 'completed') {
      markTaskNotificationsSeen('completed', allCompletedProductionTasks.map((task) => task.id))
    }
  }, [
    activeTab,
    productionSubTab,
    user?.id,
    allNewProductionTasks,
    allInProgressProductionTasks,
    allCancelledProductionTasks,
    allCompletedProductionTasks,
  ])

  useEffect(() => {
    if (activeTab !== 'supplies' || !user?.id) {
      return
    }

    if (supplySubTab === 'all' || supplySubTab === 'create') {
      markSupplyNotificationsSeen(allActiveSupplies.map((supply) => supply.id))
    } else if (supplySubTab === 'editor') {
      markSupplyNotificationsSeen(createdSupplies.map((supply) => supply.id))
    } else if (supplySubTab === 'analytics') {
      markSupplyAnalyticsSeen(supplyAnalytics.map((item) => getSupplyAnalyticsRowKey(item)))
    }
  }, [activeTab, supplySubTab, user?.id, allActiveSupplies, createdSupplies, supplyAnalytics])

  useEffect(() => {
    if (!user || visibleTabs.some((tab) => tab.id === activeTab)) {
      return
    }

    setActiveTab(visibleTabs[0]?.id ?? 'home')
  }, [activeTab, user, visibleTabs])

  useEffect(() => {
    if (user?.role === 'Admin') {
      return
    }

    const productionFallbacks: Array<[ProductionSubTab, string]> = [
      ['products', 'production.products'],
      ['tasks', 'production.tasks'],
      ['inProgress', 'production.inProgress'],
      ['cancelled', 'production.cancelled'],
      ['completed', 'production.completed'],
      ['archive', 'production.archive'],
    ]
    if (activeTab === 'production' && !hasSubFeature(`production.${productionSubTab}`, 'production')) {
      setProductionSubTab(productionFallbacks.find(([, feature]) => hasSubFeature(feature, 'production'))?.[0] ?? 'products')
    }

    const supplyFallbacks: Array<[SupplySubTab, string]> = [
      ['create', 'supplies.create'],
      ['editor', 'supplies.editor'],
      ['all', 'supplies.all'],
      ['archive', 'supplies.archive'],
      ['analytics', 'supplies.analytics'],
      ['expenses', 'supplies.expenses'],
    ]
    if (activeTab === 'supplies' && !hasSubFeature(`supplies.${supplySubTab}`, 'supplies')) {
      setSupplySubTab(supplyFallbacks.find(([, feature]) => hasSubFeature(feature, 'supplies'))?.[0] ?? 'create')
    }

    const analyticsFallbacks: Array<[AnalyticsSubTab, string]> = [
      ['summary', 'analytics.summary'],
      ['topProducts', 'analytics.topProducts'],
      ['noSales', 'analytics.noSales'],
      ['production', 'analytics.production'],
      ['internal', 'analytics.internal'],
      ['calculator', 'analytics.calculator'],
      ['finances', 'analytics.finances'],
    ]
    if (activeTab === 'analytics' && !hasSubFeature(`analytics.${analyticsSubTab}`, 'analytics')) {
      setAnalyticsSubTab(analyticsFallbacks.find(([, feature]) => hasSubFeature(feature, 'analytics'))?.[0] ?? 'summary')
    }

    if (
      productionSubTab === 'products' &&
      productionCatalogTab === 'editor' &&
      !canEditProductionProducts()
    ) {
      setProductionCatalogTab(shopRegion === 'rf' ? 'ozon' : kzMarketplace)
    }
  }, [activeTab, user, productionSubTab, supplySubTab, analyticsSubTab, productionCatalogTab, shopRegion, kzMarketplace])

  useEffect(() => {
    if (!token || activeTab !== 'production' || productionSubTab !== 'products') {
      return
    }

    if (shopRegion === 'rf' && productionCatalogTab === 'ozon' && ozonProducts.length === 0) {
      void loadOzonProducts()
    }

    if (
      shopRegion === 'kz' &&
      (productionCatalogTab === 'kaspi' || productionCatalogTab === 'satu' || productionCatalogTab === 'halyk') &&
      kzProducts[productionCatalogTab as KzMarketplace].length === 0
    ) {
      void loadKzProducts(productionCatalogTab as KzMarketplace)
    }

    if (productionCatalogTab === 'editor') {
      if (shopRegion === 'rf' && ozonProducts.length === 0) {
        void loadOzonProducts()
      } else if (shopRegion === 'kz' && activeKzProducts.length === 0) {
        void loadKzProducts()
      }
    }
  }, [token, activeTab, productionSubTab, productionCatalogTab, ozonProducts.length, shopRegion, kzProducts, activeKzProducts.length])

  useEffect(() => {
    if (!token) {
      return
    }

    if (canViewUsers() || canManageIntegrationUsers) {
      void loadUsers()
    }

    if (canViewSettings()) {
      void loadRoleProfiles()
      void loadAuditLogs()
      void loadSystemHealth()
      void loadBackups()
    }

    if (user?.role === 'Admin' || canEditIntegrationsNotifications() || canEditIntegrationsReports()) {
      void loadTelegramNotificationEvents()
      void loadReportSections()
    }

    if (!canViewSettings() && !canViewUsers() && !canManageIntegrationUsers) {
      return
    }

    const intervalId = window.setInterval(() => {
      if (canViewUsers() || canManageIntegrationUsers) {
        void loadUsers()
      }

      if (canViewSettings()) {
        void loadAuditLogs()
        void loadSystemHealth()
        void loadBackups()
      }
    }, 30000)
    return () => window.clearInterval(intervalId)
  }, [token, user?.role, user?.allowedFeatures])

  useEffect(() => {
    setProfileForm({
      displayName: user?.displayName ?? '',
      position: user?.position ?? '',
    })
  }, [user?.displayName, user?.position])

  useEffect(() => {
    if (!token) {
      return
    }

    requestBrowserNotifications()
    sendHeartbeat()
    const intervalId = window.setInterval(sendHeartbeat, 30000)
    return () => window.clearInterval(intervalId)
  }, [token])

  useEffect(() => {
    selectedChatTypeRef.current = selectedChatType
    selectedChatIdRef.current = selectedChatId
    selectedChatKeyRef.current = selectedChatKey
  }, [selectedChatType, selectedChatId, selectedChatKey])

  useEffect(() => {
    if (activeTab === 'chats' && selectedChatId) {
      markChatNotificationsSeen(selectedChatType, selectedChatId)
    }
  }, [activeTab, selectedChatType, selectedChatId])

  useEffect(() => {
    if (activeTab === 'chats') {
      chatMessagesEndRef.current?.scrollIntoView({ block: 'end' })
    }
  }, [activeTab, selectedChatType, selectedChatId, chatMessages.length])

  useEffect(() => {
    if (!token) {
      return
    }

    const connection = new signalR.HubConnectionBuilder()
      .withUrl('/hubs/live', {
        accessTokenFactory: () => token,
      })
      .withAutomaticReconnect()
      .build()

    connection.on('ProductionTasksChanged', () => {
      void loadProductionTasks()
    })

    connection.on('SuppliesChanged', () => {
      void loadSupplies()
      void loadSupplyAnalytics()
      void loadSupplyFboDefects()
      void loadSupplyExpenses()
    })

    connection.on('ChatMessagesChanged', (senderId: string, receiverId: string | null, groupId: string | null) => {
      void loadChatThreads()
      if (
        !isActiveChatMessageEvent(
          senderId,
          receiverId,
          groupId,
          selectedChatTypeRef.current,
          selectedChatIdRef.current,
        )
      ) {
        return
      }

      void loadChatMessages(selectedChatTypeRef.current, selectedChatIdRef.current)
    })

    connection.on('ChatThreadsChanged', () => {
      void loadChatThreads()
    })

    connection.start().catch(() => {
      setTaskStatus('Live-уведомления временно недоступны')
    })

    return () => {
      connection.stop()
    }
  }, [token, user?.id])

  useEffect(() => {
    if (!token || !user) {
      return
    }

    loadProductionFiles('')
    loadProductionTasks()
    if (canSeeNovinkaProductionTasks(user.role, user.allowedFeatures)) {
      loadProductionDesigners()
    }
    loadSupplies()
    loadSupplyAnalytics()
    loadOzonSupplyShipments()
    loadSupplyFboDefects()
    loadSupplyExpenses()
  }, [token, user?.id, user?.role])

  useEffect(() => {
    if (!token || activeTab !== 'supplies' || supplySubTab !== 'analytics' || shopRegion !== 'rf') {
      return
    }

    if (ozonSupplyShipments.length === 0) {
      void loadOzonSupplyShipments()
    }

    if (supplyFboDefects.length === 0) {
      void loadSupplyFboDefects()
    }
  }, [token, activeTab, supplySubTab, shopRegion, ozonSupplyShipments.length, supplyFboDefects.length])

  useEffect(() => {
    if (!token || activeTab !== 'supplies' || supplySubTab !== 'expenses' || shopRegion !== 'rf') {
      return
    }

    void loadSupplyExpenses()
  }, [token, activeTab, supplySubTab, shopRegion, supplyExpenseSearch, supplyExpenseDateFrom, supplyExpenseDateTo])

  useEffect(() => {
    if (shopRegion !== 'kz' || productionCatalogTab !== 'ozon') {
      return
    }

    setProductionCatalogTab(kzMarketplace)
  }, [shopRegion, productionCatalogTab, kzMarketplace])

  useEffect(() => {
    if (shopRegion === 'kz') {
      setAnalytics(null)
      setAnalyticsSnapshot(null)
      setHomeAnalytics(null)
      setHomeKzAnalytics({ kaspi: null, satu: null, halyk: null })
      setHomeKzAnalyticsStatus({ kaspi: '', satu: '', halyk: '' })
      if (activeTab === 'supplies') {
        setActiveTab('home')
      }
    }
  }, [shopRegion, activeTab])

  useEffect(() => {
    if (!token || shopRegion !== 'rf') {
      return
    }

    loadOzonProducts()
  }, [token, user?.role, user?.allowedFeatures, shopRegion])

  useEffect(() => {
    if (!token || activeTab !== 'analytics' || analyticsSubTab !== 'internal' || shopRegion !== 'rf') {
      return
    }

    void loadOzonProducts()

    if (ozonStocks.length === 0) {
      void loadOzonStocks()
    }

    if (supplies.length === 0) {
      void loadSupplies()
    }

    void loadInternalSupplyExpenses()
  }, [
    token,
    activeTab,
    analyticsSubTab,
    shopRegion,
    analyticsDateFrom,
    analyticsDateTo,
    ozonProducts.length,
    ozonStocks.length,
    supplies.length,
  ])

  useEffect(() => {
    if (!token || shopRegion !== 'kz') {
      return
    }

    if (activeTab === 'home') {
      for (const marketplace of ['kaspi', 'satu', 'halyk'] as const) {
        if (!kzCatalogSummary[marketplace]) {
          void loadKzCatalogSummary(marketplace)
        }
      }
    }

    if (activeTab === 'production' && productionSubTab === 'products') {
      const marketplace =
        productionCatalogTab === 'kaspi' ||
        productionCatalogTab === 'satu' ||
        productionCatalogTab === 'halyk'
          ? productionCatalogTab
          : kzMarketplace
      if (kzProducts[marketplace].length === 0) {
        void loadKzProducts(marketplace)
      }
    }
  }, [
    token,
    shopRegion,
    activeTab,
    productionSubTab,
    productionCatalogTab,
    kzMarketplace,
    kzProducts,
    kzCatalogSummary,
  ])

  useEffect(() => {
    if (!token || shopRegion !== 'kz' || activeTab !== 'products') {
      return
    }

    void loadKzCatalogSummary(kzMarketplace)
    setKzProductPage(0)
    void loadKzProducts(kzMarketplace, false, productStatusFilter, null, productSearch, 0)
  }, [activeTab, kzMarketplace, productStatusFilter, token, shopRegion])

  useEffect(() => {
    if (!token || shopRegion !== 'kz' || kzMarketplace !== 'satu' || activeTab !== 'products') {
      return
    }

    void loadKzSatuSyncStatus()
    const timer = window.setInterval(() => {
      void loadKzSatuSyncStatus()
    }, 5000)

    return () => window.clearInterval(timer)
  }, [token, shopRegion, kzMarketplace, activeTab])

  useEffect(() => {
    if (!token || shopRegion !== 'kz' || kzMarketplace !== 'satu' || activeTab !== 'products') {
      return
    }

    if (kzProductSearchDebounceRef.current) {
      window.clearTimeout(kzProductSearchDebounceRef.current)
    }

    kzProductSearchDebounceRef.current = window.setTimeout(() => {
      setKzProductPage(0)
      void loadKzProducts(kzMarketplace, false, productStatusFilter, null, productSearch, 0)
    }, 350)

    return () => {
      if (kzProductSearchDebounceRef.current) {
        window.clearTimeout(kzProductSearchDebounceRef.current)
      }
    }
  }, [productSearch, token, shopRegion, kzMarketplace, activeTab, productStatusFilter])

  useEffect(() => {
    if (!token || activeTab !== 'home' || !isHomeBlockEnabled('analytics') || shopRegion !== 'rf') {
      return
    }

    loadHomeAnalytics()
  }, [activeTab, token, user?.role, user?.allowedFeatures, shopRegion])

  useEffect(() => {
    if (!token || activeTab !== 'home' || !isHomeBlockEnabled('analytics') || shopRegion !== 'kz') {
      return
    }

    loadAllHomeKzAnalytics()
  }, [activeTab, token, user?.role, user?.allowedFeatures, shopRegion])

  useEffect(() => {
    if (!token || activeTab !== 'analytics' || !hasFeature('analytics') || !showKzFullAnalytics) {
      return
    }

    if (!analyticsDateFrom || !analyticsDateTo) {
      setAnalyticsDateFrom(getDefaultAnalyticsDateFrom())
      setAnalyticsDateTo(getDefaultAnalyticsDateTo())
      return
    }

    void loadKzAnalyticsBundle()
  }, [
    activeTab,
    token,
    user?.role,
    user?.allowedFeatures,
    shopRegion,
    kzMarketplace,
    analyticsDateFrom,
    analyticsDateTo,
  ])

  useEffect(() => {
    if (
      !token ||
      activeTab !== 'analytics' ||
      analyticsSubTab !== 'noSales' ||
      shopRegion !== 'rf'
    ) {
      return
    }

    void loadRfUnsoldProducts()
  }, [activeTab, analyticsSubTab, token, shopRegion])

  useEffect(() => {
    if (
      !token ||
      activeTab !== 'analytics' ||
      analyticsSubTab !== 'noSales' ||
      !showKzFullAnalytics ||
      !analyticsDateFrom ||
      !analyticsDateTo
    ) {
      return
    }

    void loadKzUnsoldProducts()
  }, [
    analyticsSubTab,
    analyticsDateFrom,
    analyticsDateTo,
    activeTab,
    token,
    showKzFullAnalytics,
    kzMarketplace,
  ])

  useEffect(() => {
    if (!token || activeTab !== 'analytics' || !hasFeature('analytics') || shopRegion !== 'rf') {
      return
    }

    setAnalyticsDateFrom(getDefaultAnalyticsDateFrom())
    setAnalyticsDateTo(getDefaultAnalyticsDateTo())
  }, [activeTab, token, user?.role, user?.allowedFeatures, shopRegion])

  useEffect(() => {
    if (!token || activeTab !== 'analytics' || !hasFeature('analytics') || shopRegion !== 'rf') {
      return
    }

    if (!analyticsDateFrom || !analyticsDateTo) {
      return
    }

    loadAnalytics()
  }, [analyticsDateFrom, analyticsDateTo, activeTab, token, user?.role, user?.allowedFeatures, shopRegion])

  useEffect(() => {
    if (!token || activeTab !== 'analytics' || analyticsSubTab !== 'production') {
      return
    }

    if (!hasFeature('analytics.production')) {
      return
    }

    setProductionAnalyticsDateFrom(getDefaultAnalyticsDateFrom())
    setProductionAnalyticsDateTo(getDefaultAnalyticsDateTo())
    void loadProductionAnalyticsAssignees()
  }, [activeTab, analyticsSubTab, token, user?.role, user?.allowedFeatures])

  useEffect(() => {
    if (!token || activeTab !== 'analytics' || analyticsSubTab !== 'production') {
      return
    }

    if (!hasFeature('analytics.production')) {
      return
    }

    if (!productionAnalyticsDateFrom || !productionAnalyticsDateTo) {
      return
    }

    void loadProductionAnalyticsReport()
  }, [
    productionAnalyticsDateFrom,
    productionAnalyticsDateTo,
    productionAnalyticsUserId,
    activeTab,
    analyticsSubTab,
    token,
    user?.role,
    user?.allowedFeatures,
  ])

  useEffect(() => {
    if (!token || activeTab !== 'integrations' || !hasFeature('integrations')) {
      return
    }

    void loadTelegramNotificationEvents()
    if (canViewIntegrationsTelegram()) {
      void loadIntegrationsTelegram()
    }
    if (canViewIntegrationsOzon() && shopRegion === 'rf') {
      void loadIntegrationsOzon()
    }
    if (canViewIntegrationsOzon() && shopRegion === 'kz') {
      void loadKzIntegration('kaspi')
      void loadKzIntegration('satu')
      void loadKzIntegration('halyk')
    }
    if (canManageIntegrationUsers) {
      void loadUsers()
      void loadReportSections()
    }
  }, [activeTab, token, user?.role, user?.allowedFeatures, shopRegion])

  useEffect(() => {
    if (!canManageIntegrationUsers || activeTab !== 'integrations') {
      return
    }

    if (!integrationAdminUserId && users.length > 0) {
      const firstUser = users.find((item) => item.id !== SYSTEM_USER_ID) ?? users[0]
      setIntegrationAdminUserId(firstUser.id)
    }
  }, [activeTab, canManageIntegrationUsers, users, integrationAdminUserId])

  useEffect(() => {
    if (!canManageIntegrationUsers || activeTab !== 'integrations' || !integrationAdminUserId) {
      return
    }

    if (integrationsSubTab === 'telegram-notifications') {
      void loadUserTelegram(integrationAdminUserId)
      void loadUserReport(integrationAdminUserId)
    }

    if (integrationsSubTab === 'telegram-reports') {
      void loadUserReport(integrationAdminUserId)
    }
  }, [activeTab, canManageIntegrationUsers, integrationsSubTab, integrationAdminUserId])

  useEffect(() => {
    if (activeTab !== 'integrations' || integrationsSubTab !== 'telegram-notifications') {
      return
    }

    void loadTelegramNotificationEvents(telegramNotificationsRegion)
  }, [activeTab, integrationsSubTab, telegramNotificationsRegion, token])

  useEffect(() => {

    const available: Array<'connections' | 'telegram-notifications' | 'telegram-reports'> = []
    if (canViewIntegrationsOzon() || canViewIntegrationsTelegram()) {
      available.push('connections')
    }
    if (canViewIntegrationsNotifications()) {
      available.push('telegram-notifications')
    }
    if (canViewIntegrationsReports()) {
      available.push('telegram-reports')
    }

    if (available.length > 0 && !available.includes(integrationsSubTab)) {
      setIntegrationsSubTab(available[0])
    }
  }, [activeTab, user?.role, user?.allowedFeatures, integrationsSubTab])

  useEffect(() => {
    if (!token) {
      return
    }

    loadChatThreads()
    loadChatPickerUsers()
    const intervalId = window.setInterval(loadChatThreads, 30000)
    return () => window.clearInterval(intervalId)
  }, [token])

  useEffect(() => {
    if (!token || !selectedChatId) {
      return
    }

    if (selectedChatType === 'group') {
      loadChatGroupDetail(selectedChatId)
    } else {
      setChatGroupDetail(null)
    }

    loadChatMessages(selectedChatType, selectedChatId)
    const intervalId = window.setInterval(() => {
      loadChatMessages(selectedChatTypeRef.current, selectedChatIdRef.current)
    }, 15000)
    return () => window.clearInterval(intervalId)
  }, [token, selectedChatType, selectedChatId])

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoginError('')

    const formData = new FormData(event.currentTarget)
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        userName: formData.get('userName'),
        password: formData.get('password'),
      }),
    })

    if (!response.ok) {
      setLoginError('Неверный логин или пароль')
      return
    }

    const data = await response.json()
    localStorage.setItem('authToken', data.token)
    localStorage.setItem('authUser', JSON.stringify(data.user))
    setToken(data.token)
    setUser(data.user)
  }

  function logout() {
    if (token) {
      fetch('/api/auth/logout', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }).catch(() => undefined)
    }

    localStorage.removeItem('authToken')
    localStorage.removeItem('authUser')
    setToken('')
    setUser(null)
    setUsers([])
    setChatThreads([])
    setChatPickerUsers([])
    setChatMessages([])
    setSelectedChatType('user')
    setSelectedChatId('')
    setChatGroupDetail(null)
    knownNewTaskIdsRef.current = null
    knownCancelledForCreatorRef.current = null
    knownNewSupplyIdsRef.current = null
    productionTaskStatusRef.current = {}
    knownChatUnreadCountsRef.current = null
    knownChatMessageIdsRef.current = {}
    selectedChatTypeRef.current = 'user'
    selectedChatIdRef.current = ''
    selectedChatKeyRef.current = ''
    loadChatThreadsSeqRef.current = 0
  }

  function confirmLogout() {
    if (!window.confirm('Выйти из аккаунта?')) {
      return
    }

    logout()
  }

  function requestBrowserNotifications() {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => undefined)
    }
  }

  function showBrowserNotification(title: string, body: string) {
    if (!('Notification' in window) || Notification.permission !== 'granted') {
      return
    }

    new Notification(title, { body })
  }

  async function loadCurrentUser() {
    const response = await fetch('/api/auth/me', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      return
    }

    const data: User = await response.json()
    localStorage.setItem('authUser', JSON.stringify(data))
    setUser(data)
  }

  async function sendHeartbeat() {
    try {
      await fetch('/api/auth/heartbeat', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })
    } catch {
      // Следующий heartbeat повторит отметку активности.
    }
  }

  async function loadUsers() {
    const response = await fetch('/api/admin/users', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      const message = await response.text()
      setUsers([])
      setUsersLoadError(message || `Не удалось загрузить пользователей (${response.status})`)
      return
    }

    setUsersLoadError('')
    const data: User[] = await response.json()
    setUsers(data)
  }

  async function loadRoleProfiles() {
    const response = await fetch('/api/admin/role-profiles', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      return
    }

    const data: RoleProfile[] = await response.json()
    setRoleProfiles(data)
    setRoleProfileEdits(
      Object.fromEntries(data.map((profile) => [profile.role, profile])),
    )
  }

  async function saveRoleProfile(role: string) {
    const edit = roleProfileEdits[role]
    if (!edit) {
      return
    }

    setRoleProfilesStatus(`Сохраняем роль «${getRoleLabel(role)}»...`)
    const response = await fetch(`/api/admin/role-profiles/${encodeURIComponent(role)}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        displayName: edit.displayName,
        allowedFeatures: edit.allowedFeatures,
        homeBlocks: edit.homeBlocks,
        canChangeOtherUserPasswords: edit.canChangeOtherUserPasswords,
      }),
    })

    if (!response.ok) {
      setRoleProfilesStatus('Не удалось сохранить настройки роли')
      return
    }

    const updated: RoleProfile = await response.json()
    setRoleProfiles((current) => current.map((item) => (item.role === role ? updated : item)))
    setRoleProfileEdits((current) => ({ ...current, [role]: updated }))
    setRoleProfilesStatus(`Роль «${updated.displayName}» сохранена`)
  }

  async function loadUserTelegram(userId: string) {
    const response = await fetch(`/api/admin/users/${userId}/telegram`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      setUserTelegramStatus((current) => ({ ...current, [userId]: 'Не удалось загрузить Telegram' }))
      return
    }

    const data: AdminUserTelegram = await response.json()
    setUserTelegramData((current) => ({ ...current, [userId]: data }))
    setUserTelegramEvents((current) => ({ ...current, [userId]: data.enabledEvents }))
    setUserTelegramEventsKz((current) => ({ ...current, [userId]: data.enabledEventsKz }))
    setUserTelegramStatus((current) => ({ ...current, [userId]: '' }))
  }

  async function saveUserTelegramPreferences(userId: string) {
    const events =
      telegramNotificationsRegion === 'kz'
        ? (userTelegramEventsKz[userId] ?? [])
        : (userTelegramEvents[userId] ?? [])
    setUserTelegramStatus((current) => ({ ...current, [userId]: 'Сохраняем оповещения...' }))

    const response = await fetch(`/api/admin/users/${userId}/telegram/preferences`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ events, shopRegion: telegramNotificationsRegion }),
    })

    if (!response.ok) {
      const message = (await response.text()) || 'Не удалось сохранить оповещения'
      setUserTelegramStatus((current) => ({
        ...current,
        [userId]: message,
      }))
      return
    }

    const data: AdminUserTelegram = await response.json()
    setUserTelegramData((current) => ({ ...current, [userId]: data }))
    setUserTelegramEvents((current) => ({ ...current, [userId]: data.enabledEvents }))
    setUserTelegramEventsKz((current) => ({ ...current, [userId]: data.enabledEventsKz }))
    setUserTelegramStatus((current) => ({ ...current, [userId]: 'Оповещения сохранены' }))
  }

  async function saveUserTelegramAndAccountingPreferences(userId: string) {
    await saveUserTelegramPreferences(userId)
    if (canEditIntegrationsReports() && userReportData[userId]) {
      await saveUserReport(userId)
    }
  }

  async function loadReportSections() {
    const response = await fetch('/api/admin/report-sections', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!response.ok) {
      return
    }
    const data: ReportSection[] = await response.json()
    setReportSections(data)
    setReportsStatus(`Метрик в отчёте: ${data.length}`)
  }

  async function loadUserReport(userId: string) {
    const response = await fetch(`/api/admin/users/${userId}/telegram/report`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!response.ok) {
      setUserReportStatus((current) => ({ ...current, [userId]: 'Не удалось загрузить отчёт' }))
      return
    }
    const data: AdminUserReport = await response.json()
    setUserReportData((current) => ({ ...current, [userId]: data }))
    setUserReportSections((current) => ({ ...current, [userId]: data.enabledSections }))
    setUserMonthlyReportSections((current) => ({ ...current, [userId]: data.monthlyEnabledSections }))
    setUserReportStatus((current) => ({ ...current, [userId]: '' }))
  }

  async function saveUserReport(userId: string) {
    const report = userReportData[userId]
    if (!report) {
      return
    }
    setUserReportStatus((current) => ({ ...current, [userId]: 'Сохраняем отчёт...' }))
    const response = await fetch(`/api/admin/users/${userId}/telegram/report`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        enabled: report.enabled,
        reportTime: report.reportTime,
        timezone: report.timezone,
        sections: userReportSections[userId] ?? report.enabledSections,
        monthlyEnabled: report.monthlyEnabled,
        monthlyReportTime: report.monthlyReportTime,
        monthlyTimezone: report.monthlyTimezone,
        monthlySections: (userMonthlyReportSections[userId] ?? report.monthlyEnabledSections).filter((sectionId) =>
          reportSections.some((section) => section.id === sectionId && isRegularReportSection(section)),
        ),
      }),
    })
    if (!response.ok) {
      const message = (await response.text()) || 'Не удалось сохранить отчёт'
      setUserReportStatus((current) => ({
        ...current,
        [userId]: message,
      }))
      return
    }
    const data: AdminUserReport = await response.json()
    setUserReportData((current) => ({ ...current, [userId]: data }))
    setUserReportSections((current) => ({ ...current, [userId]: data.enabledSections }))
    setUserMonthlyReportSections((current) => ({ ...current, [userId]: data.monthlyEnabledSections }))
    setUserReportStatus((current) => ({ ...current, [userId]: 'Настройки отчёта сохранены' }))
  }

  async function testUserReport(userId: string) {
    setUserReportStatus((current) => ({ ...current, [userId]: 'Отправляем тестовый отчёт...' }))
    const response = await fetch(`/api/admin/users/${userId}/telegram/report/test`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!response.ok) {
      const message = (await response.text()) || 'Не удалось отправить отчёт'
      setUserReportStatus((current) => ({
        ...current,
        [userId]: message,
      }))
      return
    }
    setUserReportStatus((current) => ({ ...current, [userId]: 'Тестовый отчёт отправлен' }))
  }

  async function testUserMonthlyReport(userId: string) {
    setUserReportStatus((current) => ({ ...current, [userId]: 'Отправляем тестовый ежемесячный отчёт...' }))
    const response = await fetch(`/api/admin/users/${userId}/telegram/report/test-monthly`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!response.ok) {
      const message = (await response.text()) || 'Не удалось отправить ежемесячный отчёт'
      setUserReportStatus((current) => ({
        ...current,
        [userId]: message,
      }))
      return
    }
    setUserReportStatus((current) => ({ ...current, [userId]: 'Тестовый ежемесячный отчёт отправлен' }))
  }

  async function changeOwnPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (profilePasswordForm.newPassword !== profilePasswordForm.confirmPassword) {
      setProfileStatus('Новый пароль и подтверждение не совпадают')
      return
    }

    setProfileStatus('Меняем пароль...')
    const response = await fetch('/api/profile/password', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        currentPassword: profilePasswordForm.currentPassword,
        newPassword: profilePasswordForm.newPassword,
      }),
    })

    if (!response.ok) {
      setProfileStatus((await response.text()) || 'Не удалось сменить пароль')
      return
    }

    setProfilePasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
    setProfileStatus('Пароль изменён')
  }

  async function loadAuditLogs(
    search = auditSearch,
    filters?: { dateFrom?: string; dateTo?: string; userId?: string },
  ) {
    const params = new URLSearchParams()
    if (search.trim()) {
      params.set('search', search.trim())
    }

    const effectiveDateFrom = filters?.dateFrom ?? auditDateFrom
    const effectiveDateTo = filters?.dateTo ?? auditDateTo
    const effectiveUserId = filters?.userId ?? auditUserId

    if (effectiveDateFrom.trim()) {
      params.set('dateFrom', effectiveDateFrom.trim())
    }

    if (effectiveDateTo.trim()) {
      params.set('dateTo', effectiveDateTo.trim())
    }

    if (effectiveUserId.trim()) {
      params.set('userId', effectiveUserId.trim())
    }

    const response = await fetch(`/api/admin/audit-logs?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      setAuditStatus('Не удалось загрузить журнал действий')
      return
    }

    const data: AuditLog[] = await response.json()
    setAuditLogs(data)
    setAuditStatus(`Записей: ${data.length}`)
  }

  async function exportAuditLogs() {
    const params = new URLSearchParams()
    if (auditSearch.trim()) {
      params.set('search', auditSearch.trim())
    }
    if (auditDateFrom.trim()) {
      params.set('dateFrom', auditDateFrom.trim())
    }
    if (auditDateTo.trim()) {
      params.set('dateTo', auditDateTo.trim())
    }
    if (auditUserId.trim()) {
      params.set('userId', auditUserId.trim())
    }

    const response = await fetch(`/api/admin/audit-logs/export?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      setAuditStatus('Не удалось скачать журнал')
      return
    }

    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `audit-log-${new Date().toISOString().slice(0, 10)}.xlsx`
    link.click()
    URL.revokeObjectURL(url)
    setAuditStatus('Журнал выгружен в Excel')
  }

  async function loadSystemHealth() {
    const response = await fetch('/api/admin/system-health', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      setSystemHealthStatus('Не удалось получить статус системы')
      return
    }

    const data: SystemHealth = await response.json()
    setSystemHealth(data)
    setSystemHealthStatus(data.databaseOk ? 'Система работает' : 'База данных недоступна')
  }

  async function loadIntegrationsOzon() {
    if (user?.role !== 'Admin') {
      return
    }

    setOzonSettingsStatus('Загрузка настроек Ozon...')
    const response = await fetch('/api/integrations/ozon', {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!response.ok) {
      setOzonSettingsStatus('Не удалось загрузить настройки Ozon')
      return
    }

    const data: OzonIntegrationSettings = await response.json()
    setOzonSettingsData(data)
    setOzonSettingsForm((current) => ({
      ...current,
      baseUrl: data.baseUrl || current.baseUrl,
    }))
    setOzonSettingsStatus(
      data.configured
        ? `Ozon API настроен. Обновлено: ${data.updatedAt ? formatDateTime(data.updatedAt) : '—'}`
        : 'Укажите Client ID и API Key Ozon',
    )
  }

  async function saveIntegrationsOzon() {
    if (user?.role !== 'Admin') {
      return
    }

    setOzonSettingsSaving(true)
    setOzonSettingsStatus('Сохранение...')
    const response = await fetch('/api/integrations/ozon', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        clientId: ozonSettingsForm.clientId.trim(),
        apiKey: ozonSettingsForm.apiKey.trim(),
        baseUrl: ozonSettingsForm.baseUrl.trim(),
      }),
    })

    setOzonSettingsSaving(false)
    if (!response.ok) {
      const message = await response.text()
      setOzonSettingsStatus(message || 'Не удалось сохранить настройки Ozon')
      return
    }

    const data: OzonIntegrationSettings = await response.json()
    setOzonSettingsData(data)
    setOzonSettingsForm((current) => ({ ...current, clientId: '', apiKey: '' }))
    setOzonSettingsStatus('Настройки Ozon сохранены')
  }

  async function testIntegrationsOzon() {
    if (user?.role !== 'Admin') {
      return
    }

    setOzonSettingsStatus('Проверка подключения Ozon...')
    const response = await fetch('/api/integrations/ozon/test', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!response.ok) {
      const message = await response.text()
      setOzonSettingsStatus(message || 'Не удалось проверить Ozon API')
      return
    }

    const data: { success: boolean; message: string } = await response.json()
    setOzonSettingsStatus(data.message)
  }

  async function loadTelegramNotificationEvents(region: ShopRegion = telegramNotificationsRegion) {
    const response = await fetch(`/api/integrations/notification-events?shopRegion=${region}`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!response.ok) {
      return
    }

    const data: TelegramNotificationEvent[] = await response.json()
    setTelegramEvents(data)
  }

  async function loadIntegrationsTelegram() {
    setTelegramStatus('Загрузка Telegram...')
    const response = await fetch('/api/integrations/telegram', {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!response.ok) {
      setTelegramStatus('Не удалось загрузить настройки Telegram')
      return
    }

    const data: TelegramIntegrationInfo = await response.json()
    setTelegramIntegration(data)
    setTelegramStatus(
      data.connected
        ? `Telegram подключён${data.connectedAt ? ` · ${formatDateTime(data.connectedAt)}` : ''}`
        : data.botConfigured
          ? 'Подключите бота по ссылке ниже'
          : 'Telegram-бот не настроен на сервере',
    )
  }

  async function connectTelegramBot() {
    setTelegramStatus('Генерация ссылки...')
    const response = await fetch('/api/integrations/telegram/connect', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!response.ok) {
      const message = await response.text()
      setTelegramStatus(message || 'Не удалось создать ссылку подключения')
      return
    }

    const data: { connectUrl: string } = await response.json()
    setTelegramStatus('Откройте ссылку в Telegram и нажмите Start')
    void loadIntegrationsTelegram()
    window.open(data.connectUrl, '_blank', 'noopener,noreferrer')
  }

  async function testTelegramNotification() {
    setTelegramStatus('Отправка тестового сообщения...')
    const response = await fetch('/api/integrations/telegram/test', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!response.ok) {
      const message = await response.text()
      setTelegramStatus(message || 'Не удалось отправить тест')
      return
    }

    const data: { message: string } = await response.json()
    setTelegramStatus(data.message)
  }

  async function disconnectTelegramBot() {
    setTelegramStatus('Отключение...')
    const response = await fetch('/api/integrations/telegram', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!response.ok) {
      setTelegramStatus('Не удалось отключить Telegram')
      return
    }

    setTelegramStatus('Telegram отключён')
    void loadIntegrationsTelegram()
  }

  async function loadBackups() {
    const response = await fetch('/api/admin/backups', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      setBackupStatus('Не удалось получить список бэкапов')
      return
    }

    const data: BackupFile[] = await response.json()
    setBackupFiles(data)
    setBackupStatus(data.length ? `Бэкапов: ${data.length}` : 'Бэкапов пока нет')
  }

  async function downloadBackup(fileName: string) {
    const response = await fetch(`/api/admin/backups/${encodeURIComponent(fileName)}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      setBackupStatus('Не удалось скачать бэкап')
      return
    }

    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = fileName
    link.click()
    URL.revokeObjectURL(url)
  }

  async function exportTaskArchive() {
    const response = await productionApi.exportProductionArchive(token)

    if (!response.ok) {
      setTaskStatus('Не удалось скачать архив задач')
      return
    }

    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `production-task-archive-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  async function exportSupplyAnalytics() {
    const response = await fetch('/api/supplies/analytics/export', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      setSupplyStatus('Не удалось скачать аналитику поставок')
      return
    }

    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `supplies-analytics-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  async function loadChatPickerUsers() {
    const response = await fetch('/api/chat/users', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      return
    }

    const data: User[] = await response.json()
    setChatPickerUsers(data.map(normalizeApiUser))
  }

  async function fetchChatThreadsRaw(): Promise<ChatThread[]> {
    const response = await fetch('/api/chat/threads', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      return []
    }

    const data: ChatThread[] = await response.json()
    return data.map(normalizeApiThread)
  }

  function finishCreateGroupSuccess(
    data: {
      id: string
      name: string
      createdByUserId?: string
      members?: ChatGroupMember[]
    } | null,
  ) {
    setShowCreateGroupModal(false)
    setCreateGroupHint('')
    setNewGroupName('')
    setNewGroupMemberIds([])
    setChatStatus('Группа создана')

    if (data?.id) {
      setChatGroupDetail({
        id: String(data.id),
        name: data.name,
        createdByUserId: String(data.createdByUserId ?? user?.id ?? ''),
        members: data.members ?? [],
      })
      selectChatThread('group', String(data.id))
    }

    void loadChatThreads().catch(() => undefined)
  }

  function parseCreateGroupResponse(raw: string) {
    if (!raw.trim()) {
      return null
    }

    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      const membersRaw = (parsed.members ?? parsed.Members ?? []) as Array<Record<string, unknown>>
      const id = parsed.id ?? parsed.Id
      const name = parsed.name ?? parsed.Name
      const createdByUserId = parsed.createdByUserId ?? parsed.CreatedByUserId

      if (!id || !name) {
        return null
      }

      const members = membersRaw.map((member) =>
        normalizeApiGroupMember({
          userId: String(member.userId ?? member.UserId ?? ''),
          userName: String(member.userName ?? member.UserName ?? ''),
          displayName: String(member.displayName ?? member.DisplayName ?? ''),
          position: String(member.position ?? member.Position ?? ''),
          avatarUrl: String(member.avatarUrl ?? member.AvatarUrl ?? ''),
        }),
      )

      return {
        id: String(id),
        name: String(name),
        createdByUserId: createdByUserId ? String(createdByUserId) : undefined,
        members,
      }
    } catch {
      return null
    }
  }

  async function loadChatThreads() {
    const requestSeq = ++loadChatThreadsSeqRef.current
    const response = await fetch('/api/chat/threads', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      return
    }

    const data: ChatThread[] = await response.json()
    if (requestSeq !== loadChatThreadsSeqRef.current) {
      return
    }

    const normalizedData = data.map(normalizeApiThread)
    const currentType = selectedChatTypeRef.current
    const currentId = selectedChatIdRef.current
    const previousUnreadCounts = knownChatUnreadCountsRef.current
    const nextUnreadCounts = Object.fromEntries(
      normalizedData.map((item) => [`${item.type}:${item.id}`, item.unreadCount ?? 0]),
    )

    if (previousUnreadCounts) {
      normalizedData.forEach((item) => {
        const key = `${item.type}:${item.id}`
        const previousCount = previousUnreadCounts[key] ?? 0
        const currentCount = item.unreadCount ?? 0
        if (currentCount > previousCount) {
          showBrowserNotification(
            item.type === 'group' ? 'Новое сообщение в группе' : 'Новое сообщение',
            `${item.title}: ${currentCount - previousCount} новое`,
          )
        }
      })
    }

    knownChatUnreadCountsRef.current = nextUnreadCounts
    setChatThreads(normalizedData)
    if (currentType === 'group' && currentId) {
      const groupThread = normalizedData.find((item) => item.type === 'group' && isSameChatId(item.id, currentId))
      if (groupThread?.members?.length) {
        setChatGroupDetail({
          id: groupThread.id,
          name: groupThread.title,
          createdByUserId: groupThread.createdByUserId ?? '',
          members: groupThread.members,
        })
      }
    }

    if (!currentId) {
      const first = normalizedData[0]
      if (first) {
        setSelectedChatType(first.type)
        setSelectedChatId(first.id)
      }
      return
    }

    const hasCurrent = normalizedData.some(
      (item) => isSameChatId(item.id, currentId) && item.type === currentType,
    )
    if (!hasCurrent) {
      const first = normalizedData[0]
      if (first) {
        setSelectedChatType(first.type)
        setSelectedChatId(first.id)
      } else {
        setSelectedChatId('')
      }
    }
  }

  async function loadChatGroupDetail(groupId: string) {
    const response = await fetch(`/api/chat/groups/${groupId}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      setChatGroupDetail(null)
      return null
    }

    const data = await response.json()
    const detail = {
      id: String(data.id),
      name: data.name,
      createdByUserId: String(data.createdByUserId),
      members: (data.members ?? []) as ChatGroupMember[],
    }
    setChatGroupDetail(detail)
    return detail
  }

  function selectChatThread(type: 'user' | 'group', id: string) {
    selectedChatTypeRef.current = type
    selectedChatIdRef.current = id
    selectedChatKeyRef.current = `${type}:${id}`
    setSelectedChatType(type)
    setSelectedChatId(id)
  }

  async function openGroupMembersModal() {
    if (!selectedChatId || selectedChatType !== 'group') {
      return
    }

    const groupId = selectedChatId
    const thread = chatThreads.find((item) => item.type === 'group' && isSameChatId(item.id, groupId))
    const seededDetail =
      thread?.members && thread.members.length > 0
        ? {
            id: thread.id,
            name: thread.title,
            createdByUserId: thread.createdByUserId ?? '',
            members: thread.members,
          }
        : chatGroupDetail?.id && isSameChatId(chatGroupDetail.id, groupId)
          ? chatGroupDetail
          : null

    setShowGroupMembersModal(true)
    setGroupMembersModalState({
      groupId,
      loading: !seededDetail,
      error: '',
      detail: seededDetail,
    })

    if (seededDetail) {
      setChatGroupDetail(seededDetail)
    }

    try {
      const response = await fetch(`/api/chat/groups/${groupId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (!response.ok) {
        if (!seededDetail) {
          setGroupMembersModalState({
            groupId,
            loading: false,
            error: 'Не удалось загрузить участников',
            detail: null,
          })
        } else {
          setGroupMembersModalState((current) =>
            current
              ? {
                  ...current,
                  loading: false,
                }
              : current,
          )
        }
        return
      }

      const data = await response.json()
      setChatGroupDetail({
        id: String(data.id),
        name: data.name,
        createdByUserId: String(data.createdByUserId),
        members: data.members ?? [],
      })
      setGroupMembersModalState({
        groupId,
        loading: false,
        error: '',
        detail: {
          id: String(data.id),
          name: data.name,
          createdByUserId: String(data.createdByUserId),
          members: data.members ?? [],
        },
      })
    } catch {
      if (!seededDetail) {
        setGroupMembersModalState({
          groupId,
          loading: false,
          error: 'Не удалось загрузить участников',
          detail: null,
        })
      } else {
        setGroupMembersModalState((current) =>
          current
            ? {
                ...current,
                loading: false,
              }
            : current,
        )
      }
    }
  }

  async function createChatGroup() {
    if (creatingGroupRef.current) {
      return
    }

    const name = newGroupName.trim()
    if (name.length < 2) {
      setCreateGroupHint('Укажите название группы')
      return
    }

    if (newGroupMemberIds.length < 2) {
      setCreateGroupHint('Выберите минимум 2 участников — вместе с вами в группе должно быть 3 человека')
      return
    }

    creatingGroupRef.current = true
    setCreateGroupHint('')
    setChatStatus('')

    const memberIds = newGroupMemberIds
      .map((id) => id.trim())
      .filter(Boolean)

    try {
      const response = await fetch('/api/chat/groups', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name,
          memberIds,
        }),
      })

      const responseText = await response.text()
      const success = response.status >= 200 && response.status < 300

      if (success) {
        finishCreateGroupSuccess(parseCreateGroupResponse(responseText))
        return
      }

      const threads = await fetchChatThreadsRaw()
      const createdGroup = threads.find(
        (thread) => thread.type === 'group' && thread.title.trim().toLowerCase() === name.toLowerCase(),
      )

      if (createdGroup) {
        finishCreateGroupSuccess({
          id: createdGroup.id,
          name: createdGroup.title,
          createdByUserId: createdGroup.createdByUserId,
          members: createdGroup.members ?? [],
        })
        return
      }

      const message = parseApiErrorMessage(responseText) || 'Не удалось создать группу'
      setCreateGroupHint(message)
      setChatStatus(message)
    } catch {
      const threads = await fetchChatThreadsRaw().catch(() => [] as ChatThread[])
      const createdGroup = threads.find(
        (thread) => thread.type === 'group' && thread.title.trim().toLowerCase() === name.toLowerCase(),
      )

      if (createdGroup) {
        finishCreateGroupSuccess({
          id: createdGroup.id,
          name: createdGroup.title,
          createdByUserId: createdGroup.createdByUserId,
          members: createdGroup.members ?? [],
        })
        return
      }

      setCreateGroupHint('Не удалось создать группу')
      setChatStatus('Не удалось создать группу')
    } finally {
      creatingGroupRef.current = false
    }
  }

  async function addSingleMemberToGroup(memberUserId: string) {
    const groupId = groupMembersModalState?.groupId || selectedChatId
    if (!groupId || selectedChatType !== 'group') {
      return
    }

    const response = await fetch(`/api/chat/groups/${groupId}/members`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ memberIds: [memberUserId] }),
    })

    if (!response.ok) {
      const message = await response.text()
      setChatStatus(message || 'Не удалось добавить участника')
      return
    }

    const data = await response.json()
    const detail = {
      id: String(data.id),
      name: data.name,
      createdByUserId: String(data.createdByUserId),
      members: (data.members ?? []) as ChatGroupMember[],
    }

    setChatGroupDetail(detail)
    setGroupMembersModalState((current) =>
      current
        ? {
            ...current,
            groupId,
            loading: false,
            error: '',
            detail,
          }
        : current,
    )
    setChatStatus('Участник добавлен')
    await loadChatThreads()
  }

  async function removeMemberFromGroup(memberUserId: string) {
    const groupId = groupMembersModalState?.groupId || selectedChatId
    if (!groupId || selectedChatType !== 'group') {
      return
    }

    const response = await fetch(`/api/chat/groups/${groupId}/members/${memberUserId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      const message = await response.text()
      setChatStatus(message || 'Не удалось удалить участника')
      return
    }

    const payload = await response.json()

    if (payload.deleted) {
      setShowGroupMembersModal(false)
      setGroupMembersModalState(null)
      setSelectedChatId('')
      setSelectedChatType('user')
      setChatGroupDetail(null)
      setChatMessages([])
      setChatStatus(
        isSameUserId(memberUserId, user?.id)
          ? isSameUserId(groupMembersModalState?.detail?.createdByUserId || selectedChatThread?.createdByUserId, user?.id)
            ? 'Группа удалена'
            : 'Вы вышли из группы'
          : 'Группа удалена',
      )
      await loadChatThreads()
      return
    }

    const data = payload.group
    if (!data) {
      setChatStatus('Не удалось обновить список участников')
      return
    }

    const detail = {
      id: String(data.id),
      name: data.name,
      createdByUserId: String(data.createdByUserId),
      members: (data.members ?? []) as ChatGroupMember[],
    }

    setChatGroupDetail(detail)
    setGroupMembersModalState((current) =>
      current
        ? {
            ...current,
            groupId,
            loading: false,
            error: '',
            detail,
          }
        : current,
    )
    setShowGroupMembersModal(true)
    setChatStatus(isSameUserId(memberUserId, user?.id) ? 'Вы вышли из группы' : 'Участник удалён')

    if (isSameUserId(memberUserId, user?.id)) {
      setShowGroupMembersModal(false)
      setGroupMembersModalState(null)
      setSelectedChatId('')
      setSelectedChatType('user')
      setChatGroupDetail(null)
      setChatMessages([])
    }

    await loadChatThreads()
  }

  async function deleteChatGroup() {
    const groupId = groupMembersModalState?.groupId || selectedChatId
    if (!groupId || selectedChatType !== 'group') {
      return
    }

    if (!window.confirm('Удалить группу без возможности восстановления?')) {
      return
    }

    const response = await fetch(`/api/chat/groups/${groupId}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      setChatStatus('Не удалось удалить группу')
      return
    }

    setShowGroupMembersModal(false)
    setGroupMembersModalState(null)
    setSelectedChatId('')
    setChatGroupDetail(null)
    setChatMessages([])
    setChatStatus('Группа удалена')
    await loadChatThreads()
  }

  function toggleNewGroupMember(userId: string) {
    setCreateGroupHint('')
    setNewGroupMemberIds((current) =>
      current.some((id) => isSameUserId(id, userId))
        ? current.filter((id) => !isSameUserId(id, userId))
        : [...current, userId],
    )
  }

  async function loadChatMessages(chatType = selectedChatTypeRef.current, chatId = selectedChatIdRef.current) {
    if (!chatId) {
      setChatMessages([])
      return
    }

    const requestKey = `${chatType}:${chatId}`
    const url =
      chatType === 'group'
        ? `/api/chat/groups/${chatId}/messages`
        : `/api/chat/${chatId}/messages`

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      return
    }

    if (`${selectedChatTypeRef.current}:${selectedChatIdRef.current}` !== requestKey) {
      return
    }

    const data: ChatMessage[] = await response.json()
    const normalizedData = data.map(normalizeApiChatMessage)
    const threadKey = `${chatType}:${chatId}`
    const previousMessageIds = knownChatMessageIdsRef.current[threadKey]
    if (previousMessageIds) {
      const incomingMessages = normalizedData.filter((message) => !message.isOwn && !previousMessageIds.has(message.id))
      if (incomingMessages.length > 0) {
        const lastMessage = incomingMessages[incomingMessages.length - 1]
        showBrowserNotification(
          chatType === 'group' ? 'Новое сообщение в группе' : 'Новое сообщение',
          lastMessage.text || lastMessage.attachmentFileName || 'Вложение',
        )
      }
    }

    if (`${selectedChatTypeRef.current}:${selectedChatIdRef.current}` !== requestKey) {
      return
    }

    knownChatMessageIdsRef.current[threadKey] = new Set(normalizedData.map((message) => message.id))
    setChatMessages(normalizedData)
  }

  async function sendChatMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!selectedChatId || (!chatText.trim() && !chatFile)) {
      setChatStatus('Выберите чат и напишите сообщение или прикрепите файл')
      return
    }

    const formData = new FormData()
    formData.append('text', chatText)
    if (chatFile) {
      formData.append('file', chatFile)
    }

    const url =
      selectedChatType === 'group'
        ? `/api/chat/groups/${selectedChatId}/messages`
        : `/api/chat/${selectedChatId}/messages`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    })

    if (!response.ok) {
      setChatStatus('Не удалось отправить сообщение')
      return
    }

    const created = normalizeApiChatMessage((await response.json()) as ChatMessage)
    const threadKey = `${selectedChatType}:${selectedChatId}`
    setChatText('')
    setChatFile(null)
    setChatStatus('')
    setChatMessages((current) => {
      if (current.some((item) => item.id === created.id)) {
        return current
      }
      return [...current, created]
    })
    const knownIds = knownChatMessageIdsRef.current[threadKey] ?? new Set<string>()
    knownIds.add(created.id)
    knownChatMessageIdsRef.current[threadKey] = knownIds
    void loadChatThreads()
  }

  async function downloadChatAttachment(message: ChatMessage) {
    const response = await fetch(`/api/chat/messages/${message.id}/attachment`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      setChatStatus('Не удалось скачать вложение')
      return
    }

    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')

    link.href = url
    link.download = message.attachmentFileName || 'chat-file'
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  async function deleteChatMessage(message: ChatMessage) {
    if (!message.isOwn) {
      return
    }

    const response = await fetch(`/api/chat/messages/${message.id}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      setChatStatus('Не удалось удалить сообщение')
      return
    }

    setChatMessages((current) => current.filter((item) => item.id !== message.id))
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setProfileStatus('Сохраняем профиль...')

    const response = await fetch('/api/profile', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(profileForm),
    })

    if (!response.ok) {
      setProfileStatus('Не удалось сохранить профиль')
      return
    }

    const updatedUser: User = await response.json()
    localStorage.setItem('authUser', JSON.stringify(updatedUser))
    setUser(updatedUser)
    setProfileStatus('Профиль сохранен')
    setProfileModalUser((current) => (current?.id === updatedUser.id ? updatedUser : current))
  }

  async function uploadProfileAvatar() {
    if (!profileAvatar) {
      setProfileStatus('Выберите фотографию')
      return
    }

    const formData = new FormData()
    formData.append('avatar', profileAvatar)
    setProfileStatus('Загружаем фото...')

    const response = await fetch('/api/profile/avatar', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    })

    if (!response.ok) {
      setProfileStatus(await response.text() || 'Не удалось загрузить фото')
      return
    }

    const updatedUser: User = await response.json()
    localStorage.setItem('authUser', JSON.stringify(updatedUser))
    setUser(updatedUser)
    setProfileAvatar(null)
    setProfileStatus('Фото обновлено')
    setProfileModalUser((current) => (current?.id === updatedUser.id ? updatedUser : current))
  }

  function openUserProfile(profileUser: User) {
    setProfileModalUser(profileUser)
    setProfileAvatar(null)
    setProfileStatus('')
    if (profileUser.id === user?.id) {
      setProfileForm({ displayName: profileUser.displayName, position: profileUser.position })
    }
  }

  function closeUserProfile() {
    setProfileModalUser(null)
    setProfileAvatar(null)
    setProfileStatus('')
    setProfilePasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
  }

  function openUserProfileFromThread(thread: ChatThread) {
    if (thread.type !== 'user') {
      return
    }

    const knownUser = users.find((item) => isSameUserId(item.id, thread.id))
    openUserProfile(
      knownUser ?? {
        id: thread.id,
        userName: thread.title,
        displayName: thread.title,
        position: thread.subtitle,
        role: 'Production',
        avatarUrl: thread.avatarUrl,
        allowedFeatures: [],
        isOnline: thread.isOnline,
      },
    )
  }

  function openUserProfileFromMember(member: ChatGroupMember) {
    const knownUser = users.find((item) => isSameUserId(item.id, member.userId))
    openUserProfile(
      knownUser ?? {
        id: member.userId,
        userName: member.userName,
        displayName: member.displayName || member.userName,
        position: member.position,
        role: 'Production',
        avatarUrl: member.avatarUrl,
        allowedFeatures: [],
      },
    )
  }

  function openUserProfileFromSender(senderId: string, displayName?: string) {
    const knownUser = users.find((item) => isSameUserId(item.id, senderId))
    openUserProfile(
      knownUser ?? {
        id: senderId,
        userName: displayName || 'Пользователь',
        displayName: displayName || 'Пользователь',
        position: '',
        role: 'Production',
        avatarUrl: '',
        allowedFeatures: [],
      },
    )
  }

  async function loadOzonProducts() {
    setOzonStatus('Загружаем товары Ozon...')

    const response = await fetch('/api/ozon/products', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      if (response.status === 401) {
        logout()
        setLoginError('Сессия истекла. Войдите заново.')
        return
      }

      setOzonStatus(
        response.status === 403
          ? 'Нет доступа к списку товаров Ozon'
          : getApiErrorMessage(await response.text(), 'Не удалось получить данные Ozon'),
      )
      return
    }

    const data: OzonProduct[] = await response.json()
    setOzonProducts(data)
    setOzonStatus(`Загружено товаров Ozon: ${data.length}`)
  }

  function fillProductCostTypeEditForm(costType?: ProductCostType | null) {
    setProductCostTypeEditForm({
      id: costType?.id ?? '',
      name: costType?.name ?? '',
      isPurchased: costType?.isPurchased ?? false,
      purchaseCost: costType?.purchaseCost ? String(costType.purchaseCost) : '',
      packagingCost: costType?.packagingCost ? String(costType.packagingCost) : '',
      productionCost: costType?.productionCost ? String(costType.productionCost) : '',
    })
  }

  function openProductCostTypeEditModal(costType?: ProductCostType | null) {
    if (!costType) {
      setProductCostStatus('Выберите тип себестоимости для редактирования.')
      return
    }

    fillProductCostTypeEditForm(costType)
    setProductCostStatus('')
    setProductCostTypeEditModalOpen(true)
  }

  function closeProductCostTypeEditModal() {
    setProductCostTypeEditModalOpen(false)
  }

  async function openProductCostModal(product: OzonProduct) {
    setProductCostModalProduct(product)
    setProductCostStatus('Загружаем карточку товара...')
    setProductCostForm({
      useIndividualCost: true,
      costTypeId: '',
      isPurchased: false,
      purchaseCost: '',
      packagingCost: '',
      productionCost: '',
    })
    fillProductCostTypeEditForm(null)
    setProductCostTypeEditModalOpen(false)
    const loadedCostTypes = await loadProductCostTypes()

    const response = await fetch(`/api/ozon/products/${product.productId}/cost`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      setProductCostStatus(getApiErrorMessage(await response.text(), 'Не удалось загрузить карточку товара'))
      return
    }

    const data: ProductCostProfile = await response.json()
    const selectedCostTypeId = data.costTypeId ?? ''
    setProductCostForm({
      useIndividualCost: data.useIndividualCost ?? true,
      costTypeId: selectedCostTypeId,
      isPurchased: data.isPurchased,
      purchaseCost: data.purchaseCost ? String(data.purchaseCost) : '',
      packagingCost: data.packagingCost ? String(data.packagingCost) : '',
      productionCost: data.productionCost ? String(data.productionCost) : '',
    })
    fillProductCostTypeEditForm(loadedCostTypes.find((type) => type.id === selectedCostTypeId))
    setProductCostStatus('')
  }

  async function loadProductCostTypes() {
    const response = await fetch('/api/ozon/product-cost-types', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      setProductCostStatus(getApiErrorMessage(await response.text(), 'Не удалось загрузить типы себестоимости'))
      return [] as ProductCostType[]
    }

    const data: ProductCostType[] = await response.json()
    setProductCostTypes(data)
    return data
  }

  async function loadProductCostProfiles() {
    if (!token) {
      return [] as ProductCostProfile[]
    }

    const response = await fetch('/api/ozon/product-cost-profiles', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      setProductCostTypesStatus(getApiErrorMessage(await response.text(), 'Не удалось загрузить товары по типам себестоимости'))
      return [] as ProductCostProfile[]
    }

    const data: ProductCostProfile[] = await response.json()
    setProductCostProfiles(data)
    setProductCostTypesStatus('')
    return data
  }

  async function openProductCostTypesTab() {
    setProductsInnerTab('costTypes')
    setProductCostTypesStatus('Загружаем типы себестоимости...')
    const [types] = await Promise.all([loadProductCostTypes(), loadProductCostProfiles()])
    if (types.length > 0 && !expandedProductCostTypeId) {
      setExpandedProductCostTypeId(types[0].id)
    }
    if (ozonProducts.length === 0) {
      void loadOzonProducts()
    }
  }

  function parseCostInput(value: string) {
    const normalized = value.trim().replace(',', '.')
    if (!normalized) {
      return null
    }

    const parsed = Number(normalized)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
  }

  function getProductCostFormTotal() {
    if (!productCostForm.useIndividualCost) {
      return productCostTypes.find((type) => type.id === productCostForm.costTypeId)?.costTotal ?? null
    }

    if (productCostForm.isPurchased) {
      return parseCostInput(productCostForm.purchaseCost)
    }

    const packaging = parseCostInput(productCostForm.packagingCost) ?? 0
    const production = parseCostInput(productCostForm.productionCost) ?? 0
    const total = packaging + production
    return total > 0 ? total : null
  }

  async function saveProductCostProfile() {
    if (!productCostModalProduct) {
      return
    }

    if (!productCostForm.useIndividualCost && !productCostForm.costTypeId) {
      setProductCostStatus('Выберите тип себестоимости.')
      return
    }

    setProductCostSaving(true)
    setProductCostStatus('Сохраняем...')

    try {
      const selectedCostType = productCostForm.useIndividualCost
        ? null
        : productCostTypes.find((type) => type.id === productCostForm.costTypeId)
      const resolvedIsPurchased = productCostForm.useIndividualCost
        ? productCostForm.isPurchased
        : (selectedCostType?.isPurchased ?? productCostForm.isPurchased)
      const response = await fetch(`/api/ozon/products/${productCostModalProduct.productId}/cost`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          offerId: productCostModalProduct.offerId,
          productName: productCostModalProduct.name,
          isPurchased: resolvedIsPurchased,
          costTypeId: productCostForm.useIndividualCost ? null : productCostForm.costTypeId,
          useIndividualCost: productCostForm.useIndividualCost,
          purchaseCost: parseCostInput(productCostForm.purchaseCost),
          packagingCost: parseCostInput(productCostForm.packagingCost),
          productionCost: parseCostInput(productCostForm.productionCost),
        }),
      })

      if (!response.ok) {
        setProductCostStatus(
          response.status === 403
            ? 'Нет доступа к редактированию себестоимости'
            : getApiErrorMessage(await response.text(), 'Не удалось сохранить себестоимость'),
        )
        return
      }

      const data: ProductCostProfile = await response.json()
      setOzonProducts((current) =>
        current.map((item) =>
          item.productId === productCostModalProduct.productId
            ? { ...item, costTotal: data.costTotal, isPurchased: data.isPurchased }
            : item,
        ),
      )
      setProductCostProfiles((current) =>
        [...current.filter((item) => item.productId !== data.productId), data].sort((a, b) =>
          (a.productName || a.offerId).localeCompare(b.productName || b.offerId),
        ),
      )
      setProductCostModalProduct((current) =>
        current ? { ...current, costTotal: data.costTotal, isPurchased: data.isPurchased } : current,
      )
      setProductCostStatus('Сохранено')
    } finally {
      setProductCostSaving(false)
    }
  }

  async function saveProductCostType() {
    const name = productCostTypeForm.name.trim()
    if (!name) {
      setProductCostStatus('Укажите название типа себестоимости.')
      return
    }

    setProductCostTypeSaving(true)
    setProductCostStatus('Сохраняем тип себестоимости...')

    try {
      const response = await fetch('/api/ozon/product-cost-types', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name,
          isPurchased: productCostTypeForm.isPurchased,
          purchaseCost: parseCostInput(productCostTypeForm.purchaseCost),
          packagingCost: parseCostInput(productCostTypeForm.packagingCost),
          productionCost: parseCostInput(productCostTypeForm.productionCost),
        }),
      })

      if (!response.ok) {
        setProductCostStatus(getApiErrorMessage(await response.text(), 'Не удалось сохранить тип себестоимости'))
        return
      }

      const data: ProductCostType = await response.json()
      setProductCostTypes((current) => [...current.filter((type) => type.id !== data.id), data].sort((a, b) => a.name.localeCompare(b.name)))
      setProductCostForm((current) => ({
        ...current,
        useIndividualCost: false,
        costTypeId: data.id,
      }))
      fillProductCostTypeEditForm(data)
      setProductCostTypeForm({
        name: '',
        isPurchased: false,
        purchaseCost: '',
        packagingCost: '',
        productionCost: '',
      })
      setExpandedProductCostTypeId(data.id)
      void loadProductCostProfiles()
      void loadOzonProducts()
      setProductCostStatus('Тип себестоимости создан')
    } finally {
      setProductCostTypeSaving(false)
    }
  }

  async function saveProductCostTypeEdit() {
    const id = productCostTypeEditForm.id
    const name = productCostTypeEditForm.name.trim()
    if (!id || !name) {
      setProductCostStatus('Выберите тип себестоимости и укажите название.')
      return
    }

    setProductCostTypeSaving(true)
    setProductCostStatus('Сохраняем тип себестоимости...')

    try {
      const response = await fetch(`/api/ozon/product-cost-types/${id}`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name,
          isPurchased: productCostTypeEditForm.isPurchased,
          purchaseCost: parseCostInput(productCostTypeEditForm.purchaseCost),
          packagingCost: parseCostInput(productCostTypeEditForm.packagingCost),
          productionCost: parseCostInput(productCostTypeEditForm.productionCost),
        }),
      })

      if (!response.ok) {
        setProductCostStatus(getApiErrorMessage(await response.text(), 'Не удалось сохранить тип себестоимости'))
        return
      }

      const data: ProductCostType = await response.json()
      setProductCostTypes((current) => [...current.filter((type) => type.id !== data.id), data].sort((a, b) => a.name.localeCompare(b.name)))
      fillProductCostTypeEditForm(data)
      setProductCostTypeEditModalOpen(false)
      void loadProductCostProfiles()
      void loadOzonProducts()
      setProductCostStatus('Тип себестоимости сохранен')
    } finally {
      setProductCostTypeSaving(false)
    }
  }

  async function loadKzCatalogSummary(
    marketplace: KzMarketplace = kzMarketplace,
  ): Promise<{ total: number; selling: number; ready: number; archived: number } | null> {
    const label = getKzMarketplaceLabel(marketplace)
    setKzProductsStatus((current) => ({
      ...current,
      [marketplace]: current[marketplace] || `Загружаем сводку каталога ${label}...`,
    }))

    const response = await fetch(`/api/kz/${marketplace}/catalog-summary`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      setKzProductsStatus((current) => ({
        ...current,
        [marketplace]: getApiErrorMessage(errorText, `Не удалось получить сводку ${label}`),
      }))
      return null
    }

    const data: { total: number; selling: number; ready: number; archived: number } = await response.json()
    setKzCatalogSummary((current) => ({
      ...current,
      [marketplace]: {
        total: data.total,
        selling: data.selling,
        ready: data.ready,
        archived: data.archived,
      },
    }))
    setKzProductsStatus((current) => ({
      ...current,
      [marketplace]: current[marketplace]?.startsWith('Загружено')
        ? current[marketplace]
        : `Каталог ${label}: ${data.total} позиций`,
    }))
    return data
  }

  async function loadKzSatuSyncStatus() {
    if (!token) {
      return
    }

    try {
      const response = await fetch('/api/kz/satu/sync-status', {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (!response.ok) {
        return
      }

      const data = await response.json()
      setKzSatuSyncStatus((previous) => {
        if (previous?.status === 'InProgress' && data.status === 'Completed') {
          setKzProductPage(0)
          void loadKzCatalogSummary('satu')
          void loadKzProducts('satu', false, productStatusFilter, null, productSearch, 0)
        } else if (
          data.status === 'InProgress' &&
          data.syncedProducts > (previous?.syncedProducts ?? 0)
        ) {
          void loadKzCatalogSummary('satu')
          void loadKzProducts('satu', false, productStatusFilter, null, productSearch, kzProductPage)
        }

        return data
      })

      if (data.status === 'InProgress' && shopRegion === 'kz' && kzMarketplace === 'satu') {
        setKzProductsStatus((current) => ({
          ...current,
          satu: `Импорт SATU: ${data.syncedProducts} из ${Math.max(data.totalProducts, data.syncedProducts)}`,
        }))
      }
    } catch {
      // ignore polling errors
    }
  }

  async function triggerKzSatuSync(full = true) {
    if (!token) {
      return
    }

    const response = await fetch(`/api/kz/satu/sync?full=${full ? 'true' : 'false'}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      setKzProductsStatus((current) => ({
        ...current,
        satu: getApiErrorMessage(errorText, 'Не удалось запустить синхронизацию SATU'),
      }))
      return
    }

    const data = await response.json()
    setKzSatuSyncStatus(data)
    setKzProductsStatus((current) => ({
      ...current,
      satu: 'Синхронизация SATU запущена...',
    }))
  }

  async function loadKzProducts(
    marketplace: KzMarketplace = kzMarketplace,
    append = false,
    statusFilter: 'all' | 'selling' | 'ready' | 'archived' = productStatusFilter,
    catalogSummary: { total: number; selling: number; ready: number; archived: number } | null = null,
    search = productSearch,
    page = kzProductPage,
  ): Promise<{ loadedCount: number; matchedTotal: number; hasMore: boolean } | null> {
    const label = getKzMarketplaceLabel(marketplace)
    const useLocalCatalog = marketplace === 'satu'
    const pageSize = useLocalCatalog ? kzProductPageSize : 200
    const skip = useLocalCatalog
      ? page * pageSize
      : append
        ? (kzProducts[marketplace]?.length ?? 0)
        : 0
    setKzProductsLoading(true)
    setKzProductsStatus((current) => ({
      ...current,
      [marketplace]: append
        ? `Догружаем товары ${label}...`
        : `Загружаем товары ${label}...`,
    }))

    const params = new URLSearchParams({
      skip: String(skip),
      take: String(pageSize),
    })
    if (statusFilter !== 'all') {
      params.set('status', statusFilter)
    }
    if (search.trim()) {
      params.set('search', search.trim())
    }

    try {
      const response = await fetch(`/api/kz/${marketplace}/products?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (!response.ok) {
        const errorText = await response.text()
        setKzProductsStatus((current) => ({
          ...current,
          [marketplace]: getApiErrorMessage(errorText, `Не удалось получить данные ${label}`),
        }))
        return null
      }

      const data: {
        total: number
        selling: number
        ready: number
        archived: number
        matchedTotal: number
        items: OzonProduct[]
        message?: string | null
      } = await response.json()

      const summaryStatsTotal = data.selling + data.ready + data.archived
      if (summaryStatsTotal > 0 || data.total > data.items.length) {
        setKzCatalogSummary((current) => ({
          ...current,
          [marketplace]: {
            total: data.total,
            selling: data.selling,
            ready: data.ready,
            archived: data.archived,
          },
        }))
      }

      setKzProductsPageFull((current) => ({
        ...current,
        [marketplace]: useLocalCatalog
          ? skip + data.items.length < data.matchedTotal
          : data.items.length >= pageSize,
      }))
      setKzProducts((current) => ({
        ...current,
        [marketplace]: useLocalCatalog || !append ? data.items : [...(current[marketplace] ?? []), ...data.items],
      }))
      const loadedCount = useLocalCatalog ? skip + data.items.length : append ? skip + data.items.length : data.items.length
      const summary = catalogSummary ?? kzCatalogSummary[marketplace]
      const matchedTotal =
        data.matchedTotal > loadedCount
          ? data.matchedTotal
          : summary && summary.total > loadedCount
            ? statusFilter === 'selling'
              ? summary.selling
              : statusFilter === 'ready'
                ? summary.ready
                : statusFilter === 'archived'
                  ? summary.archived
                  : summary.total
            : data.items.length >= pageSize
              ? loadedCount + 1
              : loadedCount
      setKzProductsStatus((current) => ({
        ...current,
        [marketplace]:
          data.message?.trim()
            ? data.message
            : useLocalCatalog
            ? data.matchedTotal > 0
              ? `Страница ${page + 1}: показано ${data.items.length} из ${data.matchedTotal} товаров ${label}`
              : kzSatuSyncStatus?.status === 'InProgress'
                ? `Импорт ${label}: ${kzSatuSyncStatus.syncedProducts} из ${Math.max(kzSatuSyncStatus.totalProducts, kzSatuSyncStatus.syncedProducts)}`
                : `Каталог ${label} пуст. Запустите синхронизацию в настройках.`
            : matchedTotal > loadedCount
            ? `Загружено ${loadedCount} из ${matchedTotal} товаров ${label}`
            : `Загружено товаров ${label}: ${loadedCount}`,
      }))

      return {
        loadedCount,
        matchedTotal,
        hasMore: loadedCount < matchedTotal,
      }
    } finally {
      setKzProductsLoading(false)
    }
  }

  async function loadAllKzProducts(marketplace: KzMarketplace = kzMarketplace) {
    const label = getKzMarketplaceLabel(marketplace)
    setKzProductsLoadingAll(true)
    setKzProductsStatus((current) => ({
      ...current,
      [marketplace]: `Загружаем все товары ${label}...`,
    }))

    try {
      let append = false
      while (true) {
        const result = await loadKzProducts(marketplace, append)
        if (!result?.hasMore) {
          break
        }

        append = true
      }
    } finally {
      setKzProductsLoadingAll(false)
    }
  }

  async function loadKzStocks(marketplace: KzMarketplace = kzMarketplace) {
    const label = getKzMarketplaceLabel(marketplace)
    setKzStocksStatus((current) => ({ ...current, [marketplace]: `Загружаем остатки ${label}...` }))

    const response = await fetch(`/api/kz/${marketplace}/stocks`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      setKzStocksStatus((current) => ({
        ...current,
        [marketplace]: getApiErrorMessage(errorText, `Не удалось получить остатки ${label}`),
      }))
      return
    }

    const data: OzonStock[] = await response.json()
    setKzStocks((current) => ({ ...current, [marketplace]: data }))
    setKzStocksStatus((current) => ({
      ...current,
      [marketplace]: `Получено товаров с остатками ${label}: ${data.length}`,
    }))
    setEditingPrices(
      data.reduce<Record<number, string>>((acc, item) => {
        acc[item.productId] = String(item.price)
        return acc
      }, {}),
    )
  }

  async function loadKzIntegration(marketplace: KzMarketplace) {
    const label = getKzMarketplaceLabel(marketplace)
    setKzIntegrationStatus((current) => ({ ...current, [marketplace]: `Загрузка настроек ${label}...` }))

    const response = await fetch(`/api/kz/${marketplace}/integrations`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!response.ok) {
      setKzIntegrationStatus((current) => ({
        ...current,
        [marketplace]: `Не удалось загрузить настройки ${label}`,
      }))
      return
    }

    const data: KzIntegrationSettings = await response.json()
    setKzIntegrationSettings((current) => ({ ...current, [marketplace]: data }))
    setKzIntegrationStatus((current) => ({
      ...current,
      [marketplace]: data.configured
        ? `${label} API настроен. Обновлено: ${data.updatedAt ? formatDateTime(data.updatedAt) : '—'}`
        : `Укажите ID магазина и API Key ${label}`,
    }))
  }

  async function saveKzIntegration(marketplace: KzMarketplace) {
    const label = getKzMarketplaceLabel(marketplace)
    const form = kzIntegrationForms[marketplace]
    setKzIntegrationSaving((current) => ({ ...current, [marketplace]: true }))
    setKzIntegrationStatus((current) => ({ ...current, [marketplace]: 'Сохранение...' }))

    const response = await fetch(`/api/kz/${marketplace}/integrations`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        merchantId: form.merchantId.trim(),
        apiKey: form.apiKey.trim(),
      }),
    })

    setKzIntegrationSaving((current) => ({ ...current, [marketplace]: false }))
    if (!response.ok) {
      const message = await response.text()
      setKzIntegrationStatus((current) => ({
        ...current,
        [marketplace]: message || `Не удалось сохранить настройки ${label}`,
      }))
      return
    }

    const data: KzIntegrationSettings = await response.json()
    setKzIntegrationSettings((current) => ({ ...current, [marketplace]: data }))
    setKzIntegrationForms((current) => ({
      ...current,
      [marketplace]: { merchantId: '', apiKey: '' },
    }))
    setKzIntegrationStatus((current) => ({
      ...current,
      [marketplace]: `Настройки ${label} сохранены`,
    }))
  }

  async function testKzIntegration(marketplace: KzMarketplace) {
    const label = getKzMarketplaceLabel(marketplace)
    setKzIntegrationStatus((current) => ({ ...current, [marketplace]: `Проверка ${label}...` }))

    const response = await fetch(`/api/kz/${marketplace}/integrations/test`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!response.ok) {
      setKzIntegrationStatus((current) => ({
        ...current,
        [marketplace]: `Не удалось проверить ${label}`,
      }))
      return
    }

    const data: { success: boolean; message: string } = await response.json()
    setKzIntegrationStatus((current) => ({
      ...current,
      [marketplace]: data.message || (data.success ? `${label} подключён` : `Ошибка ${label}`),
    }))
  }

  function handleShopRegionChange(region: ShopRegion) {
    setShopRegion(region)
    localStorage.setItem(SHOP_REGION_STORAGE_KEY, region)
    const nextTaskMode = getDefaultTaskFormMode(region, user?.role, kzTaskMarketplace)
    if (region === 'kz') {
      setProductionCatalogTab(
        isNovinkaCatalogTab(productionCatalogTab)
          ? toNovinkaCatalogTab(kzMarketplace)
          : kzMarketplace,
      )
      setTaskFormMode(nextTaskMode)
      setAnalytics(null)
      setAnalyticsSnapshot(null)
      setHomeAnalytics(null)
      setHomeKzAnalytics({ kaspi: null, satu: null, halyk: null })
      setHomeKzAnalyticsStatus({ kaspi: '', satu: '', halyk: '' })
      setAnalyticsStatus('')
      if (activeTab === 'supplies') {
        setActiveTab('home')
      }
    } else {
      setProductionCatalogTab(
        isNovinkaCatalogTab(productionCatalogTab) ? 'novinka-ozon' : 'ozon',
      )
      setTaskFormMode(nextTaskMode)
      setHomeKzAnalytics({ kaspi: null, satu: null, halyk: null })
      setHomeKzAnalyticsStatus({ kaspi: '', satu: '', halyk: '' })
      setAnalyticsStatus('')
    }
  }

  function handleKzMarketplaceChange(marketplace: KzMarketplace) {
    setKzMarketplace(marketplace)
    localStorage.setItem(KZ_MARKETPLACE_STORAGE_KEY, marketplace)
    if (productionCatalogTab === 'kaspi' || productionCatalogTab === 'satu' || productionCatalogTab === 'halyk') {
      setProductionCatalogTab(marketplace)
    } else if (isNovinkaCatalogTab(productionCatalogTab)) {
      setProductionCatalogTab(toNovinkaCatalogTab(marketplace))
    }
  }

  function handleKzTaskMarketplaceChange(marketplace: KzMarketplace) {
    setKzTaskMarketplace(marketplace)
    localStorage.setItem(KZ_MARKETPLACE_STORAGE_KEY, marketplace)
    setTaskFormMode(marketplace)
    setSelectedTaskNovinkaOfferId('')
  }

  async function loadOzonStocks() {
    setStockStatus('Загружаем остатки со склада Ozon...')

    const response = await fetch('/api/ozon/stocks', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      setStockStatus(getApiErrorMessage(await response.text(), 'Не удалось получить остатки Ozon'))
      return
    }

    const data: OzonStock[] = await response.json()
    setOzonStocks(data)
    setStockStatus(`Получено товаров с остатками: ${data.length}`)
    setEditingPrices(
      data.reduce<Record<number, string>>((acc, item) => {
        acc[item.productId] = String(item.price)
        return acc
      }, {}),
    )
  }

  async function updateOzonPrice(item: OzonStock) {
    const price = Number(editingPrices[item.productId]?.replace(',', '.'))
    if (!Number.isFinite(price) || price <= 0) {
      setPriceStatus('Введите корректную цену')
      return
    }

    setPriceStatus(`Отправляем цену для ${item.offerId}...`)
    const response = await fetch('/api/ozon/prices', {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        productId: item.productId,
        offerId: item.offerId,
        price,
        oldPrice: item.oldPrice,
        minPrice: item.minPrice,
        currencyCode: item.currencyCode || 'KZT',
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      setPriceStatus(getApiErrorMessage(errorText, 'Не удалось изменить цену в Ozon'))
      return
    }

    const result: { success?: boolean; message?: string } = await response.json()
    if (result.success === false) {
      setPriceStatus(result.message || 'Ozon не принял новую цену')
      return
    }

    setPriceStatus(result.message || `Цена для ${item.offerId} успешно отправлена в Ozon`)
    setOzonStocks((current) =>
      current.map((stock) => (stock.productId === item.productId ? { ...stock, price } : stock)),
    )
  }

  async function loadHomeAnalytics() {
    setHomeAnalyticsStatus('Загружаем аналитику за текущий месяц...')

    const params = new URLSearchParams({
      dateFrom: getDefaultAnalyticsDateFrom(),
      dateTo: getDefaultAnalyticsDateTo(),
    })

    const response = await fetch(`/api/ozon/analytics?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      setHomeAnalyticsStatus(getApiErrorMessage(await response.text(), 'Не удалось получить аналитику Ozon'))
      return
    }

    const data: OzonAnalytics = await response.json()
    setHomeAnalytics(data)
    setHomeAnalyticsStatus(`Обновлено: ${new Date(data.timestamp).toLocaleString('ru-RU')}`)
  }

  async function loadHomeKzAnalytics(marketplace: KzMarketplace, forceRefresh = false) {
    const label = getKzMarketplaceLabel(marketplace)
    setHomeKzAnalyticsStatus((current) => ({
      ...current,
      [marketplace]: `Загружаем аналитику ${label} за текущий месяц...`,
    }))

    const params = new URLSearchParams({
      dateFrom: getDefaultAnalyticsDateFrom(),
      dateTo: getDefaultAnalyticsDateTo(),
    })
    if (forceRefresh) {
      params.set('forceRefresh', 'true')
    }

    const response = await fetch(`/api/kz/${marketplace}/analytics?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      const errorText = await response.text()
      setHomeKzAnalyticsStatus((current) => ({
        ...current,
        [marketplace]: getApiErrorMessage(
          errorText,
          `Не удалось получить аналитику ${label}`,
        ),
      }))
      return
    }

    const data: OzonAnalytics = await response.json()
    setHomeKzAnalytics((current) => ({ ...current, [marketplace]: data }))
    setHomeKzAnalyticsStatus((current) => ({
      ...current,
      [marketplace]: `Обновлено: ${new Date(data.timestamp).toLocaleString('ru-RU')}`,
    }))
  }

  function loadAllHomeKzAnalytics() {
    for (const marketplace of ['kaspi', 'satu', 'halyk'] as const) {
      void loadHomeKzAnalytics(marketplace)
    }
  }

  function openTab(
    tab: TabId,
    subTab?: {
      production?: ProductionSubTab
      supply?: SupplySubTab
      analytics?: AnalyticsSubTab
      taskUrgency?: 'all' | 'urgent' | 'normal'
    },
  ) {
    setActiveTab(tab)

    if (subTab?.production) {
      setProductionSubTab(subTab.production)
    }

    if (subTab?.taskUrgency) {
      setTaskUrgencyFilter(subTab.taskUrgency)
    }

    if (subTab?.supply) {
      setSupplySubTab(subTab.supply)
    }

    if (subTab?.analytics) {
      setAnalyticsSubTab(subTab.analytics)
      setAnalyticsDateFrom(getDefaultAnalyticsDateFrom())
      setAnalyticsDateTo(getDefaultAnalyticsDateTo())
    }
  }

  function applyKzAnalytics(data: OzonAnalytics) {
    setAnalytics(data)
    setAnalyticsSnapshot({
      totalProductsCount:
        data.sellingProductsCount + data.readyForSaleProductsCount + data.archivedProductsCount,
      sellingProductsCount: data.sellingProductsCount,
      readyForSaleProductsCount: data.readyForSaleProductsCount,
      archivedProductsCount: data.archivedProductsCount,
      accountBalance: data.accountBalance ?? null,
      accountBalanceCurrency: data.accountBalanceCurrency,
      timestamp: data.timestamp,
    })
  }

  async function loadKzAnalyticsSnapshot(marketplace: KzMarketplace = kzMarketplace) {
    const label = getKzMarketplaceLabel(marketplace)
    setAnalyticsSnapshot(null)
    setAnalyticsStatus(`Загружаем сводку каталога ${label}...`)

    const response = await fetch(`/api/kz/${marketplace}/analytics/snapshot`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      setAnalyticsStatus(getApiErrorMessage(await response.text(), `Не удалось получить сводку ${label}`))
      return
    }

    const data: OzonAnalyticsSnapshot = await response.json()
    setAnalyticsSnapshot(data)
    setAnalyticsStatus(`Каталог ${label}: ${data.totalProductsCount} позиций. Загружаем заказы...`)
  }

  async function loadKzAnalyticsBundle(marketplace: KzMarketplace = kzMarketplace, forceRefresh = false) {
    await loadKzAnalyticsSnapshot(marketplace)
    await loadKzAnalytics(marketplace, forceRefresh)
  }

  async function loadKzUnsoldProducts(marketplace: KzMarketplace = kzMarketplace) {
    const label = getKzMarketplaceLabel(marketplace)
    setAnalyticsStatus(`Загружаем товары без продаж ${label}...`)

    const params = new URLSearchParams()
    if (analyticsDateFrom) {
      params.set('dateFrom', analyticsDateFrom)
    }
    if (analyticsDateTo) {
      params.set('dateTo', analyticsDateTo)
    }
    params.set('skip', '0')
    params.set('take', '200')

    const response = await fetch(`/api/kz/${marketplace}/analytics/unsold?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      setAnalyticsStatus(getApiErrorMessage(await response.text(), `Не удалось загрузить товары без продаж ${label}`))
      setKzUnsoldProducts([])
      setKzUnsoldTotal(0)
      return
    }

    const data: { total: number; items: OzonAnalytics['unsoldProducts'] } = await response.json()
    setKzUnsoldProducts(data.items)
    setKzUnsoldTotal(data.total)
    setAnalyticsStatus(`Без продаж ${label}: показано ${data.items.length} из ${data.total}`)
  }

  async function loadRfUnsoldProducts() {
    setAnalyticsStatus('Загружаем товары без продаж OZON...')

    const response = await fetch('/api/ozon/analytics/unsold', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      setAnalyticsStatus(getApiErrorMessage(await response.text(), 'Не удалось загрузить товары без продаж'))
      setRfUnsoldProducts([])
      setRfUnsoldTotal(0)
      setRfUnsoldTimestamp('')
      return
    }

    const data: { total: number; items: OzonAnalytics['unsoldProducts']; timestamp: string } = await response.json()
    setRfUnsoldProducts(data.items)
    setRfUnsoldTotal(data.total)
    setRfUnsoldTimestamp(data.timestamp)
    setAnalyticsStatus(`Без продаж OZON: ${data.total} товаров · обновлено ${data.timestamp}`)
  }

  async function loadKzAnalytics(marketplace: KzMarketplace = kzMarketplace, forceRefresh = false) {
    const label = getKzMarketplaceLabel(marketplace)
    setAnalytics(null)
    setAnalyticsStatus(`Загружаем заказы ${label}...`)

    const params = new URLSearchParams()
    if (analyticsDateFrom) {
      params.set('dateFrom', analyticsDateFrom)
    }
    if (analyticsDateTo) {
      params.set('dateTo', analyticsDateTo)
    }
    if (forceRefresh) {
      params.set('forceRefresh', 'true')
    }

    const response = await fetch(`/api/kz/${marketplace}/analytics?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      setAnalyticsStatus(getApiErrorMessage(await response.text(), `Не удалось получить аналитику ${label}`))
      return
    }

    const data: OzonAnalytics = await response.json()
    applyKzAnalytics(data)
    setAnalyticsStatus(`Аналитика ${label} за период обновлена: ${data.timestamp}`)
  }

  async function loadAnalytics() {
    setAnalytics(null)
    setAnalyticsSnapshot(null)
    setAnalyticsStatus('Загружаем аналитику Ozon за период...')

    const params = new URLSearchParams()
    if (analyticsDateFrom) {
      params.set('dateFrom', analyticsDateFrom)
    }
    if (analyticsDateTo) {
      params.set('dateTo', analyticsDateTo)
    }

    const response = await fetch(`/api/ozon/analytics?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      setAnalyticsStatus(getApiErrorMessage(await response.text(), 'Не удалось получить аналитику Ozon'))
      return
    }

    const data: OzonAnalytics = await response.json()
    setAnalytics(data)
    setAnalyticsSnapshot({
      totalProductsCount:
        data.sellingProductsCount + data.readyForSaleProductsCount + data.archivedProductsCount,
      sellingProductsCount: data.sellingProductsCount,
      readyForSaleProductsCount: data.readyForSaleProductsCount,
      archivedProductsCount: data.archivedProductsCount,
      accountBalance: data.accountBalance ?? null,
      accountBalanceCurrency: data.accountBalanceCurrency,
      timestamp: data.timestamp,
    })
    setAnalyticsStatus(`Аналитика за период обновлена: ${data.timestamp}`)
  }

  async function refreshAnalytics() {
    if (shopRegion === 'kz') {
      if (analyticsSubTab === 'production') {
        await loadProductionAnalyticsReport()
        return
      }

      if (analyticsSubTab === 'noSales' && showKzFullAnalytics) {
        await loadKzUnsoldProducts()
        return
      }

      if (showKzFullAnalytics) {
        await loadKzAnalyticsBundle(kzMarketplace, true)
      }

      return
    }

    if (analyticsSubTab === 'production') {
      await loadProductionAnalyticsReport()
      return
    }

    if (analyticsSubTab === 'internal') {
      await Promise.all([loadAnalytics(), loadOzonProducts(), loadOzonStocks(), loadSupplies(), loadInternalSupplyExpenses()])
      setAnalyticsStatus(`Внутренняя аналитика обновлена: ${new Date().toLocaleString('ru-RU')}`)
      return
    }

    if (analyticsSubTab === 'noSales') {
      await loadRfUnsoldProducts()
      return
    }

    await loadAnalytics()
  }

  async function loadProductionAnalyticsAssignees() {
    const response = await productionApi.fetchProductionAnalyticsAssignees(token)

    if (!response.ok) {
      setProductionAnalyticsAssignees([])
      return
    }

    const data = await productionApi.parseProductionAnalyticsAssignees(response)
    setProductionAnalyticsAssignees(data)
  }

  async function loadProductionAnalyticsReport() {
    setProductionAnalyticsStatus('Загружаем отчёт по производству...')

    const params = new URLSearchParams()
    if (productionAnalyticsDateFrom) {
      params.set('dateFrom', productionAnalyticsDateFrom)
    }
    if (productionAnalyticsDateTo) {
      params.set('dateTo', productionAnalyticsDateTo)
    }
    if (productionAnalyticsUserId.trim()) {
      params.set('userId', productionAnalyticsUserId.trim())
    }

    const response = await productionApi.fetchProductionAnalyticsReport(token, params)

    if (!response.ok) {
      setProductionAnalyticsStatus(getApiErrorMessage(await response.text(), 'Не удалось загрузить отчёт'))
      return
    }

    const data = await productionApi.parseProductionAnalyticsReport(response)
    setProductionAnalyticsReport(data)
    setProductionAnalyticsStatus(
      `Отчёт обновлён: ${data.summary.length} исполнителей · ${data.tasks.length} задач`,
    )
  }

  async function exportProductionAnalyticsExcel(userId?: string) {
    const params = new URLSearchParams()
    if (productionAnalyticsDateFrom) {
      params.set('dateFrom', productionAnalyticsDateFrom)
    }
    if (productionAnalyticsDateTo) {
      params.set('dateTo', productionAnalyticsDateTo)
    }
    const targetUserId = userId ?? productionAnalyticsUserId.trim()
    if (targetUserId) {
      params.set('userId', targetUserId)
    }

    const response = await productionApi.exportProductionAnalytics(token, params)

    if (!response.ok) {
      setProductionAnalyticsStatus('Не удалось выгрузить Excel')
      return
    }

    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `production-analytics-${new Date().toISOString().slice(0, 10)}.xlsx`
    link.click()
    URL.revokeObjectURL(url)
    setProductionAnalyticsStatus('Отчёт выгружен в Excel')
  }

  async function saveProductionAnalyticsRecord(task: ProductionTask) {
    const response = await productionApi.updateProductionAnalyticsRecord(token, task.id, {
        completedAt: task.completedAt ? new Date(task.completedAt).toISOString() : undefined,
        assignedUserName: task.assignedUserName ?? '',
        ozonProductId: task.ozonProductId,
        offerId: task.offerId,
        productName: task.productName,
        requiredQuantity: task.requiredQuantity,
        actualQuantity: task.actualQuantity ?? 0,
        taskType: task.taskType ?? 'Ozon',
        isUrgent: task.isUrgent,
        createdByDisplayName: task.createdByDisplayName ?? '',
        createdAt: task.createdAt ? new Date(task.createdAt).toISOString() : undefined,
        startedAt: task.startedAt ? new Date(task.startedAt).toISOString() : undefined,
        items: getProductionTaskItems(task).map((item) => ({
          id: item.id,
          ozonProductId: item.ozonProductId,
          offerId: item.offerId,
          productName: item.productName,
          productLink: item.productLink ?? '',
          requiredQuantity: item.requiredQuantity,
          actualQuantity: item.actualQuantity ?? 0,
          enforceMinimumQuantity: item.enforceMinimumQuantity ?? false,
          filePath: item.filePath ?? '',
        })),
    })

    if (!response.ok) {
      setProductionAnalyticsStatus(getApiErrorMessage(await response.text(), 'Не удалось сохранить запись'))
      return false
    }

    setProductionAnalyticsEditingTask(null)
    await loadProductionAnalyticsReport()
    setProductionAnalyticsStatus('Запись аналитики обновлена')
    return true
  }

  async function exportAnalyticsOrderRowsExcel(
    rows: OzonAnalytics['orderRows'],
    fileName: string,
    sheetName: string,
  ) {
    if (rows.length === 0) {
      setAnalyticsStatus('Нет данных для выгрузки')
      return
    }

    const response = await fetch('/api/ozon/analytics/export', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sheetName,
        fileName,
        rows: buildAnalyticsExportRows(rows),
      }),
    })

    if (!response.ok) {
      setAnalyticsStatus(getApiErrorMessage(await response.text(), 'Не удалось выгрузить Excel'))
      return
    }

    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`
    link.click()
    URL.revokeObjectURL(url)
    setAnalyticsStatus(`Excel выгружен: ${rows.length} строк`)
  }

  function exportCurrentAnalyticsExcel() {
    const statusLabels: Record<typeof analyticsStatusFilter, string> = {
      all: 'vse',
      awaiting_deliver: 'sobirayutsya',
      delivering: 'edut',
      delivered: 'dostavleny',
      cancelled: 'otmeneny',
    }
    const statusSheetNames: Record<typeof analyticsStatusFilter, string> = {
      all: 'Все заказы',
      awaiting_deliver: 'Собираются',
      delivering: 'Едут',
      delivered: 'Доставлены',
      cancelled: 'Отменены',
    }
    const period =
      analyticsDateFrom && analyticsDateTo ? `${analyticsDateFrom}_${analyticsDateTo}` : 'period'
    void exportAnalyticsOrderRowsExcel(
      exportableAnalyticsRows,
      `analytics-${statusLabels[analyticsStatusFilter]}-${period}`,
      statusSheetNames[analyticsStatusFilter],
    )
  }

  function exportAnalyticsProductExcel(group: AnalyticsProductGroup) {
    const rows = group.byDate.flatMap((dateGroup) => dateGroup.rows)
    const safeName = group.productName.replace(/[^\p{L}\p{N}_\s-]+/gu, '').trim().slice(0, 40) || 'product'
    const period =
      analyticsDateFrom && analyticsDateTo ? `${analyticsDateFrom}_${analyticsDateTo}` : 'period'
    void exportAnalyticsOrderRowsExcel(rows, `analytics-${safeName}-${period}`, safeName)
  }

  async function loadProductionFiles(search: string) {
    const [filesResponse, pathsResponse] = await productionApi.fetchProductionFiles(token, search)

    if (!filesResponse.ok) {
      setProductionStatus('Не удалось загрузить данные производства')
      setProductionFiles([])
      setProductionFilePaths([])
      return
    }

    const data = await productionApi.parseProductionFiles(filesResponse)
    setProductionFiles(data)
    if (pathsResponse.ok) {
      const paths = await productionApi.parseProductionFilePaths(pathsResponse)
      setProductionFilePaths(paths)
    } else {
      setProductionFilePaths([])
    }
  }

  async function uploadProductionFileForTaskItem(
    item: ProductionTaskItem,
    file: File,
    taskType?: ProductionTask['taskType'],
  ) {
    if (!file.type.startsWith('image/')) {
      setTaskStatus('Для дизайнерской задачи загрузите изображение-превью')
      return
    }

    const marketplace = resolveNovinkaMarketplaceFromTaskType(taskType, shopRegion, kzTaskMarketplace)
    const formData = new FormData()
    formData.append('taskItemId', item.id)
    formData.append('ozonProductId', item.ozonProductId > 0 ? String(item.ozonProductId) : '0')
    formData.append('offerId', item.offerId)
    formData.append('productName', item.productName)
    formData.append('productLink', item.productLink ?? '')
    formData.append('notes', appendNovinkaMarketplaceNote('', marketplace))
    formData.append('file', file)

    const response = await productionApi.uploadProductionFile(token, formData)

    if (!response.ok) {
      setTaskStatus('Не удалось загрузить превью')
      return
    }

    setTaskStatus('Превью загружено')
    await loadProductionFiles(productionSearch)
  }

  async function saveProductionTaskItemFilePath(
    taskId: string,
    item: ProductionTaskItem,
    path: string,
  ) {
    const response = await productionApi.saveProductionTaskItemFilePath(token, taskId, item.id, path)

    if (!response.ok) {
      setTaskStatus(getApiErrorMessage(await response.text(), 'Не удалось сохранить путь'))
      return
    }

    setTaskStatus('Путь к файлу сохранён')
    await loadProductionTasks()
    await loadProductionFiles(productionSearch)
  }

  async function deleteProductionTaskItemFilePath(taskId: string, item: ProductionTaskItem) {
    const response = await productionApi.deleteProductionTaskItemFilePath(token, taskId, item.id)

    if (!response.ok) {
      setTaskStatus(getApiErrorMessage(await response.text(), 'Не удалось удалить путь'))
      return
    }

    setTaskStatus('Путь к файлу удалён')
    await loadProductionTasks()
    await loadProductionFiles(productionSearch)
  }

  async function saveProductionTaskItemActualQuantity(
    taskId: string,
    item: ProductionTaskItem,
    actualQuantity: number,
  ) {
    const response = await productionApi.saveProductionTaskItemActualQuantity(
      token,
      taskId,
      item.id,
      actualQuantity,
    )

    if (!response.ok) {
      setTaskStatus(getApiErrorMessage(await response.text(), 'Не удалось сохранить факт'))
      return
    }

    setActualQuantities((current) => ({
      ...current,
      [item.id]: String(actualQuantity),
    }))
    setTaskStatus(`Факт сохранён: ${item.productName} — ${actualQuantity} шт.`)
    await loadProductionTasks()
  }

  async function packProductionTaskItem(task: ProductionTask, item: ProductionTaskItem) {
    const response = await productionApi.packProductionTaskItem(token, task.id, item.id)

    if (!response.ok) {
      setTaskStatus(getApiErrorMessage(await response.text(), 'Не удалось упаковать товар'))
      return
    }

    setTaskStatus(`Товар упакован: ${item.productName}`)
    await loadProductionTasks()
    await loadSupplies()
  }

  function openTransferDesignerItemModal(task: ProductionTask, item: ProductionTaskItem) {
    setTransferDesignerItem({ task, item })
    setTransferDesignerUserId(designerTransferUsers[0]?.id ?? '')
  }

  function closeTransferDesignerItemModal() {
    setTransferDesignerItem(null)
    setTransferDesignerUserId('')
  }

  async function transferDesignerTaskItem() {
    if (!transferDesignerItem || !transferDesignerUserId) {
      setTaskStatus('Выберите дизайнера')
      return
    }

    const response = await productionApi.transferDesignerTaskItem(
      token,
      transferDesignerItem.task.id,
      transferDesignerItem.item.id,
      transferDesignerUserId,
    )

    if (!response.ok) {
      setTaskStatus(getApiErrorMessage(await response.text(), 'Не удалось передать товар'))
      return
    }

    const targetUser = designerTransferUsers.find((item) => item.id === transferDesignerUserId)
    setTaskStatus(
      `Товар передан: ${transferDesignerItem.item.productName}${targetUser ? ` · ${targetUser.displayName || targetUser.userName}` : ''}`,
    )
    closeTransferDesignerItemModal()
    await loadProductionTasks()
  }

  async function saveProductionTaskItemRequiredQuantity(
    taskId: string,
    item: ProductionTaskItem,
    requiredQuantity: number,
  ) {
    const response = await productionApi.saveProductionTaskItemRequiredQuantity(
      token,
      taskId,
      item.id,
      requiredQuantity,
    )

    if (!response.ok) {
      setTaskStatus(getApiErrorMessage(await response.text(), 'Не удалось сохранить план'))
      return
    }

    setTaskStatus(`План сохранён: ${item.productName} — ${requiredQuantity} шт.`)
    await loadProductionTasks()
  }

  async function downloadProductionFile(id: string) {
    const response = await productionApi.downloadProductionFile(token, id)

    if (!response.ok) {
      setProductionStatus('Не удалось скачать файл')
      return
    }

    const blob = await response.blob()
    const contentDisposition = response.headers.get('content-disposition') ?? ''
    const fileNameMatch = contentDisposition.match(/filename\*=UTF-8''([^;]+)|filename="?([^"]+)"?/i)
    const fileName = decodeURIComponent(fileNameMatch?.[1] ?? fileNameMatch?.[2] ?? 'production-file')
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')

    link.href = url
    link.download = fileName
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  async function deleteProductionFile(id: string) {
    if (!window.confirm('Удалить превью?')) {
      return
    }

    const notify = (message: string) => {
      if (productionSubTab === 'products') {
        setProductionStatus(message)
      } else {
        setTaskStatus(message)
      }
    }

    try {
      const response = await productionApi.deleteProductionFile(token, id)

      if (!response.ok) {
        const message = await response.text()
        notify(message || 'Не удалось удалить файл')
        return
      }

      let reworkTaskCreated = false
      try {
        const payload = (await response.json()) as { reworkTaskCreated?: boolean }
        reworkTaskCreated = Boolean(payload.reworkTaskCreated)
      } catch {
        reworkTaskCreated = false
      }

      await loadProductionFiles(productionSearch)
      await loadProductionTasks()

      notify(
        reworkTaskCreated
          ? 'Превью удалено. Товар убран из списка, создана новая задача для новинки.'
          : 'Превью удалено',
      )

      if (reworkTaskCreated) {
        setProductionSubTab('tasks')
      }

      setProductionFilesModal((current) => {
        if (!current) {
          return null
        }

        const files = current.files.filter((file) => file.id !== id)
        return files.length > 0 ? { ...current, files } : null
      })
    } catch {
      notify('Не удалось удалить файл')
    }
  }

  function openProductionFilesModal(productName: string, files: ProductionFile[]) {
    if (files.length === 0) {
      return
    }

    setProductionFilesModal({ productName, files })
  }

  function markTaskNotificationsSeen(
    kind: 'new' | 'in-progress' | 'cancelled' | 'completed',
    taskIds: string[],
  ) {
    if (!user?.id || taskIds.length === 0) {
      return
    }

    const storageKey = getTaskNotificationStorageKey(user.id, kind)
    const updateState =
      kind === 'new'
        ? setSeenNewTaskNotificationIds
        : kind === 'in-progress'
          ? setSeenInProgressTaskNotificationIds
          : kind === 'cancelled'
            ? setSeenCancelledTaskNotificationIds
            : setSeenCompletedTaskNotificationIds

    updateState((current) => {
      const next = Array.from(new Set([...current, ...taskIds]))
      localStorage.setItem(storageKey, JSON.stringify(next))
      return next
    })
  }

  function markSupplyNotificationsSeen(supplyIds: string[]) {
    if (!user?.id || supplyIds.length === 0) {
      return
    }

    const storageKey = getSupplyNotificationStorageKey(user.id)
    setSeenCreatedSupplyIds((current) => {
      const next = Array.from(new Set([...current, ...supplyIds]))
      localStorage.setItem(storageKey, JSON.stringify(next))
      return next
    })
  }

  function markSupplyAnalyticsSeen(keys: string[]) {
    if (!user?.id || keys.length === 0) {
      return
    }

    const storageKey = getSupplyAnalyticsNotificationStorageKey(user.id)
    setSeenSupplyAnalyticsKeys((current) => {
      const next = Array.from(new Set([...current, ...keys]))
      localStorage.setItem(storageKey, JSON.stringify(next))
      return next
    })
  }

  function markChatNotificationsSeen(chatType: 'user' | 'group', chatId: string) {
    setChatThreads((current) =>
      current.map((item) =>
        item.type === chatType && item.id === chatId ? { ...item, unreadCount: 0 } : item,
      ),
    )
  }

  function markVisibleNotificationsSeen() {
    markTaskNotificationsSeen('new', unseenNewProductionTasks.map((task) => task.id))
    markTaskNotificationsSeen('cancelled', unseenCancelledForCreator.map((task) => task.id))
    markSupplyNotificationsSeen(unseenCreatedSupplies.map((supply) => supply.id))
    markSupplyAnalyticsSeen(supplyAnalytics.map((item) => getSupplyAnalyticsRowKey(item)))
    chatThreads
      .filter((item) => (item.unreadCount ?? 0) > 0)
      .forEach((item) => markChatNotificationsSeen(item.type, item.id))
  }

  async function loadProductionTasks() {
    const response = await productionApi.fetchProductionTasks(token)

    if (!response.ok) {
      setTaskStatus('Не удалось загрузить задачи')
      return
    }

    const data = await productionApi.parseProductionTasks(response)
    const newTasks = data.filter((task) => task.status === 'New' && !task.isArchived)
    const previousTaskIds = knownNewTaskIdsRef.current
    const nextTaskIds = new Set(newTasks.map((task) => task.id))
    const reopenedTaskIds = data
      .filter(
        (task) =>
          task.status === 'New' &&
          !task.isArchived &&
          productionTaskStatusRef.current[task.id] === 'Completed',
      )
      .map((task) => task.id)

    if (reopenedTaskIds.length > 0 && user?.id) {
      setSeenNewTaskNotificationIds((current) => {
        const next = current.filter((id) => !reopenedTaskIds.includes(id))
        localStorage.setItem(getTaskNotificationStorageKey(user.id, 'new'), JSON.stringify(next))
        return next
      })
    }

    if (previousTaskIds) {
      const arrivedTasks = newTasks.filter(
        (task) =>
          !previousTaskIds.has(task.id) && !isSameUserId(task.createdByUserId, user?.id),
      )
      if (arrivedTasks.length > 0) {
        showBrowserNotification(
          'Новая задача',
          arrivedTasks.length === 1
            ? getProductionTaskSummary(arrivedTasks[0])
            : `Новых задач: ${arrivedTasks.length}`,
        )
      }
    }

    const cancelledForCreator = data.filter(
      (task) =>
        task.status === 'Cancelled' &&
        !task.isArchived &&
        isSameUserId(task.createdByUserId, user?.id) &&
        !isSameUserId(task.cancelledByUserId, user?.id),
    )
    const previousCancelledForCreator = knownCancelledForCreatorRef.current
    if (previousCancelledForCreator) {
      const newlyCancelled = cancelledForCreator.filter((task) => !previousCancelledForCreator.has(task.id))
      if (newlyCancelled.length > 0) {
        showBrowserNotification(
          'Задача отменена',
          newlyCancelled.length === 1
            ? `${getProductionTaskSummary(newlyCancelled[0])}${newlyCancelled[0].cancellationComment ? `: ${newlyCancelled[0].cancellationComment}` : ''}`
            : `Отменено ваших задач: ${newlyCancelled.length}`,
        )
      }
    }
    knownCancelledForCreatorRef.current = new Set(cancelledForCreator.map((task) => task.id))

    knownNewTaskIdsRef.current = nextTaskIds
    productionTaskStatusRef.current = Object.fromEntries(data.map((task) => [task.id, task.status]))
    setProductionTasks(data)
  }

  async function loadProductionDesigners() {
    const response = await productionApi.fetchProductionDesigners(token)

    if (!response.ok) {
      return
    }

    const data = (await response.json()) as User[]
    setProductionDesigners(data)
  }

  function resetTaskForm() {
    setDraftTaskItems([])
    setTaskIsUrgent(false)
    setSelectedTaskProductId('')
    setSelectedTaskNovinkaOfferId('')
    setTaskQuantity('')
    setTaskNovinkaQuantity('')
    setTaskDueAt('')
    setTaskEditorKind('production')
    setEditingTaskId(null)
  }

  function resetNovinkaTaskForm() {
    setDraftNovinkaItems([])
    setNovinkaProductName('')
    setNovinkaProductLink('')
    setTaskIsUrgent(false)
    setTaskDueAt('')
    setTaskEditorKind('novinka')
    setEditingTaskId(null)
    setTaskFormStatus('')
  }

  function openCreateNovinkaTaskModal() {
    resetNovinkaTaskForm()
    setNovinkaTaskMarketplace(shopRegion === 'rf' ? 'ozon' : kzTaskMarketplace)
    setShowCreateNovinkaTaskModal(true)
  }

  function closeNovinkaTaskFormModal() {
    setShowCreateNovinkaTaskModal(false)
    resetNovinkaTaskForm()
  }

  function addDraftNovinkaToOzonTask() {
    const quantity = Number(taskNovinkaQuantity)
    const selectedNovinka = taskFormNovinkaCatalogItems.find(
      (item) => item.offerId === selectedTaskNovinkaOfferId,
    )

    if (!selectedNovinka || !Number.isFinite(quantity) || quantity <= 0) {
      setTaskFormStatus('Выберите новинку из списка и укажите количество')
      return
    }

    const selectedNovinkaPreviewCount = getProductionFilesForCatalogItem(
      selectedNovinka,
      productionFiles,
    ).filter((file) => file.contentType.startsWith('image/')).length

    if (selectedNovinkaPreviewCount <= 0) {
      setTaskFormStatus('У выбранной новинки нет превью')
      return
    }

    if (isProductAlreadyInDraftTask(draftTaskItems, selectedNovinka)) {
      setTaskFormStatus('Товар уже добавлен в эту задачу')
      return
    }

    setDraftTaskItems((current) => [
      ...current,
      {
        tempId: createTempId(),
        ozonProductId: selectedNovinka.ozonProductId ?? 0,
        offerId: selectedNovinka.offerId,
        productName: selectedNovinka.productName,
        productLink: selectedNovinka.productLink,
        imageUrl: '',
        requiredQuantity: quantity,
        enforceMinimumQuantity: false,
        isNovinka: true,
      },
    ])
    setSelectedTaskNovinkaOfferId('')
    setTaskNovinkaQuantity('')
    setTaskFormStatus('')
    setTaskStatus('Новинка добавлена в задачу')
  }

  async function convertNovinkaToOzon() {
    if (!canEditProductionProducts()) {
      setProductEditorStatus('Нет доступа к редактированию товара.')
      return
    }

    const sourceNovinka = editorNovinkaCatalogItems.find((item) => item.offerId === editorNovinkaOfferId)
    const targetOzonProductId = Number(editorOzonProductId)

    if (!sourceNovinka) {
      setProductEditorStatus('Выберите новинку из списка.')
      return
    }

    if (!Number.isFinite(targetOzonProductId) || targetOzonProductId <= 0) {
      setProductEditorStatus(
        shopRegion === 'rf'
          ? 'Выберите товар Ozon из списка.'
          : `Выберите товар ${getKzMarketplaceLabel(kzMarketplace)} из списка.`,
      )
      return
    }

    setProductEditorSaving(true)
    setProductEditorStatus('')

    try {
      const response = await productionApi.convertNovinkaCatalogToOzon(token, {
        sourceOfferId: sourceNovinka.offerId,
        sourceProductName: sourceNovinka.productName,
        sourceProductLink: sourceNovinka.productLink,
        targetOzonProductId,
      })

      if (!response.ok) {
        const message = await response.text()
        setProductEditorStatus(message || 'Не удалось изменить тип товара.')
        return
      }

      const result = (await response.json()) as {
        updatedFileCount: number
        offerId: string
        productName: string
        productUrl: string
      }

      await loadProductionFiles(productionSearch)
      setEditorNovinkaOfferId('')
      setEditorOzonProductId('')
      setProductionCatalogTab(shopRegion === 'rf' ? 'ozon' : kzMarketplace)
      setProductEditorStatus(
        shopRegion === 'rf'
          ? `Тип изменён на Ozon: ${result.productName} (${result.offerId}). Превью сохранено: ${result.updatedFileCount}.`
          : `Тип изменён на ${getKzMarketplaceLabel(kzMarketplace)}: ${result.productName} (${result.offerId}). Превью сохранено: ${result.updatedFileCount}.`,
      )
    } finally {
      setProductEditorSaving(false)
    }
  }

  function addDraftNovinkaItem() {
    const productName = novinkaProductName.trim()
    const productLink = novinkaProductLink.trim()
    const quantity = Number(taskNovinkaQuantity)

    if (!productName) {
      setTaskFormStatus('Укажите наименование и ссылку на товар')
      return
    }

    if (!Number.isFinite(quantity) || quantity <= 0) {
      setTaskFormStatus('Укажите количество товара')
      return
    }

    setDraftNovinkaItems((current) => [
      ...current,
      {
        tempId: createTempId(),
        productName,
        productLink,
        requiredQuantity: quantity,
      },
    ])
    setNovinkaProductName('')
    setNovinkaProductLink('')
    setTaskNovinkaQuantity('')
    setTaskFormStatus('')
    setTaskStatus('Новинка добавлена в задачу')
  }

  function getTaskFormProducts(mode: TaskFormMode = taskFormMode): OzonProduct[] {
    if (shopRegion === 'rf') {
      if (mode === 'packaging') {
        return ozonProducts.filter((product) => product.isPurchased === true)
      }

      return ozonProducts
    }

    if (mode === 'kaspi' || mode === 'satu' || mode === 'halyk') {
      return kzProducts[mode] ?? []
    }

    return kzProducts[kzTaskMarketplace] ?? []
  }

  function getTaskFormTaskType(): ProductionTaskType {
    if (shopRegion === 'rf') {
      if (taskFormMode === 'packaging') {
        return 'Packaging'
      }

      return 'Ozon'
    }

    return isMarketplaceTaskFormMode(taskFormMode)
      ? getKzTaskType(taskFormMode as KzMarketplace)
      : getKzTaskType(kzTaskMarketplace)
  }

  function switchEditingTaskKind(nextKind: ProductionTaskEditorKind) {
    if (!editingTaskId || !canChangeProductionTaskType() || nextKind === taskEditorKind) {
      return
    }

    setTaskEditorKind(nextKind)
    setTaskFormStatus('')

    if (nextKind === 'novinka') {
      setDraftNovinkaItems(
        draftTaskItems.map((item) => ({
          tempId: createTempId(),
          productName: item.productName,
          productLink: stripNovinkaMarketplaceNote(item.productLink ?? ''),
          offerId: item.offerId ?? '',
          requiredQuantity: item.requiredQuantity,
        })),
      )
      setShowCreateTaskModal(false)
      setShowCreateNovinkaTaskModal(true)
      return
    }

    setDraftTaskItems(
      draftNovinkaItems.map((item) => ({
        tempId: createTempId(),
        ozonProductId: 0,
        offerId: item.offerId ?? '',
        productName: item.productName,
        productLink: stripNovinkaMarketplaceNote(item.productLink ?? ''),
        imageUrl: '',
        requiredQuantity: item.requiredQuantity,
        enforceMinimumQuantity: false,
        isNovinka: true,
      })),
    )
    setSelectedTaskProductId('')
    setSelectedTaskNovinkaOfferId('')
    setTaskQuantity('')
    setTaskNovinkaQuantity('')
    setShowCreateNovinkaTaskModal(false)
    setShowCreateTaskModal(true)
    void loadProductionFiles('')
    void loadSupplies()
  }

  function openCreateTaskModal() {
    resetTaskForm()
    const defaultMode = getDefaultTaskFormMode(shopRegion, user?.role, kzTaskMarketplace)
    setTaskFormMode(defaultMode)
    setTaskFormStatus('')
    setShowCreateTaskModal(true)
    if (isMarketplaceTaskFormMode(defaultMode)) {
      if (shopRegion === 'rf' && ozonProducts.length === 0) {
        void loadOzonProducts()
      } else if (shopRegion === 'kz') {
        const marketplace =
          defaultMode === 'kaspi' || defaultMode === 'satu' || defaultMode === 'halyk'
            ? defaultMode
            : kzTaskMarketplace
        if ((kzProducts[marketplace] ?? []).length === 0) {
          void loadKzProducts(marketplace)
        }
      }
    }
    if (productionFiles.length === 0) {
      void loadProductionFiles('')
    }
    void loadSupplies()
  }

  function openCreatePackagingTaskModal() {
    resetTaskForm()
    setTaskFormMode('packaging')
    setTaskFormStatus('')
    setShowCreateTaskModal(true)
    if (ozonProducts.length === 0) {
      void loadOzonProducts()
    }
    void loadSupplies()
  }

  function closeTaskFormModal() {
    setShowCreateTaskModal(false)
    setTaskFormStatus('')
    resetTaskForm()
  }

  function openEditTaskModal(task: ProductionTask) {
    if (task.status !== 'New') {
      return
    }

    setTaskIsUrgent(task.isUrgent)
    setTaskDueAt(toDatetimeLocalValue(task.dueAt))

    if (isNovinkaTask(task)) {
      setTaskEditorKind('novinka')
      setEditingTaskId(task.id)
      setNovinkaTaskMarketplace(
        resolveNovinkaMarketplaceForTask(task, productionFiles) ??
          (shopRegion === 'rf' ? 'ozon' : kzTaskMarketplace),
      )
      setDraftNovinkaItems(
        getProductionTaskItems(task).map((item) => ({
          tempId: createTempId(),
          productName: item.productName,
          productLink: stripNovinkaMarketplaceNote(item.productLink ?? ''),
          offerId: item.offerId ?? '',
          requiredQuantity: item.requiredQuantity,
        })),
      )
      setShowCreateNovinkaTaskModal(true)
      return
    }

    setTaskEditorKind('production')
    setEditingTaskId(task.id)
    const taskType = task.taskType ?? 'Ozon'
    if (shopRegion === 'kz' && isKzMarketplaceTaskType(taskType)) {
      setTaskFormMode(resolveKzMarketplaceFromTaskType(taskType))
    } else {
      setTaskFormMode('ozon')
    }
    setDraftTaskItems(
      getProductionTaskItems(task).map((item) => {
        const isNovinkaItem =
          item.ozonProductId <= 0 &&
          (item.offerId.startsWith('NV-') || Boolean(item.productLink?.trim()))
        return {
          tempId: createTempId(),
          ozonProductId: item.ozonProductId,
          offerId: item.offerId,
          productName: item.productName,
          productLink: item.productLink,
          imageUrl:
            productionLookupProducts.find((product) => product.productId === item.ozonProductId)?.imageUrl ?? '',
          requiredQuantity: item.requiredQuantity,
          enforceMinimumQuantity: item.enforceMinimumQuantity ?? false,
          isNovinka: isNovinkaItem,
        }
      }),
    )
    setSelectedTaskProductId('')
    setTaskQuantity('')
    setShowCreateTaskModal(true)
    void loadSupplies()
  }

  function openProductionTaskFromCompletedNovinka(sourceTask: ProductionTask) {
    const sourceItems = getProductionTaskItems(sourceTask)

    if (sourceItems.length === 0) {
      setTaskStatus('В задаче нет товаров для переноса в производство')
      return
    }

    resetTaskForm()
    setEditingTaskId(null)
    setTaskFormMode(shopRegion === 'rf' ? 'ozon' : kzTaskMarketplace)
    setDraftTaskItems(
      sourceItems.map((item) => ({
        tempId: createTempId(),
        sourceTaskItemId: item.id,
        ozonProductId: item.ozonProductId ?? 0,
        offerId: item.offerId ?? '',
        productName: item.productName,
        productLink: stripNovinkaMarketplaceNote(item.productLink ?? ''),
        imageUrl: '',
        requiredQuantity: item.requiredQuantity,
        enforceMinimumQuantity: false,
        isNovinka: true,
        productionSummary: item.productionSummary,
      })),
    )
    setSelectedTaskProductId('')
    setSelectedTaskNovinkaOfferId('')
    setTaskQuantity('')
    setTaskNovinkaQuantity('')
    setTaskIsUrgent(false)
    setTaskDueAt('')
    setTaskFormStatus('Товары из новинки перенесены. Укажите количество по каждой позиции и нажмите "Создать".')
    setShowCreateNovinkaTaskModal(false)
    setProductionSubTab('tasks')
    setShowCreateTaskModal(true)
    void loadProductionFiles('')
    void loadSupplies()
  }

  function openProductionTaskFromNovinkaItem(sourceTask: ProductionTask, sourceItem: ProductionTaskItem) {
    if (!canCreateProductionTasks()) {
      setTaskStatus('Нет доступа к созданию задачи производства')
      return
    }

    const itemFiles = getProductionFilesForTaskItem(sourceItem, productionFiles).filter((file) =>
      file.contentType.startsWith('image/'),
    )
    const itemPaths = getProductionPathsForTaskItem(sourceItem, productionFilePaths)

    if (itemFiles.length === 0 || itemPaths.length === 0) {
      setTaskStatus('Для переноса в производство нужен путь и превью товара')
      return
    }

    resetTaskForm()
    setEditingTaskId(null)
    setTaskFormMode(shopRegion === 'rf' ? 'ozon' : kzTaskMarketplace)
    setDraftTaskItems([
      {
        tempId: createTempId(),
        sourceTaskItemId: sourceItem.id,
        ozonProductId: sourceItem.ozonProductId ?? 0,
        offerId: sourceItem.offerId ?? '',
        productName: sourceItem.productName,
        productLink: stripNovinkaMarketplaceNote(sourceItem.productLink ?? ''),
        imageUrl: '',
        requiredQuantity: sourceItem.requiredQuantity,
        enforceMinimumQuantity: false,
        isNovinka: true,
        productionSummary: sourceItem.productionSummary,
      },
    ])
    setSelectedTaskProductId('')
    setSelectedTaskNovinkaOfferId('')
    setTaskQuantity('')
    setTaskNovinkaQuantity('')
    setTaskIsUrgent(sourceTask.isUrgent)
    setTaskDueAt('')
    setTaskFormStatus('Товар перенесен из задачи дизайна. Укажите количество и создайте задачу производства.')
    setShowCreateNovinkaTaskModal(false)
    setProductionSubTab('tasks')
    setShowCreateTaskModal(true)
    void loadProductionFiles('')
    void loadSupplies()
  }

  function addDraftTaskItem() {
    const productsSource = getTaskFormProducts()
    const product = productsSource.find((item) => String(item.productId) === selectedTaskProductId)
    const quantity = Number(taskQuantity)

    if (!product || !Number.isFinite(quantity) || quantity <= 0) {
      setTaskStatus('Выберите товар и укажите количество')
      return
    }

    if (isProductAlreadyInDraftTask(draftTaskItems, product)) {
      setTaskFormStatus('Товар уже добавлен в эту задачу')
      return
    }

    setDraftTaskItems((current) => [
      ...current,
      {
        tempId: createTempId(),
        ozonProductId: product.productId,
        offerId: product.offerId,
        productName: product.name,
        imageUrl: product.imageUrl,
        requiredQuantity: quantity,
        enforceMinimumQuantity: false,
      },
    ])
    setSelectedTaskProductId('')
    setTaskQuantity('')
    setTaskStatus('Товар добавлен в задачу')
  }

  async function saveNovinkaTaskFromDraft() {
    const taskIdBeingEdited = editingTaskId
    let novinkaItems = [...draftNovinkaItems]

    const productName = novinkaProductName.trim()
    const productLink = novinkaProductLink.trim()
    const quantity = Number(taskNovinkaQuantity)
    if (productName) {
      if (!Number.isFinite(quantity) || quantity <= 0) {
        setTaskFormStatus('Укажите количество товара')
        return
      }

      novinkaItems = [
        ...novinkaItems,
        {
          tempId: createTempId(),
          productName,
          productLink,
          requiredQuantity: quantity,
        },
      ]
    }

    if (novinkaItems.length === 0) {
      setTaskFormStatus('Добавьте новинку или заполните наименование и ссылку')
      return
    }

    if (novinkaItems.some((item) => !Number.isFinite(item.requiredQuantity) || item.requiredQuantity <= 0)) {
      setTaskFormStatus('Укажите количество по каждой позиции')
      return
    }

    setTaskFormSaving(true)
    setTaskFormStatus('')

    const itemPayload = novinkaItems.map((item) => ({
      ozonProductId: 0,
      offerId: item.offerId ?? '',
      productName: (item.productName ?? '').trim(),
      productLink: appendNovinkaMarketplaceNote(item.productLink ?? '', novinkaTaskMarketplace),
      requiredQuantity: item.requiredQuantity,
      enforceMinimumQuantity: false,
    }))

    const payload = taskIdBeingEdited
      ? {
          taskType: 'Novinka',
          isUrgent: taskIsUrgent,
          ...(canManageProductionTaskDeadline() ? { dueAt: fromDatetimeLocalValue(taskDueAt) } : {}),
          items: itemPayload,
        }
      : {
          taskType: 'Novinka',
          isUrgent: taskIsUrgent,
          ...(canManageProductionTaskDeadline() ? { dueAt: fromDatetimeLocalValue(taskDueAt) } : {}),
          items: itemPayload,
        }

    try {
      const response = await productionApi.saveProductionTask(token, taskIdBeingEdited, payload)

      const responseText = await response.text()

      if (!response.ok) {
        const message = getApiErrorMessage(
          responseText,
          taskIdBeingEdited ? 'Не удалось сохранить задачу' : 'Не удалось создать задачу',
        )
        setTaskFormStatus(message)
        setTaskFormSaving(false)
        return
      }

      const wasEdit = Boolean(taskIdBeingEdited)
      let savedTask: ProductionTask | null = null
      if (response.status !== 204 && responseText.trim()) {
        savedTask = JSON.parse(responseText) as ProductionTask
      }
      if (!wasEdit && savedTask?.id && user?.id) {
        markTaskNotificationsSeen('new', [savedTask.id])
      }

      setTaskFormSaving(false)
      closeNovinkaTaskFormModal()
      setTaskStatus(wasEdit ? 'Задача обновлена' : 'Задача создана')
      void loadProductionTasks()
    } catch {
      setTaskFormStatus('Не удалось сохранить задачу')
      setTaskFormSaving(false)
    }
  }

  async function saveTaskFromDraft() {
    const taskIdBeingEdited = editingTaskId
    let ozonItems = [...draftTaskItems]

    const product = getTaskFormProducts().find((item) => String(item.productId) === selectedTaskProductId)
    const quantity = Number(taskQuantity)
    if (product && Number.isFinite(quantity) && quantity > 0) {
      ozonItems = [
        ...ozonItems,
        {
          tempId: createTempId(),
          ozonProductId: product.productId,
          offerId: product.offerId,
          productName: product.name,
          imageUrl: product.imageUrl,
          requiredQuantity: quantity,
          enforceMinimumQuantity: false,
        },
      ]
    }

    const novinka = taskFormNovinkaCatalogItems.find((item) => item.offerId === selectedTaskNovinkaOfferId)
    const novinkaQuantity = Number(taskNovinkaQuantity)
    const novinkaPreviewCount = novinka
      ? getProductionFilesForCatalogItem(novinka, productionFiles).filter((file) =>
          file.contentType.startsWith('image/'),
        ).length
      : 0
    if (
      taskFormMode !== 'packaging' &&
      novinka &&
      Number.isFinite(novinkaQuantity) &&
      novinkaQuantity > 0 &&
      novinkaPreviewCount > 0
    ) {
      ozonItems = [
        ...ozonItems,
        {
          tempId: createTempId(),
          ozonProductId: novinka.ozonProductId ?? 0,
          offerId: novinka.offerId,
          productName: novinka.productName,
          productLink: novinka.productLink,
          imageUrl: '',
          requiredQuantity: novinkaQuantity,
          enforceMinimumQuantity: false,
          isNovinka: true,
        },
      ]
    }

    if (ozonItems.length === 0) {
      setTaskFormStatus('Добавьте товар или новинку из списка и укажите количество')
      return
    }

    const normalizedOzonItems = ozonItems.map((item) => ({
      ...item,
      offerId: item.offerId ?? '',
      productName: item.productName ?? '',
      productLink: item.productLink ?? '',
      requiredQuantity: Math.max(0, Math.round(Number(item.requiredQuantity) || 0)),
    }))

    if (normalizedOzonItems.some((item) => item.requiredQuantity <= 0)) {
      setTaskFormStatus('Укажите количество больше нуля для каждого товара')
      return
    }

    setTaskFormSaving(true)
    setTaskFormStatus('')

    const payload = {
      taskType: getTaskFormTaskType(),
      isUrgent: taskIsUrgent,
      ...(canManageProductionTaskDeadline() ? { dueAt: fromDatetimeLocalValue(taskDueAt) } : {}),
      items: normalizedOzonItems.map((item) => ({
        ozonProductId: item.ozonProductId ?? 0,
        offerId: item.offerId,
        productName: item.productName,
        productLink: item.productLink,
        requiredQuantity: item.requiredQuantity,
        enforceMinimumQuantity: item.enforceMinimumQuantity ?? false,
        sourceTaskItemId: item.sourceTaskItemId,
      })),
    }

    try {
      const response = await productionApi.saveProductionTask(token, taskIdBeingEdited, payload)

      if (!response.ok) {
        const message = getApiErrorMessage(
          await response.text(),
          taskIdBeingEdited ? 'Не удалось сохранить задачу' : 'Не удалось создать задачу',
        )
        setTaskFormStatus(message)
        setTaskFormSaving(false)
        return
      }

      const wasEdit = Boolean(taskIdBeingEdited)
      const savedTask: ProductionTask | null = response.status === 204 ? null : await response.json()
      if (!wasEdit && savedTask?.id && user?.id) {
        markTaskNotificationsSeen('new', [savedTask.id])
      }

      setTaskFormSaving(false)
      closeTaskFormModal()
      setTaskStatus(wasEdit ? 'Задача обновлена' : 'Задача создана')
      void loadProductionTasks()
    } catch {
      setTaskFormStatus('Не удалось сохранить задачу')
      setTaskFormSaving(false)
    }
  }

  async function startProductionTask(id: string) {
    const response = await productionApi.startProductionTask(token, id)

    if (!response.ok) {
      setTaskStatus('Не удалось взять задачу в работу')
      return
    }

    setTaskStatus('Задача взята в работу')
    await loadProductionTasks()
  }

  async function cancelProductionTask() {
    if (!cancelTaskId || !canCancelProductionTasks()) {
      return
    }

    const comment = cancelTaskComment.trim()
    if (comment.length < 3) {
      setTaskStatus('Укажите причину отмены (минимум 3 символа)')
      return
    }

    const response = await productionApi.cancelProductionTask(token, cancelTaskId, comment)

    if (!response.ok) {
      const message = await response.text()
      setTaskStatus(message || 'Не удалось отменить задачу')
      return
    }

    setCancelTaskId(null)
    setCancelTaskComment('')
    setTaskStatus('Задача отменена')
    await loadProductionTasks()
  }

  async function completeProductionTask(id: string) {
    const task = productionTasks.find((item) => item.id === id)
    const taskItems = task ? getProductionTaskItems(task) : []

    if (task && isNovinkaTask(task)) {
      const missingFiles = taskItems.filter(
        (item) =>
          getProductionFilesForTaskItem(item, productionFiles).filter((file) =>
            file.contentType.startsWith('image/'),
          ).length === 0,
      )
      const missingPaths = taskItems.filter(
        (item) => !item.filePath?.trim() && getProductionPathsForTaskItem(item, productionFilePaths).length === 0,
      )
      if (missingFiles.length > 0) {
        setTaskStatus(`Добавьте превью: ${missingFiles.map((item) => item.productName).join(', ')}`)
        return
      }
      if (missingPaths.length > 0) {
        setTaskStatus(`Укажите путь к файлу: ${missingPaths.map((item) => item.productName).join(', ')}`)
        return
      }

      const response = await productionApi.completeProductionTask(token, id, {
        actualQuantity: 0,
        items: [],
      })

      if (!response.ok) {
        const message = await response.text()
        setTaskStatus(message || 'Не удалось завершить задачу')
        return
      }

      setTaskStatus('Задача выполнена')
      await loadProductionTasks()
      await loadProductionFiles(productionSearch)
      return
    }

    const completedItems = taskItems.map((item) => ({
      id: item.id,
      actualQuantity: resolveTaskItemActualQuantity(item, actualQuantities),
    }))

    if (
      completedItems.length === 0 ||
      completedItems.some((item) => !Number.isFinite(item.actualQuantity) || item.actualQuantity < 0)
    ) {
      setTaskStatus('Сохраните фактическое количество по каждому товару')
      return
    }

    for (const item of taskItems) {
      const actualQuantity = resolveTaskItemActualQuantity(item, actualQuantities)
      if (item.enforceMinimumQuantity && actualQuantity < item.requiredQuantity) {
        setTaskStatus(`По «${item.productName}» факт не может быть меньше ${item.requiredQuantity}`)
        return
      }
    }

    const actualQuantity = completedItems.reduce((sum, item) => sum + item.actualQuantity, 0)

    const response = await productionApi.completeProductionTask(token, id, {
      actualQuantity,
      items: completedItems,
    })

    if (!response.ok) {
      setTaskStatus('Не удалось завершить задачу')
      return
    }

    setActualQuantities((current) => {
      const next = { ...current }
      taskItems.forEach((item) => {
        next[item.id] = ''
      })
      return next
    })
    setTaskStatus('Задача выполнена')
    await loadProductionTasks()
  }

  async function archiveProductionTask(id: string) {
    if (!canArchiveProductionTasks()) {
      return
    }

    const response = await productionApi.archiveProductionTask(token, id)

    if (!response.ok) {
      const message = await response.text()
      setTaskStatus(message || 'Не удалось архивировать задачу')
      return
    }

    setTaskStatus('Задача отправлена в архив')
    await loadProductionTasks()
  }

  async function restoreProductionTask(id: string) {
    const response = await productionApi.restoreProductionTask(token, id)

    if (!response.ok) {
      const message = await response.text()
      setTaskStatus(message || 'Не удалось вернуть задачу в новые')
      return
    }

    setTaskStatus('Задача возвращена в новые')
    await loadProductionTasks()
  }

  async function deleteProductionTask(id: string) {
    if (!window.confirm('Удалить задачу из архива без возможности восстановления?')) {
      return
    }

    const response = await productionApi.deleteProductionTask(token, id)

    if (!response.ok) {
      setTaskStatus('Не удалось удалить задачу')
      return
    }

    setTaskStatus('Задача удалена')
    await loadProductionTasks()
  }

  async function loadSupplies() {
    const response = await fetch('/api/supplies', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      setSupplyStatus('Не удалось загрузить поставки')
      return
    }

    const data: Supply[] = await response.json()
    const activeSuppliesList = data.filter((supply) => !supply.isArchived)
    const previousSupplyIds = knownNewSupplyIdsRef.current
    const nextSupplyIds = new Set(activeSuppliesList.map((supply) => supply.id))

    if (previousSupplyIds) {
      const arrivedSupplies = activeSuppliesList.filter(
        (supply) => !previousSupplyIds.has(supply.id) && supply.status === 'Created',
      )
      if (arrivedSupplies.length > 0) {
        showBrowserNotification(
          'Новая поставка',
          arrivedSupplies.length === 1
            ? getSupplyNotificationSummary(arrivedSupplies[0])
            : `Новых поставок: ${arrivedSupplies.length}`,
        )
      }
    }

    knownNewSupplyIdsRef.current = nextSupplyIds
    setSupplies(data)
    setSupplyStatus(data.length ? `Поставок: ${data.length}` : 'Поставок пока нет')
  }

  async function loadSupplyAnalytics() {
    const response = await fetch('/api/supplies/analytics', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      setSupplyStatus('Не удалось загрузить аналитику поставок')
      return
    }

    const data: SupplyAnalyticsItem[] = await response.json()
    setSupplyAnalytics(data)
  }

  async function loadOzonSupplyShipments() {
    const response = await fetch('/api/ozon/supply-shipments', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      setSupplyStatus('Не удалось загрузить отгрузки FBO Ozon')
      return
    }

    const data: OzonSupplyShipmentQuantity[] = await response.json()
    setOzonSupplyShipments(data)
  }

  async function loadSupplyFboDefects() {
    const response = await fetch('/api/supplies/fbo-defects', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      return
    }

    const data: SupplyFboDefect[] = await response.json()
    setSupplyFboDefects(data)
  }

  async function loadSupplyExpenses() {
    const params = new URLSearchParams()
    const search = supplyExpenseSearch.trim()
    if (search) {
      params.set('search', search)
    }
    if (supplyExpenseDateFrom) {
      params.set('from', supplyExpenseDateFrom)
    }
    if (supplyExpenseDateTo) {
      params.set('to', supplyExpenseDateTo)
    }

    const response = await fetch(`/api/supplies/expenses?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      setSupplyStatus((await response.text()) || 'Не удалось загрузить расходники')
      return
    }

    const data: SupplyExpensesResponse = await response.json()
    setSupplyExpenses(data.items)
    setSupplyExpensesTotal(data.totalAmount)
  }

  async function loadInternalSupplyExpenses() {
    const params = new URLSearchParams()
    if (analyticsDateFrom) {
      params.set('from', analyticsDateFrom)
    }
    if (analyticsDateTo) {
      params.set('to', analyticsDateTo)
    }

    const response = await fetch(`/api/supplies/expenses?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      setInternalSupplyExpenses([])
      setInternalSupplyExpensesTotal(0)
      return
    }

    const data: SupplyExpensesResponse = await response.json()
    setInternalSupplyExpenses(data.items)
    setInternalSupplyExpensesTotal(data.totalAmount)
  }

  async function createSupplyExpense() {
    const name = supplyExpenseName.trim()
    const amount = parseMoneyInput(supplyExpenseAmount)

    if (!name) {
      setSupplyStatus('Укажите что купили')
      return
    }

    if (amount === null) {
      setSupplyStatus('Укажите сумму покупки больше 0')
      return
    }

    if (!supplyExpenseDate) {
      setSupplyStatus('Укажите дату покупки')
      return
    }

    const response = await fetch('/api/supplies/expenses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        name,
        amount,
        purchasedAt: `${supplyExpenseDate}T12:00:00.000Z`,
      }),
    })

    if (!response.ok) {
      setSupplyStatus((await response.text()) || 'Не удалось добавить расходник')
      return
    }

    setSupplyExpenseName('')
    setSupplyExpenseAmount('')
    setSupplyStatus('Расходник добавлен')
    await loadSupplyExpenses()
  }

  async function updateSupplyExpense(row: SupplyExpense, amountValue: string, purchasedAtValue: string) {
    const amount = parseMoneyInput(amountValue)
    if (amount === null) {
      setSupplyStatus('Укажите сумму покупки больше 0')
      return
    }

    if (!purchasedAtValue) {
      setSupplyStatus('Укажите дату покупки')
      return
    }

    const response = await fetch(`/api/supplies/expenses/${row.id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        amount,
        purchasedAt: `${purchasedAtValue}T12:00:00.000Z`,
      }),
    })

    if (!response.ok) {
      setSupplyStatus((await response.text()) || 'Не удалось сохранить расходник')
      return
    }

    setSupplyStatus('Расходник сохранен')
    await loadSupplyExpenses()
    await loadInternalSupplyExpenses()
  }

  async function deleteSupplyExpense(row: SupplyExpense) {
    const confirmed = window.confirm(`Удалить расходник "${row.name}"?`)
    if (!confirmed) {
      return
    }

    const response = await fetch(`/api/supplies/expenses/${row.id}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      setSupplyStatus((await response.text()) || 'Не удалось удалить расходник')
      return
    }

    setSupplyStatus('Расходник удален')
    await loadSupplyExpenses()
    await loadInternalSupplyExpenses()
  }

  async function markSupplyFboDefect(row: SupplyFboRemainingItem) {
    const quantityInput = window.prompt(
      `Сколько штук пометить как брак?\n\n${row.productName}`,
      String(row.remainingQuantity),
    )
    if (quantityInput === null) {
      return
    }

    const quantity = Math.floor(Number(quantityInput.replace(',', '.')))
    if (!Number.isFinite(quantity) || quantity <= 0) {
      setSupplyStatus('Укажите количество брака больше 0')
      return
    }

    const response = await fetch('/api/supplies/fbo-defects', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        productKey: row.key,
        offerId: row.offerId,
        productName: row.productName,
        quantity,
      }),
    })

    if (!response.ok) {
      setSupplyStatus((await response.text()) || 'Не удалось отметить товар как брак')
      return
    }

    setSupplyStatus('Товар отмечен как брак и убран из остатка к отгрузке')
    await loadSupplyFboDefects()
  }

  async function removeSupplyFboDefect(defect: SupplyFboDefect) {
    const confirmed = window.confirm(
      `Вернуть товар в остаток к отгрузке?\n\n${defect.productName}\nКоличество брака: ${defect.quantity}`,
    )
    if (!confirmed) {
      return
    }

    const response = await fetch(`/api/supplies/fbo-defects/${encodeURIComponent(defect.productKey)}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      setSupplyStatus((await response.text()) || 'Не удалось вернуть товар в остаток к отгрузке')
      return
    }

    setSupplyStatus('Товар возвращен в остаток к отгрузке')
    await loadSupplyFboDefects()
  }

  function addSupplyProduct() {
    const product = ozonProducts.find((item) => String(item.productId) === supplyProductId)
    const quantity = Number(supplyQuantity)

    if (!product || !Number.isFinite(quantity) || quantity <= 0) {
      setSupplyStatus('Выберите товар и укажите количество')
      return
    }

    setDraftSupplyItems((current) => [
      ...current,
      {
        tempId: createTempId(),
        ozonProductId: product.productId,
        offerId: product.offerId,
        productName: product.name,
        imageUrl: product.imageUrl,
        quantity,
        isReserve: false,
        itemKind: 'Product',
      },
    ])
    setSupplyProductId('')
    setSupplyQuantity('')
    setSupplyStatus('Товар добавлен в поставку')
  }

  function addReserveSupplyProduct() {
    const selectedNovinka = supplyPackedCatalogItems.find((item) => item.offerId === selectedNovinkaOfferId)
    const quantity = Number(reserveQuantity || selectedNovinka?.packedQuantity || '')

    if (!selectedNovinka || !Number.isFinite(quantity) || quantity <= 0) {
      setSupplyStatus('Выберите упакованный товар из списка и укажите количество')
      return
    }

    setDraftSupplyItems((current) => [
      ...current,
      {
        tempId: createTempId(),
        offerId: selectedNovinka.offerId,
        productName: selectedNovinka.productName,
        quantity,
        isReserve: true,
        itemKind: 'Product',
      },
    ])
    setSelectedNovinkaOfferId('')
    setReserveQuantity('')
    setSupplyStatus('Упакованный товар добавлен в поставку')
  }

  function addSupplyMaterialItem() {
    const productName = supplyMaterialName.trim()
    const quantity = Number(supplyMaterialQuantity)

    if (!productName || !Number.isFinite(quantity) || quantity <= 0) {
      setSupplyStatus('Укажите название и количество расходника или мат. ценности')
      return
    }

    setDraftSupplyItems((current) => [
      ...current,
      {
        tempId: createTempId(),
        offerId: '',
        productName,
        quantity,
        isReserve: true,
        itemKind: supplyMaterialKind,
      },
    ])
    setSupplyMaterialName('')
    setSupplyMaterialQuantity('')
    setSupplyStatus('Позиция добавлена в поставку')
  }

  async function createSupply() {
    if (draftSupplyItems.length === 0) {
      setSupplyStatus('Добавьте товары в поставку')
      return
    }

    const response = await fetch('/api/supplies', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items: draftSupplyItems.map(({ tempId: _tempId, ...item }) => item),
      }),
    })

    if (!response.ok) {
      const message = await response.text()
      setSupplyStatus(message || 'Не удалось создать поставку')
      return
    }

    setDraftSupplyItems([])
    setShowCreateSupplyModal(false)
    setSupplyStatus('Поставка создана со статусом "Создано"')
    await loadSupplies()
    if (user?.role === 'Admin') {
      await loadSupplyAnalytics()
    }
  }

  async function downloadSupplyTemplate() {
    const response = await fetch('/api/supplies/import-template', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      setSupplyStatus('Не удалось скачать шаблон')
      return
    }

    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'supply-template.xlsx'
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }

  async function uploadSupplyExcel() {
    if (!supplyImportFile) {
      setSupplyStatus('Выберите Excel-файл')
      return
    }

    const formData = new FormData()
    formData.append('file', supplyImportFile)

    const response = await fetch('/api/supplies/import', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    })

    if (!response.ok) {
      const message = await response.text()
      setSupplyStatus(message || 'Не удалось импортировать Excel')
      return
    }

    const result = await response.json()
    setSupplyImportFile(null)
    setSupplyStatus(`Поставка создана из Excel. Строк: ${result.items}`)
    await loadSupplies()
    await loadSupplyAnalytics()
  }

  async function updateSupplyDates(id: string, sentAt?: string, acceptedAt?: string, shippingCost?: number | null) {
    const response = await fetch(`/api/supplies/${id}/dates`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sentAt: sentAt ?? null,
        acceptedAt: acceptedAt ?? null,
        shippingCost: shippingCost ?? null,
      }),
    })

    if (!response.ok) {
      setSupplyStatus(getApiErrorMessage(await response.text(), 'Не удалось обновить даты поставки'))
      return false
    }

    setSupplyStatus('Даты поставки обновлены')
    await loadSupplies()
    if (user?.role === 'Admin') {
      await loadSupplyAnalytics()
    }
    return true
  }

  async function updateSupplyStatus(id: string, status: SupplyStatus, shippingCost?: number | null) {
    const response = await fetch(`/api/supplies/${id}/status`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status, shippingCost: shippingCost ?? null }),
    })

    if (!response.ok) {
      const rawMessage = await response.text()
      let message = rawMessage
      try {
        message = JSON.parse(rawMessage)
      } catch {
        message = rawMessage
      }
      if (status === 'Sent' && message.includes('сумму отправки')) {
        const supply = supplies.find((item) => item.id === id)
        if (supply) {
          openShippingCostModal(supply)
        }
      }
      setSupplyStatus(message || 'Не удалось сохранить статус поставки')
      return false
    }

    setSupplyStatus('Статус поставки сохранен')
    await loadSupplies()
    if (user?.role === 'Admin') {
      await loadSupplyAnalytics()
    }
    return true
  }

  function openShippingCostModal(supply: Supply) {
    setShippingCostModalSupply(supply)
    setShippingCostDraft(supply.shippingCost ? String(supply.shippingCost) : '')
    setSupplyStatus('')
  }

  async function confirmSupplySent() {
    if (!shippingCostModalSupply) {
      return
    }

    const shippingCost = parseMoneyInput(shippingCostDraft)
    if (!shippingCost) {
      setSupplyStatus('Укажите сумму отправки поставки')
      return
    }

    const saved = await updateSupplyStatus(shippingCostModalSupply.id, 'Sent', shippingCost)
    if (!saved) {
      return
    }
    setShippingCostModalSupply(null)
    setShippingCostDraft('')
  }

  async function replaceReserveItem(itemId: string) {
    const product = ozonProducts.find((item) => String(item.productId) === replaceProducts[itemId])

    if (!product) {
      setSupplyStatus('Выберите постоянный товар для замены')
      return
    }

    const response = await fetch(`/api/supplies/items/${itemId}/replace-reserve`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ozonProductId: product.productId,
        offerId: product.offerId,
        productName: product.name,
      }),
    })

    if (!response.ok) {
      setSupplyStatus('Не удалось заменить новый товар')
      return
    }

    setReplaceProducts((current) => ({ ...current, [itemId]: '' }))
    setSupplyStatus('Новый товар заменен на постоянный')
    await loadSupplies()
    await loadSupplyAnalytics()
  }

  function startEditSupply(supply: Supply) {
    setEditingSupplyId(supply.id)
    setEditSupplyItems(
      supply.items.map((item) => ({
        tempId: item.id,
        id: item.id,
        ozonProductId: item.ozonProductId,
        offerId: item.offerId,
        productName: item.productName,
        imageUrl: getSupplyItemImageUrl(ozonProducts, {
          tempId: item.id,
          ozonProductId: item.ozonProductId,
          offerId: item.offerId,
          productName: item.productName,
          quantity: item.quantity,
          isReserve: item.isReserve,
          itemKind: item.itemKind ?? 'Product',
        }),
        quantity: item.quantity,
        isReserve: item.isReserve,
        itemKind: item.itemKind ?? 'Product',
      })),
    )
    setEditSupplyProductId('')
    setEditSupplyQuantity('')
    setEditSupplyShippingCost(supply.shippingCost ? String(supply.shippingCost) : '')
    setSelectedNovinkaOfferId('')
    setEditReserveQuantity('')
    setEditSupplyMaterialName('')
    setEditSupplyMaterialQuantity('')
    setEditSupplyMaterialKind('Consumable')
  }

  function cancelEditSupply() {
    setEditingSupplyId(null)
    setEditSupplyItems([])
    setEditSupplyProductId('')
    setEditSupplyQuantity('')
    setEditSupplyShippingCost('')
    setSelectedNovinkaOfferId('')
    setEditReserveQuantity('')
    setEditSupplyMaterialName('')
    setEditSupplyMaterialQuantity('')
    setEditSupplyMaterialKind('Consumable')
  }

  function addEditSupplyProduct() {
    const product = ozonProducts.find((item) => String(item.productId) === editSupplyProductId)
    const quantity = Number(editSupplyQuantity)

    if (!product || !Number.isFinite(quantity) || quantity <= 0) {
      setSupplyStatus('Выберите товар и укажите количество')
      return
    }

    setEditSupplyItems((current) => [
      ...current,
      {
        tempId: createTempId(),
        ozonProductId: product.productId,
        offerId: product.offerId,
        productName: product.name,
        imageUrl: product.imageUrl,
        quantity,
        isReserve: false,
        itemKind: 'Product',
      },
    ])
    setEditSupplyProductId('')
    setEditSupplyQuantity('')
  }

  function addEditReserveSupplyProduct() {
    const selectedNovinka = supplyPackedCatalogItems.find((item) => item.offerId === selectedNovinkaOfferId)
    const quantity = Number(editReserveQuantity || selectedNovinka?.packedQuantity || '')

    if (!selectedNovinka || !Number.isFinite(quantity) || quantity <= 0) {
      setSupplyStatus('Выберите упакованный товар из списка и укажите количество')
      return
    }

    setEditSupplyItems((current) => [
      ...current,
      {
        tempId: createTempId(),
        offerId: selectedNovinka.offerId,
        productName: selectedNovinka.productName,
        quantity,
        isReserve: true,
        itemKind: 'Product',
      },
    ])
    setSelectedNovinkaOfferId('')
    setEditReserveQuantity('')
  }

  function addEditSupplyMaterialItem() {
    const productName = editSupplyMaterialName.trim()
    const quantity = Number(editSupplyMaterialQuantity)

    if (!productName || !Number.isFinite(quantity) || quantity <= 0) {
      setSupplyStatus('Укажите название и количество расходника или мат. ценности')
      return
    }

    setEditSupplyItems((current) => [
      ...current,
      {
        tempId: createTempId(),
        offerId: '',
        productName,
        quantity,
        isReserve: true,
        itemKind: editSupplyMaterialKind,
      },
    ])
    setEditSupplyMaterialName('')
    setEditSupplyMaterialQuantity('')
    setSupplyStatus('Позиция добавлена в поставку')
  }

  async function saveSupplyEdit(id: string) {
    if (editSupplyItems.length === 0) {
      setSupplyStatus('В поставке должен быть хотя бы один товар')
      return
    }

    const response = await fetch(`/api/supplies/${id}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items: editSupplyItems.map(({ tempId: _tempId, id: _id, ...item }) => item),
        shippingCost: parseMoneyInput(editSupplyShippingCost),
      }),
    })

    if (!response.ok) {
      const message = await response.text()
      setSupplyStatus(message || 'Не удалось сохранить поставку')
      return
    }

    await loadSupplies()
    await loadSupplyAnalytics()
    cancelEditSupply()
    setSupplyStatus('Поставка сохранена')
  }

  async function archiveSupply(id: string) {
    const response = await fetch(`/api/supplies/${id}/archive`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      const message = await response.text()
      setSupplyStatus(message || 'Не удалось архивировать поставку')
      return
    }

    if (editingSupplyId === id) {
      cancelEditSupply()
    }
    setSupplyStatus('Поставка отправлена в архив')
    await loadSupplies()
    await loadSupplyAnalytics()
  }

  async function deleteSupply(id: string) {
    if (!window.confirm('Удалить поставку из архива без возможности восстановления?')) {
      return
    }

    const response = await fetch(`/api/supplies/${id}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      setSupplyStatus('Не удалось удалить поставку')
      return
    }

    if (editingSupplyId === id) {
      cancelEditSupply()
    }
    setSupplyStatus('Поставка удалена')
    await loadSupplies()
    await loadSupplyAnalytics()
  }

  if (!token) {
    return (
      <main className="login-page">
        <form className="login-form" onSubmit={handleLogin}>
          <p className="eyebrow">LShop Ozon</p>
          <h1>Вход в панель</h1>
          <label>
            Логин
            <input name="userName" autoComplete="username" required />
          </label>
          <label>
            Пароль
            <input name="password" type="password" autoComplete="current-password" required />
          </label>
          {loginError && <p className="error">{loginError}</p>}
          <button type="submit">Войти</button>
        </form>
      </main>
    )
  }

  return (
    <main className="app-layout">
      <header className="app-header">
        <div className="brand">
          <span>LShop</span>
          <RegionSwitcher shopRegion={shopRegion} onChange={handleShopRegionChange} />
        </div>

        <nav className="main-tabs" aria-label="Основные разделы">
            {visibleTabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={activeTab === tab.id ? 'active' : ''}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
                {tab.id === 'production' && productionNotificationTotal > 0 && (
                  <span className="tab-badge">{productionNotificationTotal}</span>
                )}
                {tab.id === 'supplies' && supplyNotificationTotal > 0 && (
                  <span className="tab-badge">{supplyNotificationTotal}</span>
                )}
                {tab.id === 'chats' && chatUnreadTotal > 0 && (
                  <span className="tab-badge">{chatUnreadTotal}</span>
                )}
              </button>
            ))}
        </nav>

        <div className="session">
          <div className="notification-menu">
            <button
              type="button"
              className="notification-bell-button"
              aria-label="Уведомления"
              title="Уведомления"
              onClick={() => {
                if (showNotifications) {
                  markVisibleNotificationsSeen()
                }
                setShowNotifications((current) => !current)
              }}
            >
              <svg className="notification-bell-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 22a2.2 2.2 0 0 0 2.1-1.5H9.9A2.2 2.2 0 0 0 12 22Zm6.3-5.5V11a6.3 6.3 0 0 0-5-6.1V4a1.5 1.5 0 1 0-3 0v.9A6.3 6.3 0 0 0 5.7 11v5.5L4 18.2V19h16v-.8l-1.7-1.7Z" />
              </svg>
              {notificationTotal > 0 && (
                <span className="notification-badge">{notificationTotal > 99 ? '99+' : notificationTotal}</span>
              )}
            </button>
            {showNotifications && (
              <div className="notification-panel">
                {notificationItems.map((item) => (
                  <button
                    type="button"
                    key={item.key}
                    onClick={() => {
                      setShowNotifications(false)
                      if (item.target === 'chat') {
                        selectChatThread(item.chatType, item.chatId)
                        markChatNotificationsSeen(item.chatType, item.chatId)
                        setActiveTab('chats')
                      } else if (item.target === 'tasks') {
                        markTaskNotificationsSeen('new', [item.taskId])
                        setActiveTab('production')
                        setProductionSubTab('tasks')
                      } else if (item.target === 'cancelled') {
                        markTaskNotificationsSeen('cancelled', [item.taskId])
                        setActiveTab('production')
                        setProductionSubTab('cancelled')
                      } else if (item.target === 'supplies-all') {
                        markSupplyNotificationsSeen([item.supplyId])
                        setActiveTab('supplies')
                        setSupplySubTab('all')
                      }
                    }}
                  >
                    {item.label}
                  </button>
                ))}
                {notificationItems.length === 0 && <span>Новых уведомлений нет</span>}
              </div>
            )}
          </div>
          <span>
            <small>В системе</small>
            <strong>{user?.displayName || user?.userName}</strong>
            {user?.position && <small>{user.position}</small>}
          </span>
          <button type="button" className="profile-button" onClick={() => user && openUserProfile(user)}>
            {user?.avatarUrl ? <img src={user.avatarUrl} alt="" /> : <span>фото</span>}
          </button>
          <button type="button" className="logout-button" onClick={confirmLogout}>
            Выйти
          </button>
        </div>
      </header>

      {profileModalUser && (
        <UserProfileModal
          profileUser={profileModalUser}
          isOwnProfile={profileModalUser.id === user?.id}
          profileForm={profileForm}
          setProfileForm={setProfileForm}
          profileAvatar={profileAvatar}
          setProfileAvatar={setProfileAvatar}
          profileStatus={profileStatus}
          onClose={closeUserProfile}
          onSaveProfile={saveProfile}
          onUploadAvatar={uploadProfileAvatar}
          profilePasswordForm={profilePasswordForm}
          setProfilePasswordForm={setProfilePasswordForm}
          onChangePassword={changeOwnPassword}
        />
      )}

      {productionFilesModal && (
        <ProductionFilesModal
          productName={productionFilesModal.productName}
          files={productionFilesModal.files}
          token={token}
          onClose={() => setProductionFilesModal(null)}
          onDownload={downloadProductionFile}
          onDelete={canDeleteProductionFiles() ? deleteProductionFile : undefined}
        />
      )}

      <div className="app-content">
        <section className="workspace">
          {activeTab === 'home' && (
            <section className="tab-panel home-dashboard">
              <div className="section-title">
                <div>
                  <h2>Главная</h2>
                  <p>Обзор производства, аналитики, поставок и товаров</p>
                </div>
              </div>

              {shopRegion === 'rf' ? (
              <div className="home-blocks">
                {isHomeBlockEnabled('production') && (
                  <HomeProductionBlock
                    title="Производство"
                    stats={homeProductionStats}
                    hasHomeAction={hasHomeAction}
                    onOpen={(subTab, taskUrgency) => openTab('production', { production: subTab, taskUrgency })}
                  />
                )}

                {isHomeBlockEnabled('analytics') && (
                  <HomeAnalyticsBlock
                    title="Аналитика"
                    periodLabel={homeMonthPeriodLabel}
                    status={homeAnalyticsStatus}
                    analytics={homeAnalytics}
                    marketplaceLabel="Ozon"
                    hasHomeAction={hasHomeAction}
                    onOpenAnalytics={(subTab) => openTab('analytics', { analytics: subTab })}
                    onRefresh={loadHomeAnalytics}
                  />
                )}

                {isHomeBlockEnabled('supplies') && (
                  <article className="home-block">
                    <div className="home-block-head">
                      <div>
                        <h3>Поставки</h3>
                        <p>{homeSupplyStats.total} активных поставок</p>
                      </div>
                      <button type="button" className="home-block-link" onClick={() => openTab('supplies', { supply: 'all' })}>
                        Открыть
                      </button>
                    </div>
                    <div className="home-metrics">
                      <div className="home-metric">
                        <span>Создано</span>
                        <strong>{homeSupplyStats.created}</strong>
                      </div>
                      <div className="home-metric">
                        <span>Отправлено</span>
                        <strong>{homeSupplyStats.sent}</strong>
                      </div>
                      <div className="home-metric">
                        <span>Принято</span>
                        <strong>{homeSupplyStats.accepted}</strong>
                      </div>
                      <div className="home-metric">
                        <span>Всего</span>
                        <strong>{homeSupplyStats.total}</strong>
                      </div>
                    </div>
                    <div className="home-block-actions">
                      {hasHomeAction('supplies', 'supplies.create') && (
                        <button type="button" onClick={() => openTab('supplies', { supply: 'create' })}>
                          Создать
                        </button>
                      )}
                      {hasHomeAction('supplies', 'supplies.all') && (
                        <button type="button" onClick={() => openTab('supplies', { supply: 'all' })}>
                          Все поставки
                        </button>
                      )}
                      {hasHomeAction('supplies', 'supplies.editor') && (
                        <button type="button" onClick={() => openTab('supplies', { supply: 'editor' })}>
                          Редактор
                        </button>
                      )}
                      {hasHomeAction('supplies', 'supplies.analytics') && (
                        <button type="button" onClick={() => openTab('supplies', { supply: 'analytics' })}>
                          Аналитика поставок
                        </button>
                      )}
                    </div>
                  </article>
                )}

                {isHomeBlockEnabled('products') && (
                  <HomeProductsBlock
                    title="Товары"
                    subtitle={`${homeProductStats.total} товаров на Ozon`}
                    status={ozonStatus}
                    stats={homeProductStats}
                    onOpen={() => openTab('products')}
                    onRefresh={() => void loadOzonProducts()}
                  />
                )}
              </div>
              ) : (
              <div className="home-dashboard-kz">
                {hasVisibleKzHomeBlock('production') && (
                  <div className="home-blocks home-blocks-kz-row">
                    {getHomeBlockKzMarketplaces('production').map((marketplace) => (
                      <HomeProductionBlock
                        key={marketplace}
                        title={`Производство · ${getKzMarketplaceLabel(marketplace)}`}
                        stats={homeKzProductionStats[marketplace]}
                        hasHomeAction={hasHomeAction}
                        onOpen={(subTab, taskUrgency) => {
                          handleKzTaskMarketplaceChange(marketplace)
                          openTab('production', { production: subTab, taskUrgency })
                        }}
                      />
                    ))}
                  </div>
                )}

                {hasVisibleKzHomeBlock('analytics') && (
                  <div className="home-blocks home-blocks-kz-row">
                    {getHomeBlockKzMarketplaces('analytics').map((marketplace) => (
                      <HomeAnalyticsBlock
                        key={marketplace}
                        title={`Аналитика · ${getKzMarketplaceLabel(marketplace)}`}
                        periodLabel={homeMonthPeriodLabel}
                        status={homeKzAnalyticsStatus[marketplace]}
                        analytics={homeKzAnalytics[marketplace]}
                        marketplaceLabel={getKzMarketplaceLabel(marketplace)}
                        hasHomeAction={hasHomeAction}
                        onOpenAnalytics={(subTab) => {
                          handleKzMarketplaceChange(marketplace)
                          openTab('analytics', { analytics: subTab })
                        }}
                        onRefresh={() => void loadHomeKzAnalytics(marketplace, true)}
                      />
                    ))}
                  </div>
                )}

                {hasVisibleKzHomeBlock('products') && (
                  <div className="home-blocks home-blocks-kz-row">
                    {getHomeBlockKzMarketplaces('products').map((marketplace) => {
                      const label = getKzMarketplaceLabel(marketplace)
                      const summary = kzCatalogSummary[marketplace]
                      const stats = summary
                        ? {
                            total: summary.total,
                            selling: summary.selling,
                            ready: summary.ready,
                            archived: summary.archived,
                          }
                        : computeCatalogProductStats(kzProducts[marketplace])

                      return (
                        <HomeProductsBlock
                          key={marketplace}
                          title={`Товары · ${label}`}
                          subtitle={`${stats.total} товаров на ${label}`}
                          status={kzProductsStatus[marketplace]}
                          stats={stats}
                          onOpen={() => {
                            handleKzMarketplaceChange(marketplace)
                            openTab('products')
                          }}
                          onRefresh={() => {
                            void loadKzCatalogSummary(marketplace)
                            void loadKzProducts(marketplace)
                          }}
                        />
                      )
                    })}
                  </div>
                )}
              </div>
              )}

              {shopRegion === 'rf' &&
                !isHomeBlockEnabled('production') &&
                !isHomeBlockEnabled('analytics') &&
                !isHomeBlockEnabled('supplies') &&
                !isHomeBlockEnabled('products') && (
                <div className="empty-state">
                  <strong>Нет доступных блоков для главной страницы.</strong>
                </div>
              )}

              {shopRegion === 'kz' &&
                !hasVisibleKzHomeBlock('production') &&
                !hasVisibleKzHomeBlock('analytics') &&
                !hasVisibleKzHomeBlock('products') && (
                <div className="empty-state">
                  <strong>Нет доступных блоков для главной страницы.</strong>
                </div>
              )}

              {user?.role === 'Admin' && shopRegion === 'rf' && (
                <div className="home-charts-grid">
                  <HomeSalesChartBlock
                    preset="year"
                    token={token ?? ''}
                    enabled={activeTab === 'home' && Boolean(token)}
                    loadDelayMs={0}
                  />
                  <HomeSalesChartBlock
                    preset="month"
                    token={token ?? ''}
                    enabled={activeTab === 'home' && Boolean(token)}
                    loadDelayMs={400}
                  />
                </div>
              )}
            </section>
          )}

          {activeTab === 'production' && (
            <section className="tab-panel">
              <div className="section-title">
                <div>
                  <h2>Производство</h2>
                  <p>{productionSectionSubtitle}</p>
                </div>
                <span className="section-actions">
                  {productionSubTab === 'archive' && user?.role === 'Admin' && hasSubFeature('production.archive', 'production') && (
                    <button type="button" className="header-action" onClick={exportTaskArchive}>
                      Скачать CSV
                    </button>
                  )}
                  <button
                    type="button"
                    className="header-action"
                    onClick={() => setProductionSubTab('archive')}
                    hidden={!hasSubFeature('production.archive', 'production')}
                  >
                    Архив задач
                  </button>
                </span>
              </div>

              {cancelTaskId && canCancelProductionTasks() && (
                <div className="modal-backdrop" role="presentation">
                  <div className="modal-card" role="dialog" aria-modal="true">
                    <div className="modal-title-row">
                      <h3>Отменить задачу</h3>
                      <button
                        type="button"
                        onClick={() => {
                          setCancelTaskId(null)
                          setCancelTaskComment('')
                        }}
                      >
                        Закрыть
                      </button>
                    </div>
                    <p>Укажите причину отмены. Создатель задачи получит уведомление от системы.</p>
                    <textarea
                      className="cancel-comment-input"
                      rows={4}
                      placeholder="Почему задача отменена?"
                      value={cancelTaskComment}
                      onChange={(event) => setCancelTaskComment(event.target.value)}
                    />
                    <div className="supply-actions">
                      <button type="button" className="danger" onClick={cancelProductionTask}>
                        Отменить задачу
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {transferDesignerItem && (
                <div className="modal-backdrop" role="presentation">
                  <div className="modal-card transfer-designer-modal" role="dialog" aria-modal="true">
                    <div className="modal-title-row">
                      <h3>Передать товар дизайнеру</h3>
                      <button type="button" onClick={closeTransferDesignerItemModal}>
                        Закрыть
                      </button>
                    </div>
                    <div className="transfer-designer-product">
                      <span>Товар</span>
                      <strong>{transferDesignerItem.item.productName}</strong>
                    </div>
                    <label className="field-label transfer-designer-field">
                      <span>Дизайнер</span>
                      <select
                        value={transferDesignerUserId}
                        onChange={(event) => setTransferDesignerUserId(event.target.value)}
                      >
                        <option value="" disabled>
                          Выберите дизайнера
                        </option>
                        {designerTransferUsers.map((item) => (
                          <option value={item.id} key={item.id}>
                            {item.displayName || item.userName}
                          </option>
                        ))}
                      </select>
                    </label>
                    {designerTransferUsers.length === 0 && (
                      <p className="form-status form-status-error">Нет доступных дизайнеров для передачи.</p>
                    )}
                    <div className="transfer-designer-actions">
                      <button type="button" className="secondary" onClick={closeTransferDesignerItemModal}>
                        Отмена
                      </button>
                      <button
                        type="button"
                        disabled={!transferDesignerUserId}
                        onClick={() => void transferDesignerTaskItem()}
                      >
                        Передать
                      </button>
                    </div>
                  </div>
                </div>
              )}

              <div className="inner-tabs">
                <button
                  type="button"
                  className={productionSubTab === 'products' ? 'active' : ''}
                  onClick={() => setProductionSubTab('products')}
                  hidden={!hasSubFeature('production.products', 'production')}
                >
                  Список товаров
                </button>
                <button
                  type="button"
                  className={productionSubTab === 'tasks' ? 'active' : ''}
                  onClick={() => {
                    markTaskNotificationsSeen('new', allNewProductionTasks.map((task) => task.id))
                    setProductionSubTab('tasks')
                  }}
                  hidden={!hasSubFeature('production.tasks', 'production')}
                >
                  Задачи
                  {renderTabBadge(unseenNewProductionTasks.length)}
                </button>
                <button
                  type="button"
                  className={productionSubTab === 'inProgress' ? 'active' : ''}
                  onClick={() => {
                    markTaskNotificationsSeen('in-progress', allInProgressProductionTasks.map((task) => task.id))
                    setProductionSubTab('inProgress')
                  }}
                  hidden={!hasSubFeature('production.inProgress', 'production')}
                >
                  В работе
                  {renderTabBadge(unseenInProgressProductionTasks.length)}
                </button>
                <button
                  type="button"
                  className={productionSubTab === 'cancelled' ? 'active' : ''}
                  onClick={() => {
                    markTaskNotificationsSeen('cancelled', allCancelledProductionTasks.map((task) => task.id))
                    setProductionSubTab('cancelled')
                  }}
                  hidden={!hasSubFeature('production.cancelled', 'production')}
                >
                  Отменённые
                  {renderTabBadge(unseenCancelledProductionTasks.length)}
                </button>
                <button
                  type="button"
                  className={productionSubTab === 'completed' ? 'active' : ''}
                  onClick={() => {
                    markTaskNotificationsSeen('completed', allCompletedProductionTasks.map((task) => task.id))
                    setProductionSubTab('completed')
                  }}
                  hidden={!hasSubFeature('production.completed', 'production')}
                >
                  Выполненные
                  {renderTabBadge(unseenCompletedProductionTasks.length)}
                </button>
                <button
                  type="button"
                  className={productionSubTab === 'readyToShip' ? 'active' : ''}
                  onClick={() => setProductionSubTab('readyToShip')}
                  hidden={!hasFeature('production.readyToShip') && !hasFeature('production.completed')}
                >
                  Готовые к отгрузке
                </button>
              </div>

              {productionSubTab !== 'products' && (
                <div className="toolbar-row">
                  <input
                    className="toolbar-search"
                    placeholder="Поиск по товару, артикулу, статусу или исполнителю"
                    value={taskSearch}
                    onChange={(event) => setTaskSearch(event.target.value)}
                  />
                  {productionSubTab === 'tasks' && (
                    <select
                      className="toolbar-select"
                      value={taskUrgencyFilter}
                      onChange={(event) =>
                        setTaskUrgencyFilter(event.target.value as 'all' | 'urgent' | 'normal')
                      }
                    >
                      <option value="all">Все задачи</option>
                      <option value="urgent">Срочные</option>
                      <option value="normal">Обычные</option>
                    </select>
                  )}
                </div>
              )}

              {productionSubTab !== 'products' && shopRegion === 'kz' && (
                <div className="production-task-marketplace-row">
                  <KzMarketplaceTabs
                    activeMarketplace={kzTaskMarketplace}
                    onChange={handleKzTaskMarketplaceChange}
                  />
                  {canCreateProductionTasks() && productionSubTab === 'tasks' && (
                    <button type="button" className="production-novinka-create-btn" onClick={openCreateNovinkaTaskModal}>
                      Задача дизайн
                    </button>
                  )}
                </div>
              )}

              {productionSubTab === 'products' && (
                <>
                  <div className="production-tools">
                    <div className="inner-tabs production-catalog-tabs">
                      {shopRegion === 'rf' ? (
                        <button
                          type="button"
                          className={productionCatalogTab === 'ozon' ? 'active' : ''}
                          onClick={() => {
                            setProductionCatalogTab('ozon')
                            setProductEditorStatus('')
                          }}
                        >
                          Товары на Ozon
                        </button>
                      ) : (
                        (['kaspi', 'satu', 'halyk'] as const).map((marketplace) => (
                          <button
                            key={marketplace}
                            type="button"
                            className={productionCatalogTab === marketplace ? 'active' : ''}
                            onClick={() => {
                              setProductionCatalogTab(marketplace)
                              setProductEditorStatus('')
                              handleKzMarketplaceChange(marketplace)
                            }}
                          >
                            Товары {getKzMarketplaceLabel(marketplace)}
                          </button>
                        ))
                      )}
                      {getVisibleNovinkaMarketplaces(shopRegion).map((marketplace) => (
                        <button
                          key={`novinka-${marketplace}`}
                          type="button"
                          className={
                            productionCatalogTab === toNovinkaCatalogTab(marketplace) ? 'active' : ''
                          }
                          onClick={() => {
                            setProductionCatalogTab(toNovinkaCatalogTab(marketplace))
                            setProductEditorStatus('')
                          }}
                        >
                          Новинки {getNovinkaMarketplaceLabel(marketplace)}
                        </button>
                      ))}
                      {canEditProductionProducts() && (
                        <button
                          type="button"
                          className={productionCatalogTab === 'editor' ? 'active' : ''}
                          onClick={() => {
                            setProductionCatalogTab('editor')
                            setProductEditorStatus('')
                            if (shopRegion === 'rf') {
                              if (ozonProducts.length === 0) {
                                void loadOzonProducts()
                              }
                            } else if (activeKzProducts.length === 0) {
                              void loadKzProducts()
                            }
                          }}
                        >
                          Редактор товаров
                        </button>
                      )}
                    </div>
                    {productionCatalogTab !== 'editor' && (
                      <form
                        className="search-form"
                        onSubmit={(event) => {
                          event.preventDefault()
                          if (isNovinkaCatalogTab(productionCatalogTab)) {
                            void loadProductionFiles(productionSearch)
                          } else if (shopRegion === 'rf') {
                            void loadOzonProducts()
                          } else {
                            void loadKzProducts(productionCatalogTab as KzMarketplace)
                          }
                        }}
                      >
                        <input
                          placeholder="Поиск по названию, артикулу или ссылке"
                          value={productionSearch}
                          onChange={(event) => setProductionSearch(event.target.value)}
                        />
                        <button type="submit">Найти</button>
                      </form>
                    )}
                  </div>

                  {productionCatalogTab === 'editor' && canEditProductionProducts() ? (
                    <ProductTypeEditorPanel
                      token={token}
                      novinkaProducts={editorNovinkaCatalogItems}
                      catalogProducts={productionLookupProducts}
                      selectedNovinkaOfferId={editorNovinkaOfferId}
                      selectedCatalogProductId={editorOzonProductId}
                      onNovinkaOfferIdChange={setEditorNovinkaOfferId}
                      onCatalogProductIdChange={setEditorOzonProductId}
                      selectedNovinka={editorSelectedNovinka}
                      selectedCatalogProduct={editorSelectedOzon}
                      status={productEditorStatus}
                      saving={productEditorSaving}
                      onConvert={() => void convertNovinkaToOzon()}
                      onRefreshCatalogProducts={() =>
                        shopRegion === 'rf' ? void loadOzonProducts() : void loadKzProducts(kzMarketplace)
                      }
                      productionFiles={productionFiles}
                      productionFilePaths={productionFilePaths}
                      onRefreshProductionData={() => loadProductionFiles(productionSearch)}
                      onDownloadFile={downloadProductionFile}
                      onDeleteFile={canDeleteProductionFiles() ? deleteProductionFile : undefined}
                      shopRegion={shopRegion}
                      kzMarketplace={kzMarketplace}
                      kzProducts={kzProducts}
                      onKzMarketplaceChange={handleKzMarketplaceChange}
                    />
                  ) : (
                    <>
                  <div className="section-title soft-title">
                    <h2>
                      {activeNovinkaCatalogMarketplace !== null
                        ? `Новинки ${getNovinkaMarketplaceLabel(activeNovinkaCatalogMarketplace)}`
                        : shopRegion === 'rf'
                          ? 'Товары на Ozon'
                          : `Товары ${getKzMarketplaceLabel(productionCatalogTab as KzMarketplace)}`}
                    </h2>
                    <p>
                      {activeNovinkaCatalogMarketplace !== null
                        ? `Новинки ${getNovinkaMarketplaceLabel(activeNovinkaCatalogMarketplace)} с превью · ${filteredProductionCatalog.length}`
                        : shopRegion === 'rf'
                          ? `Все товары Ozon · ${filteredProductionCatalog.length}`
                          : `Все товары ${getKzMarketplaceLabel(productionCatalogTab as KzMarketplace)} · ${filteredProductionCatalog.length}`}
                    </p>
                  </div>

                  <div className="data-table">
                    <div className="table-row production-product-row table-head">
                      <span>Товар</span>
                      <span>{isMarketplaceProductionCatalogTab ? 'Артикул' : 'Ссылка'}</span>
                      <span>Превью</span>
                      <span>Пути к файлу</span>
                      <span>Действия</span>
                    </div>
                    {filteredProductionCatalog.map((item) => {
                      const ozonProduct = ozonProducts.find(
                        (product) =>
                          product.productId === item.ozonProductId ||
                          product.offerId === item.offerId,
                      )
                      const itemFiles = getProductionFilesForCatalogItem(item, productionFiles)
                      const itemPaths = getProductionPathsForCatalogItem(item, productionFilePaths)
                      const catalogKey = item.offerId || item.productName

                      return (
                        <div className="product-row-group" key={catalogKey}>
                          <div className="table-row production-product-row">
                            <span className="unsold-product-name">
                              {ozonProduct?.imageUrl ? (
                                <ProductImageHoverPreview imageUrl={ozonProduct.imageUrl} name={item.productName}>
                                  <ProductThumb imageUrl={ozonProduct.imageUrl} name={item.productName} />
                                </ProductImageHoverPreview>
                              ) : (
                                <ProductThumb name={item.productName} />
                              )}
                              <span>
                                <strong>{item.productName}</strong>
                                <small>
                                  {isMarketplaceProductionCatalogTab
                                    ? shopRegion === 'rf'
                                      ? 'Ozon'
                                      : getKzMarketplaceLabel(productionCatalogTab as KzMarketplace)
                                    : getNovinkaMarketplaceLabel(activeNovinkaCatalogMarketplace ?? 'ozon')}
                                </small>
                              </span>
                            </span>
                            <span>
                              {isMarketplaceProductionCatalogTab ? (
                                <OfferIdCell offerId={item.offerId} />
                              ) : item.productLink ? (
                                <a href={item.productLink} target="_blank" rel="noreferrer">
                                  Открыть ссылку
                                </a>
                              ) : (
                                '-'
                              )}
                            </span>
                            <span>
                              {itemFiles.length > 0 ? (
                                <button
                                  type="button"
                                  className="production-files-trigger"
                                  onClick={() => openProductionFilesModal(item.productName, itemFiles)}
                                >
                                  Превью ({itemFiles.length})
                                </button>
                              ) : (
                                '—'
                              )}
                            </span>
                            <span>
                              <ProductionPathsPanel paths={itemPaths} showCopy />
                            </span>
                            <span>
                              {isMarketplaceProductionCatalogTab && ozonProduct?.productUrl ? (
                                <a href={ozonProduct.productUrl} target="_blank" rel="noreferrer">
                                  {shopRegion === 'rf' ? 'Ozon' : getKzMarketplaceLabel(productionCatalogTab as KzMarketplace)}
                                </a>
                              ) : activeNovinkaCatalogMarketplace !== null && item.productLink ? (
                                <a href={item.productLink} target="_blank" rel="noreferrer">
                                  Товар
                                </a>
                              ) : (
                                '-'
                              )}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                    {filteredProductionCatalog.length === 0 && (
                      <div className="empty-state">
                        <strong>
                          {isMarketplaceProductionCatalogTab
                            ? shopRegion === 'rf'
                              ? 'Товары Ozon пока не загружены.'
                              : `Товары ${getKzMarketplaceLabel(productionCatalogTab as KzMarketplace)} пока не загружены.`
                            : activeNovinkaCatalogMarketplace !== null
                              ? `Пока нет новинок ${getNovinkaMarketplaceLabel(activeNovinkaCatalogMarketplace)} с превью.`
                              : 'Пока нет новинок с превью.'}
                        </strong>
                      </div>
                    )}
                  </div>
                    </>
                  )}
                </>
              )}

              {productionSubTab === 'tasks' && (
                <>
                  {canCreateProductionTasks() && (
                    <div className="supply-create-bar">
                      {shopRegion === 'rf' && (
                        <button
                          type="button"
                          className="production-novinka-create-btn"
                          onClick={openCreateNovinkaTaskModal}
                        >
                          Задача дизайн
                        </button>
                      )}
                      <button type="button" onClick={openCreateTaskModal}>
                        Задача производство
                      </button>
                      {shopRegion === 'rf' && (
                        <button type="button" onClick={openCreatePackagingTaskModal}>
                          Задача упаковка
                        </button>
                      )}
                    </div>
                  )}

                  {showCreateTaskModal && (canCreateProductionTasks() || (editingTaskId && canEditProductionTasks())) && (
                    <div className="modal-backdrop" role="presentation">
                      <div className="modal-card modal-card-wide" role="dialog" aria-modal="true">
                        <div className="modal-title-row">
                          <h3>
                            {editingTaskId
                              ? 'Редактировать задачу'
                              : taskFormMode === 'packaging'
                                ? 'Создать задачу упаковки'
                                : 'Создать задачу'}
                          </h3>
                          <button type="button" onClick={closeTaskFormModal}>
                            Закрыть
                          </button>
                        </div>

                        {editingTaskId && canChangeProductionTaskType() && (
                          <div className="task-type-switcher" aria-label="Сменить тип задачи">
                            <button
                              type="button"
                              className={taskEditorKind === 'production' ? 'active' : ''}
                              onClick={() => switchEditingTaskKind('production')}
                            >
                              Производство
                            </button>
                            <button
                              type="button"
                              className={taskEditorKind === 'novinka' ? 'active' : ''}
                              onClick={() => switchEditingTaskKind('novinka')}
                            >
                              Дизайн
                            </button>
                          </div>
                        )}

                        {!editingTaskId && shopRegion === 'kz' && (
                          <div className="task-form-mode-tabs">
                            {(['kaspi', 'satu', 'halyk'] as const).map((marketplace) => (
                              <button
                                key={marketplace}
                                type="button"
                                className={`task-form-mode-tab ${taskFormMode === marketplace ? 'active' : ''}`}
                                onClick={() => {
                                  setTaskFormMode(marketplace)
                                  handleKzTaskMarketplaceChange(marketplace)
                                }}
                              >
                                {getKzMarketplaceLabel(marketplace)}
                              </button>
                            ))}
                          </div>
                        )}

                        <div className="task-form task-form-modal">
                          <div className="supply-forms">
                              <div className="supply-form-block supply-form-block-ozon">
                                <strong>
                                  {shopRegion === 'rf'
                                    ? taskFormMode === 'packaging'
                                      ? 'Закупной товар'
                                      : 'Товар из Ozon'
                                    : `Товар из ${getKzMarketplaceLabel(
                                        taskFormMode === 'kaspi' ||
                                          taskFormMode === 'satu' ||
                                          taskFormMode === 'halyk'
                                          ? taskFormMode
                                          : kzTaskMarketplace,
                                      )}`}
                                </strong>
                                <ProductSearchInput
                                  listId="task-products"
                                  products={getTaskFormProducts()}
                                  selectedProductId={selectedTaskProductId}
                                  onProductIdChange={setSelectedTaskProductId}
                                  placeholder="Начните писать название или артикул"
                                  hideInlinePreview
                                  showClearButton
                                />
                                <div className="task-form-modal-compose supply-form-compose">
                                  {(() => {
                                    const selectedTaskProduct = getTaskFormProducts().find(
                                      (item) => String(item.productId) === selectedTaskProductId,
                                    )
                                    const supplyHint = selectedTaskProduct
                                      ? formatProductSupplyHint(
                                          getProductSupplySummary(
                                            selectedTaskProduct.productId,
                                            selectedTaskProduct.offerId,
                                            supplies,
                                          ),
                                        )
                                      : ''

                                    return selectedTaskProduct ? (
                                      <div className="task-form-modal-preview-wrap">
                                        <TaskProductPreview product={selectedTaskProduct} />
                                        {supplyHint && <p className="task-product-supply-hint">{supplyHint}</p>}
                                        {taskFormProductDuplicateHint && (
                                          <p className="task-draft-duplicate-hint">{taskFormProductDuplicateHint}</p>
                                        )}
                                      </div>
                                    ) : (
                                      <div className="task-form-modal-preview task-form-modal-preview-empty">
                                        <span>
                                          {taskFormMode === 'packaging'
                                            ? 'Выберите закупной товар для превью'
                                            : 'Выберите товар для превью'}
                                        </span>
                                      </div>
                                    )
                                  })()}
                                  <div className="task-form-modal-actions">
                                    <input
                                      className="task-quantity-input task-form-modal-qty"
                                      type="text"
                                      inputMode="numeric"
                                      pattern="[0-9]*"
                                      placeholder="Кол-во"
                                      value={taskQuantity}
                                      onChange={(event) => setTaskQuantity(event.target.value.replace(/\D/g, ''))}
                                    />
                                    <button type="button" className="task-form-modal-btn" onClick={addDraftTaskItem}>
                                      Добавить
                                    </button>
                                  </div>
                                </div>
                              </div>

                              {taskFormMode !== 'packaging' && (
                              <div className="supply-form-block supply-form-block-ozon supply-form-block-novinka">
                                <strong>
                                  Новинки из каталога ·{' '}
                                  {getNovinkaMarketplaceLabel(
                                    resolveTaskFormNovinkaMarketplace(shopRegion, taskFormMode, kzTaskMarketplace),
                                  )}
                                </strong>
                                <NovinkaSearchInput
                                  listId="task-novinka-products"
                                  products={taskFormNovinkaCatalogItems}
                                  selectedOfferId={selectedTaskNovinkaOfferId}
                                  onOfferIdChange={setSelectedTaskNovinkaOfferId}
                                  placeholder="Начните писать название или артикул"
                                  showClearButton
                                />
                                <div className="task-form-modal-compose supply-form-compose">
                                  {(() => {
                                    const selectedTaskNovinka = taskFormNovinkaCatalogItems.find(
                                      (item) => item.offerId === selectedTaskNovinkaOfferId,
                                    )

                                    return selectedTaskNovinka ? (
                                      <div className="task-form-modal-preview-wrap">
                                        <NovinkaProductPreview
                                          item={selectedTaskNovinka}
                                          token={token}
                                          paths={getProductionPathsForCatalogItem(
                                            selectedTaskNovinka,
                                            productionFilePaths,
                                          )}
                                          files={getProductionFilesForCatalogItem(
                                            selectedTaskNovinka,
                                            productionFiles,
                                          )}
                                        />
                                        {taskFormNovinkaDuplicateHint && (
                                          <p className="task-draft-duplicate-hint">{taskFormNovinkaDuplicateHint}</p>
                                        )}
                                      </div>
                                    ) : (
                                      <div className="task-form-modal-preview task-form-modal-preview-empty">
                                        <span>Выберите новинку для превью</span>
                                      </div>
                                    )
                                  })()}
                                  <div className="task-form-modal-actions">
                                    <input
                                      className="task-quantity-input task-form-modal-qty"
                                      type="text"
                                      inputMode="numeric"
                                      pattern="[0-9]*"
                                      placeholder="Кол-во"
                                      value={taskNovinkaQuantity}
                                      onChange={(event) => setTaskNovinkaQuantity(event.target.value.replace(/\D/g, ''))}
                                    />
                                    <button
                                      type="button"
                                      className="task-form-modal-btn"
                                      onClick={addDraftNovinkaToOzonTask}
                                    >
                                      Добавить
                                    </button>
                                  </div>
                                </div>
                              </div>
                              )}
                            </div>
                        </div>

                        <div className="data-table modal-table">
                          <>
                          <div className="table-row task-draft-row table-head">
                            <span>Товар</span>
                            <span>Артикул</span>
                            <span>Количество</span>
                            <span>Мин. план</span>
                            <span></span>
                          </div>
                          {draftTaskItems.map((item) => {
                            const draftSupplyHint = item.isNovinka
                              ? ''
                              : formatProductSupplyHint(
                                  getProductSupplySummary(item.ozonProductId, item.offerId, supplies),
                                )
                            const draftCatalogItem: ProductionCatalogItem = {
                              offerId: item.offerId,
                              ozonProductId: item.ozonProductId || undefined,
                              productName: item.productName,
                              productLink: item.productLink ?? '',
                              fileCount: 0,
                            }
                            const draftPreviewFile = item.isNovinka
                              ? getProductionFilesForCatalogItem(draftCatalogItem, productionFiles).find((file) =>
                                  file.contentType.startsWith('image/'),
                                )
                              : undefined
                            const draftPaths = item.isNovinka
                              ? getProductionPathsForCatalogItem(draftCatalogItem, productionFilePaths)
                              : []
                            const productionSummaryParts = item.productionSummary
                              ? [
                                  item.productionSummary.inProgressQuantity > 0
                                    ? `в работе ${item.productionSummary.inProgressQuantity} шт.`
                                    : '',
                                  item.productionSummary.createdQuantity > 0
                                    ? `в созданных ${item.productionSummary.createdQuantity} шт.`
                                    : '',
                                  item.productionSummary.completedQuantity > 0
                                    ? `в выполненных ${item.productionSummary.completedQuantity} шт.`
                                    : '',
                                ].filter(Boolean)
                              : []

                            return (
                            <div className="table-row task-draft-row" key={item.tempId}>
                              <span className="product-mini task-draft-product-mini">
                                {draftPreviewFile ? (
                                  <ProductionFileThumb file={draftPreviewFile} token={token} name={item.productName} />
                                ) : item.isNovinka && item.productLink ? (
                                  <LinkHoverPreview
                                    url={item.productLink}
                                    name={item.productName}
                                    token={token}
                                  />
                                ) : (
                                  <ProductThumb imageUrl={item.imageUrl} name={item.productName} large />
                                )}
                                <span>
                                  <strong>{item.productName}</strong>
                                  {item.isNovinka && (
                                    <>
                                      <small className="task-product-supply-hint-inline">
                                        Новинка · {draftPreviewFile ? 'превью есть' : 'превью не найдено'}
                                      </small>
                                      <div className="task-draft-catalog-assets">
                                        {draftPaths.length > 0 && (
                                          <CompactProductionPathsPanel paths={draftPaths} />
                                        )}
                                      </div>
                                    </>
                                  )}
                                  {draftSupplyHint && (
                                    <small className="task-product-supply-hint-inline">{draftSupplyHint}</small>
                                  )}
                                  {productionSummaryParts.length > 0 && (
                                    <small className="production-item-summary-hint">
                                      Уже в производстве: {productionSummaryParts.join(' · ')}
                                    </small>
                                  )}
                                </span>
                              </span>
                              <OfferIdCell offerId={item.offerId} />
                              <span>
                                <input
                                  className="task-quantity-input"
                                  type="text"
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  placeholder="0"
                                  value={item.requiredQuantity > 0 ? String(item.requiredQuantity) : ''}
                                  onChange={(event) => {
                                    const nextValue = event.target.value.replace(/\D/g, '')
                                    setDraftTaskItems((current) =>
                                      current.map((entry) =>
                                        entry.tempId === item.tempId
                                          ? {
                                              ...entry,
                                              requiredQuantity: Number(nextValue) || 0,
                                            }
                                          : entry,
                                      ),
                                    )
                                  }}
                                />
                              </span>
                              <span>
                                <label className="task-minimum-toggle" title="Факт не может быть меньше плана">
                                  <input
                                    type="checkbox"
                                    checked={item.enforceMinimumQuantity}
                                    onChange={(event) =>
                                      setDraftTaskItems((current) =>
                                        current.map((entry) =>
                                          entry.tempId === item.tempId
                                            ? { ...entry, enforceMinimumQuantity: event.target.checked }
                                            : entry,
                                        ),
                                      )
                                    }
                                  />
                                  Не меньше
                                </label>
                              </span>
                              <span>
                                <button
                                  type="button"
                                  className="danger"
                                  onClick={() =>
                                    setDraftTaskItems((current) =>
                                      current.filter((task) => task.tempId !== item.tempId),
                                    )
                                  }
                                >
                                  Убрать
                                </button>
                              </span>
                            </div>
                            )
                          })}
                          {draftTaskItems.length === 0 && (
                            <div className="empty-state">
                              <strong>Добавьте товары в задачу.</strong>
                            </div>
                          )}
                          </>
                        </div>

                        <div className="supply-actions task-form-modal-footer">
                          {taskFormStatus && <p className="modal-status">{taskFormStatus}</p>}
                          {canManageProductionTaskDeadline() && (
                            <label className="task-deadline-field">
                              <span>Выполнить до</span>
                              <input
                                type="datetime-local"
                                value={taskDueAt}
                                onChange={(event) => setTaskDueAt(event.target.value)}
                              />
                            </label>
                          )}
                          <button
                            type="button"
                            disabled={taskFormSaving}
                            onClick={() => void saveTaskFromDraft()}
                          >
                            {taskFormSaving ? 'Сохранение...' : editingTaskId ? 'Сохранить' : 'Создать'}
                          </button>
                          <label className="task-urgent-toggle">
                            <input
                              type="checkbox"
                              checked={taskIsUrgent}
                              onChange={(event) => setTaskIsUrgent(event.target.checked)}
                            />
                            Срочно
                          </label>
                        </div>
                      </div>
                    </div>
                  )}

                  {showCreateNovinkaTaskModal && (canCreateProductionTasks() || (editingTaskId && canEditProductionTasks())) && (
                    <div className="modal-backdrop" role="presentation">
                      <div className="modal-card modal-card-wide" role="dialog" aria-modal="true">
                        <div className="modal-title-row">
                          <h3>{editingTaskId ? 'Редактировать задачу новинки' : 'Создать задачу новинки'}</h3>
                          <button type="button" onClick={closeNovinkaTaskFormModal}>
                            Закрыть
                          </button>
                        </div>

                        {editingTaskId && canChangeProductionTaskType() && (
                          <div className="task-type-switcher" aria-label="Сменить тип задачи">
                            <button
                              type="button"
                              className={taskEditorKind === 'production' ? 'active' : ''}
                              onClick={() => switchEditingTaskKind('production')}
                            >
                              Производство
                            </button>
                            <button
                              type="button"
                              className={taskEditorKind === 'novinka' ? 'active' : ''}
                              onClick={() => switchEditingTaskKind('novinka')}
                            >
                              Дизайн
                            </button>
                          </div>
                        )}

                        {shopRegion === 'kz' && (
                          <div className="task-form-mode-tabs novinka-task-marketplace-tabs">
                            {(['kaspi', 'satu', 'halyk'] as const).map((marketplace) => (
                              <button
                                key={marketplace}
                                type="button"
                                className={`task-form-mode-tab ${novinkaTaskMarketplace === marketplace ? 'active' : ''}`}
                                onClick={() => setNovinkaTaskMarketplace(marketplace)}
                              >
                                {getKzMarketplaceLabel(marketplace)}
                              </button>
                            ))}
                          </div>
                        )}

                        <div className="task-form task-form-modal">
                          <div className="supply-form-block supply-form-block-novinka task-novinka-create-block">
                            <strong>
                              {shopRegion === 'rf'
                                ? 'Новая новинка'
                                : `Новая новинка · ${getNovinkaMarketplaceLabel(novinkaTaskMarketplace)}`}
                            </strong>
                            <span className="product-type-editor-hint">
                              Укажите наименование и ссылку на товар. Превью появится после загрузки изображения при выполнении задачи.
                            </span>
                            <div className="novinka-task-fields">
                              <label className="novinka-task-field">
                                <span>Наименование товара</span>
                                <input
                                  className="novinka-task-input"
                                  placeholder="Введите название"
                                  value={novinkaProductName}
                                  onChange={(event) => setNovinkaProductName(event.target.value)}
                                />
                              </label>
                              <label className="novinka-task-field">
                                <span>Ссылка на товар</span>
                                <input
                                  className="novinka-task-input"
                                  placeholder="https://..."
                                  value={novinkaProductLink}
                                  onChange={(event) => setNovinkaProductLink(event.target.value)}
                                />
                              </label>
                              <label className="novinka-task-field">
                                <span>Количество</span>
                                <input
                                  className="novinka-task-input"
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  placeholder="Кол-во"
                                  value={taskNovinkaQuantity}
                                  onChange={(event) => setTaskNovinkaQuantity(event.target.value.replace(/\D/g, ''))}
                                />
                              </label>
                            </div>
                            <div className="novinka-task-compose-actions">
                              <button type="button" className="task-form-modal-btn novinka-add-btn" onClick={addDraftNovinkaItem}>
                                Добавить
                              </button>
                            </div>
                          </div>
                        </div>

                        <div className="data-table modal-table">
                          <div className="table-row task-draft-row novinka-draft-row table-head">
                            <span>Товар</span>
                            <span>Ссылка</span>
                            <span>Количество</span>
                            <span></span>
                          </div>
                          {draftNovinkaItems.map((item) => (
                            <div className="table-row task-draft-row novinka-draft-row" key={item.tempId}>
                              <span className="product-mini task-draft-product-mini">
                                {item.productLink ? (
                                  <LinkHoverPreview
                                    url={item.productLink}
                                    name={item.productName}
                                    token={token}
                                  />
                                ) : (
                                  <ProductThumb name={item.productName} large />
                                )}
                                <span className="task-draft-product-name">
                                  <strong>{item.productName}</strong>
                                </span>
                              </span>
                              <span>
                                <NovinkaExternalLinkButton url={item.productLink} />
                              </span>
                              <span>
                                <input
                                  className="task-draft-quantity-input"
                                  inputMode="numeric"
                                  pattern="[0-9]*"
                                  placeholder="Кол-во"
                                  value={item.requiredQuantity > 0 ? String(item.requiredQuantity) : ''}
                                  onChange={(event) => {
                                    const nextValue = event.target.value.replace(/\D/g, '')
                                    setDraftNovinkaItems((current) =>
                                      current.map((entry) =>
                                        entry.tempId === item.tempId
                                          ? { ...entry, requiredQuantity: Number(nextValue) || 0 }
                                          : entry,
                                      ),
                                    )
                                  }}
                                />
                              </span>
                              <span>
                                <button
                                  type="button"
                                  className="danger"
                                  onClick={() =>
                                    setDraftNovinkaItems((current) =>
                                      current.filter((entry) => entry.tempId !== item.tempId),
                                    )
                                  }
                                >
                                  Убрать
                                </button>
                              </span>
                            </div>
                          ))}
                          {draftNovinkaItems.length === 0 && (
                            <div className="empty-state">
                              <strong>Добавьте новинки в задачу.</strong>
                            </div>
                          )}
                        </div>

                        <div className="supply-actions task-form-modal-footer">
                          {taskFormStatus && <p className="modal-status">{taskFormStatus}</p>}
                          {canManageProductionTaskDeadline() && (
                            <label className="task-deadline-field">
                              <span>Выполнить до</span>
                              <input
                                type="datetime-local"
                                value={taskDueAt}
                                onChange={(event) => setTaskDueAt(event.target.value)}
                              />
                            </label>
                          )}
                          <button
                            type="button"
                            disabled={taskFormSaving}
                            onClick={() => void saveNovinkaTaskFromDraft()}
                          >
                            {taskFormSaving ? 'Сохранение...' : editingTaskId ? 'Сохранить' : 'Создать'}
                          </button>
                          <label className="task-urgent-toggle">
                            <input
                              type="checkbox"
                              checked={taskIsUrgent}
                              onChange={(event) => setTaskIsUrgent(event.target.checked)}
                            />
                            Срочно
                          </label>
                        </div>
                      </div>
                    </div>
                  )}

                  <ProductionTaskTable
                    tasks={filteredNewProductionTasks}
                    tableContext={roleTaskTableContext}
                    products={productionLookupProducts}
                    productionFiles={productionFiles}
                    productionFilePaths={productionFilePaths}
                    token={token}
                    actualQuantities={actualQuantities}
                    setActualQuantities={setActualQuantities}
                    currentUserId={user?.id}
                    currentUserName={user?.displayName || user?.userName}
                    currentUserAliases={currentUserAliases}
                    isAdmin={user?.role === 'Admin'}
                    canCancelTasks={canCancelProductionTasks()}
                    canManageTaskDeadline={canManageProductionTaskDeadline()}
                    onStart={startProductionTask}
                    onCancelRequest={setCancelTaskId}
                    onComplete={completeProductionTask}
                    onOpenFiles={openProductionFilesModal}
                    onUploadTaskItemFile={uploadProductionFileForTaskItem}
                    onEdit={canEditProductionTasks() ? openEditTaskModal : undefined}
                  />
                </>
              )}

              {productionSubTab === 'inProgress' && (
                <>
                  <div className="subtabs-placeholder production-task-list-filters">
                    <label>
                      <span>Исполнитель</span>
                      <select
                        value={productionTaskAssigneeFilter}
                        onChange={(event) => setProductionTaskAssigneeFilter(event.target.value)}
                      >
                        <option value="">Все</option>
                        {productionTaskFilterAssignees.map((assignee) => (
                          <option key={assignee} value={assignee}>
                            {assignee}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Тип</span>
                      <select
                        value={productionTaskTypeFilter}
                        onChange={(event) =>
                          setProductionTaskTypeFilter(event.target.value as 'all' | 'design' | 'production')
                        }
                      >
                        <option value="all">Все</option>
                        <option value="design">Дизайн</option>
                        <option value="production">Производство</option>
                      </select>
                    </label>
                  </div>
                  <ProductionTaskTable
                    tasks={inProgressProductionTasks}
                    tableContext={roleTaskTableContext}
                    products={productionLookupProducts}
                    productionFiles={productionFiles}
                    productionFilePaths={productionFilePaths}
                    token={token}
                    actualQuantities={actualQuantities}
                    setActualQuantities={setActualQuantities}
                    currentUserId={user?.id}
                    currentUserName={user?.displayName || user?.userName}
                    currentUserAliases={currentUserAliases}
                    isAdmin={user?.role === 'Admin'}
                    canCancelTasks={canCancelProductionTasks()}
                    canManageTaskDeadline={canManageProductionTaskDeadline()}
                    canStartTask={canStartVisibleProductionTask}
                    onStart={startProductionTask}
                    onCancelRequest={setCancelTaskId}
                    onComplete={completeProductionTask}
                    onOpenFiles={openProductionFilesModal}
                    onUploadTaskItemFile={uploadProductionFileForTaskItem}
                    onSaveTaskItemFilePath={saveProductionTaskItemFilePath}
                    onDeleteTaskItemFilePath={deleteProductionTaskItemFilePath}
                    onSaveTaskItemActualQuantity={saveProductionTaskItemActualQuantity}
                    onSaveTaskItemRequiredQuantity={
                      canEditProductionTasks() ? saveProductionTaskItemRequiredQuantity : undefined
                    }
                    onCreateProductionFromNovinkaItem={
                      canCreateProductionTasks() ? openProductionTaskFromNovinkaItem : undefined
                    }
                    onTransferNovinkaItem={
                      canSeeDesignerProductionTasks ? openTransferDesignerItemModal : undefined
                    }
                  />
                </>
              )}

              {productionSubTab === 'cancelled' && (
                <ProductionTaskTable
                  tasks={cancelledProductionTasks}
                  tableContext={roleTaskTableContext}
                  products={productionLookupProducts}
                  productionFiles={productionFiles}
                  productionFilePaths={productionFilePaths}
                  token={token}
                  actualQuantities={actualQuantities}
                  setActualQuantities={setActualQuantities}
                  currentUserId={user?.id}
                  currentUserName={user?.displayName || user?.userName}
                  currentUserAliases={currentUserAliases}
                  isAdmin={user?.role === 'Admin'}
                  canCancelTasks={canCancelProductionTasks()}
                  canManageTaskDeadline={canManageProductionTaskDeadline()}
                  canStartTask={canStartVisibleProductionTask}
                  onStart={startProductionTask}
                  onCancelRequest={setCancelTaskId}
                  onComplete={completeProductionTask}
                  onOpenFiles={openProductionFilesModal}
                  onUploadTaskItemFile={uploadProductionFileForTaskItem}
                  onArchive={canArchiveProductionTasks() ? archiveProductionTask : undefined}
                  onRestore={user?.role === 'Admin' ? restoreProductionTask : undefined}
                  cancelled
                />
              )}

              {productionSubTab === 'readyToShip' && (
                <ProductionTaskArchiveTable
                  tasks={readyToShipProductionTasks}
                  tableContext="ozon"
                  products={productionLookupProducts}
                  productionFiles={productionFiles}
                  productionFilePaths={productionFilePaths}
                  token={token}
                  onOpenFiles={openProductionFilesModal}
                  onArchive={canArchiveProductionTasks() ? archiveProductionTask : undefined}
                  emptyText="Готовых к отгрузке задач пока нет."
                />
              )}

              {productionSubTab === 'completed' && (
                <>
                  <div className="subtabs-placeholder production-task-list-filters">
                    <label>
                      <span>Исполнитель</span>
                      <select
                        value={productionTaskAssigneeFilter}
                        onChange={(event) => setProductionTaskAssigneeFilter(event.target.value)}
                      >
                        <option value="">Все</option>
                        {productionTaskFilterAssignees.map((assignee) => (
                          <option key={assignee} value={assignee}>
                            {assignee}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Тип</span>
                      <select
                        value={productionTaskTypeFilter}
                        onChange={(event) =>
                          setProductionTaskTypeFilter(event.target.value as 'all' | 'design' | 'production')
                        }
                      >
                        <option value="all">Все</option>
                        <option value="design">Дизайн</option>
                        <option value="production">Производство</option>
                      </select>
                    </label>
                  </div>
                  <ProductionTaskArchiveTable
                    tasks={completedProductionTasks}
                    tableContext={roleTaskTableContext}
                    products={productionLookupProducts}
                    productionFiles={productionFiles}
                    productionFilePaths={productionFilePaths}
                    token={token}
                    onOpenFiles={openProductionFilesModal}
                    onArchive={canArchiveProductionTasks() ? archiveProductionTask : undefined}
                    onCreateProductionFromNovinka={
                      canCreateProductionTasks() ? openProductionTaskFromCompletedNovinka : undefined
                    }
                    onPackItem={canPackProductionItems() ? packProductionTaskItem : undefined}
                    emptyText="Выполненных задач пока нет."
                  />
                </>
              )}

              {productionSubTab === 'archive' && (
                <>
                  <div className="subtabs-placeholder archive-task-filters">
                    <label>
                      <span>Статус</span>
                      <select
                        value={archiveTaskStatusFilter}
                        onChange={(event) =>
                          setArchiveTaskStatusFilter(event.target.value as 'all' | 'Completed' | 'Cancelled')
                        }
                      >
                        <option value="all">Все</option>
                        <option value="Completed">Завершена</option>
                        <option value="Cancelled">Отменена</option>
                      </select>
                    </label>
                  </div>
                  <ProductionTaskArchiveTable
                    tasks={filteredArchivedProductionTasks}
                    tableContext="mixed"
                    products={productionLookupProducts}
                    productionFiles={productionFiles}
                    productionFilePaths={productionFilePaths}
                    token={token}
                    onOpenFiles={openProductionFilesModal}
                    archiveView
                    onDelete={user?.role === 'Admin' ? deleteProductionTask : undefined}
                    emptyText="В архиве задач пока нет."
                  />
                </>
              )}
            </section>
          )}

          {activeTab === 'products' && (
            <section className="products">
              <div className="section-title">
                <h2>Товары</h2>
                <p>
                  {isLoading
                    ? 'Загрузка...'
                    : shopRegion === 'rf'
                      ? 'Каталог Ozon'
                      : `Каталог ${getKzMarketplaceLabel(kzMarketplace)}`}
                </p>
              </div>

              {shopRegion === 'kz' && (
                <KzMarketplaceTabs activeMarketplace={kzMarketplace} onChange={handleKzMarketplaceChange} />
              )}

              {shopRegion === 'kz' && kzMarketplace === 'satu' && kzSatuSyncStatus && (
                <div className={`satu-sync-banner satu-sync-${kzSatuSyncStatus.status.toLowerCase()}`}>
                  <strong>Синхронизация SATU:</strong>{' '}
                  {kzSatuSyncStatus.status === 'InProgress' &&
                    `импорт ${kzSatuSyncStatus.syncedProducts} из ${Math.max(kzSatuSyncStatus.totalProducts, kzSatuSyncStatus.syncedProducts)}`}
                  {kzSatuSyncStatus.status === 'Completed' &&
                    `в локальной базе ${kzSatuSyncStatus.localProductCount} товаров · обновлено ${formatAnalyticsDate(kzSatuSyncStatus.lastSyncCompletedAt ?? '')}`}
                  {kzSatuSyncStatus.status === 'Failed' &&
                    `ошибка: ${kzSatuSyncStatus.errorMessage ?? 'неизвестная ошибка'}`}
                  {kzSatuSyncStatus.status === 'NotStarted' &&
                    `локальный каталог: ${kzSatuSyncStatus.localProductCount} товаров. Импорт запустится автоматически.`}
                </div>
              )}

              {shopRegion === 'rf' && (
                <div className="inner-tabs products-inner-tabs">
                  <button
                    type="button"
                    className={productsInnerTab === 'catalog' ? 'active' : ''}
                    onClick={() => setProductsInnerTab('catalog')}
                  >
                    Каталог товаров
                  </button>
                  <button
                    type="button"
                    className={productsInnerTab === 'costTypes' ? 'active' : ''}
                    onClick={() => void openProductCostTypesTab()}
                  >
                    Типы себестоимости
                  </button>
                </div>
              )}

              {(shopRegion !== 'rf' || productsInnerTab === 'catalog') && (
              <>
              <div className="subtabs-placeholder products-toolbar">
                {user?.role === 'Admin' && (
                  <button
                    type="button"
                    onClick={() => {
                      if (shopRegion === 'rf') {
                        void loadOzonProducts()
                      } else if (kzMarketplace === 'satu') {
                        void triggerKzSatuSync(true)
                      } else {
                        void loadKzProducts()
                      }
                    }}
                  >
                    {shopRegion === 'rf'
                      ? 'Обновить товары Ozon'
                      : kzMarketplace === 'satu'
                        ? 'Синхронизировать SATU'
                        : `Обновить товары ${getKzMarketplaceLabel(kzMarketplace)}`}
                  </button>
                )}
                {shopRegion === 'kz' && kzMarketplace === 'satu' && (
                  <>
                    <button
                      type="button"
                      disabled={kzProductPage <= 0 || kzProductsLoading}
                      onClick={() => {
                        const nextPage = Math.max(0, kzProductPage - 1)
                        setKzProductPage(nextPage)
                        void loadKzProducts(kzMarketplace, false, productStatusFilter, null, productSearch, nextPage)
                      }}
                    >
                      Назад
                    </button>
                    <button
                      type="button"
                      disabled={!kzSatuHasNextPage || kzProductsLoading}
                      onClick={() => {
                        const nextPage = kzProductPage + 1
                        setKzProductPage(nextPage)
                        void loadKzProducts(kzMarketplace, false, productStatusFilter, null, productSearch, nextPage)
                      }}
                    >
                      Вперёд
                    </button>
                  </>
                )}
                {shopRegion === 'kz' && kzHasMoreProducts && (
                  <>
                    <button
                      type="button"
                      disabled={kzProductsLoading || kzProductsLoadingAll}
                      onClick={() => void loadKzProducts(kzMarketplace, true)}
                    >
                      {kzProductsLoading ? 'Загрузка...' : 'Загрузить ещё 200'}
                    </button>
                    <button
                      type="button"
                      disabled={kzProductsLoading || kzProductsLoadingAll}
                      onClick={() => void loadAllKzProducts(kzMarketplace)}
                    >
                      {kzProductsLoadingAll ? 'Загружаем все...' : 'Загрузить все'}
                    </button>
                  </>
                )}
                <input
                  className="toolbar-search"
                  placeholder="Поиск по артикулу, названию или SKU"
                  value={productSearch}
                  onChange={(event) => setProductSearch(event.target.value)}
                />
              </div>

              <div className="analytics-status-filters-bar products-status-filters-bar">
                <div className="analytics-status-filters">
                  {(
                    [
                      ['all', 'Все'],
                      ['selling', 'Продается'],
                      ['ready', 'Готов к продаже'],
                      ['archived', 'Архив'],
                    ] as const
                  ).map(([value, label]) => (
                    <button
                      type="button"
                      key={value}
                      className={productStatusFilter === value ? 'active' : ''}
                      onClick={() => setProductStatusFilter(value)}
                    >
                      {label}
                      <small>{productStatusCounts[value] ?? 0}</small>
                    </button>
                  ))}
                </div>
              </div>

              {catalogProductsStatus && (
                <div className="ozon-status">
                  <strong>{catalogProductsStatus}</strong>
                  <span>
                    Показано: {filteredCatalogProducts.length}
                    {productStatusFilter !== 'all' || productSearch.trim()
                      ? ` из ${shopRegion === 'kz' ? kzMatchedCatalogTotal || productStatusCounts.all : catalogProductsSource.length}`
                      : shopRegion === 'kz' && kzHasMoreProducts
                        ? ` (загружено ${catalogProductsSource.length}${kzMatchedCatalogTotal ? ` из ${kzMatchedCatalogTotal}` : '+'})`
                        : ''}
                  </span>
                </div>
              )}

              {shopRegion === 'kz' && kzHasMoreProducts && (
                <div className="subtabs-placeholder products-toolbar products-load-more-bar">
                  <button
                    type="button"
                    disabled={kzProductsLoading || kzProductsLoadingAll}
                    onClick={() => void loadKzProducts(kzMarketplace, true)}
                  >
                    {kzProductsLoading ? 'Загрузка...' : 'Загрузить ещё 200'}
                  </button>
                  <button
                    type="button"
                    disabled={kzProductsLoading || kzProductsLoadingAll}
                    onClick={() => void loadAllKzProducts(kzMarketplace)}
                  >
                    {kzProductsLoadingAll ? 'Загружаем все...' : 'Загрузить все'}
                  </button>
                </div>
              )}

              <div className="data-table">
                <div className="table-row ozon-product-row table-head">
                  <span>Товар</span>
                  <span>Артикул</span>
                  <span>Статус</span>
                  <span>Фото</span>
                  <span>Цена</span>
                  <span>Себестоимость</span>
                  <span>Ссылка</span>
                </div>
                {filteredCatalogProducts.map((item) => (
                  <div
                    className={`table-row ozon-product-row${shopRegion === 'rf' ? ' ozon-product-row-clickable' : ''}`}
                    key={item.productId}
                    role={shopRegion === 'rf' ? 'button' : undefined}
                    tabIndex={shopRegion === 'rf' ? 0 : undefined}
                    onClick={() => shopRegion === 'rf' && void openProductCostModal(item)}
                    onKeyDown={(event) => {
                      if (shopRegion === 'rf' && (event.key === 'Enter' || event.key === ' ')) {
                        event.preventDefault()
                        void openProductCostModal(item)
                      }
                    }}
                  >
                    <span data-label="Товар">
                      <strong>{item.name}</strong>
                      <small>{item.productId}</small>
                    </span>
                    <OfferIdCell offerId={item.offerId} />
                    <span data-label="Статус">{translateProductStatus(item.status)}</span>
                    <span data-label="Фото">
                      {item.imageUrl ? (
                        <ProductImageHoverPreview imageUrl={item.imageUrl} name={item.name}>
                          <ProductThumb imageUrl={item.imageUrl} name={item.name} />
                        </ProductImageHoverPreview>
                      ) : (
                        '-'
                      )}
                    </span>
                    <span data-label="Цена">{formatMoney(item.price, item.currencyCode)}</span>
                    <span data-label="Себестоимость">
                      {item.costTotal ? formatMoney(item.costTotal, item.currencyCode || 'KZT') : '-'}
                    </span>
                    <span data-label="Ссылка">
                      {item.productUrl ? (
                        <a href={item.productUrl} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
                          Открыть
                        </a>
                      ) : (
                        item.status
                      )}
                    </span>
                  </div>
                ))}
              </div>
              </>
              )}

              {shopRegion === 'rf' && productsInnerTab === 'costTypes' && (() => {
                const profilesByType = new Map<string, ProductCostProfile[]>()
                productCostProfiles.forEach((profile) => {
                  if (!profile.costTypeId || profile.useIndividualCost) {
                    return
                  }
                  const current = profilesByType.get(profile.costTypeId) ?? []
                  current.push(profile)
                  profilesByType.set(profile.costTypeId, current)
                })

                return (
                  <div className="product-cost-types-panel">
                    <div className="product-cost-types-card">
                      <div className="product-cost-types-head">
                        <div>
                          <h3>Типы себестоимости</h3>
                          <p>Настройте общую себестоимость для группы товаров и смотрите, какие товары ее используют.</p>
                        </div>
                        <button type="button" onClick={() => void openProductCostTypesTab()}>
                          Обновить
                        </button>
                      </div>

                      <div className="product-cost-type-form product-cost-type-page-form">
                        <label className="product-cost-field">
                          <span>Название типа</span>
                          <input
                            value={productCostTypeForm.name}
                            onChange={(event) => setProductCostTypeForm((current) => ({ ...current, name: event.target.value }))}
                            placeholder="Например: магнит, значок, кружка"
                          />
                        </label>
                        <label className="product-cost-purchase-toggle product-cost-type-toggle">
                          <input
                            type="checkbox"
                            checked={productCostTypeForm.isPurchased}
                            onChange={(event) =>
                              setProductCostTypeForm((current) => ({ ...current, isPurchased: event.target.checked }))
                            }
                          />
                          Закупной
                        </label>
                        {productCostTypeForm.isPurchased ? (
                          <label className="product-cost-field">
                            <span>Себестоимость</span>
                            <input
                              inputMode="decimal"
                              value={productCostTypeForm.purchaseCost}
                              onChange={(event) =>
                                setProductCostTypeForm((current) => ({ ...current, purchaseCost: event.target.value }))
                              }
                              placeholder="Например: 450"
                            />
                          </label>
                        ) : (
                          <>
                            <label className="product-cost-field">
                              <span>Упаковка</span>
                              <input
                                inputMode="decimal"
                                value={productCostTypeForm.packagingCost}
                                onChange={(event) =>
                                  setProductCostTypeForm((current) => ({ ...current, packagingCost: event.target.value }))
                                }
                                placeholder="0"
                              />
                            </label>
                            <label className="product-cost-field">
                              <span>Производство</span>
                              <input
                                inputMode="decimal"
                                value={productCostTypeForm.productionCost}
                                onChange={(event) =>
                                  setProductCostTypeForm((current) => ({ ...current, productionCost: event.target.value }))
                                }
                                placeholder="0"
                              />
                            </label>
                          </>
                        )}
                        <button type="button" disabled={productCostTypeSaving} onClick={() => void saveProductCostType()}>
                          Добавить тип
                        </button>
                      </div>
                    </div>

                    {(productCostTypesStatus || productCostStatus) && (
                      <p className="product-cost-status">{productCostTypesStatus || productCostStatus}</p>
                    )}

                    <div className="data-table product-cost-types-table">
                      <div className="table-row product-cost-type-row table-head">
                        <span>Тип</span>
                        <span>Формат</span>
                        <span>Упаковка</span>
                        <span>Производство</span>
                        <span>Себестоимость</span>
                        <span>Товаров</span>
                        <span>Действия</span>
                      </div>
                      {productCostTypes.length === 0 ? (
                        <div className="empty-row">Типов себестоимости пока нет.</div>
                      ) : (
                        productCostTypes.map((costType) => {
                          const linkedProfiles = (profilesByType.get(costType.id) ?? []).sort((a, b) =>
                            (a.productName || a.offerId).localeCompare(b.productName || b.offerId),
                          )
                          const isExpanded = expandedProductCostTypeId === costType.id
                          return (
                            <div className="product-cost-type-entry" key={costType.id}>
                              <div className="table-row product-cost-type-row">
                                <span data-label="Тип">
                                  <strong>{costType.name}</strong>
                                </span>
                                <span data-label="Формат">{costType.isPurchased ? 'Закупной' : 'Производственный'}</span>
                                <span data-label="Упаковка">
                                  {costType.isPurchased ? '-' : formatMoney(costType.packagingCost ?? 0, 'KZT')}
                                </span>
                                <span data-label="Производство">
                                  {costType.isPurchased ? '-' : formatMoney(costType.productionCost ?? 0, 'KZT')}
                                </span>
                                <span data-label="Себестоимость">
                                  <strong>{costType.costTotal ? formatMoney(costType.costTotal, 'KZT') : '-'}</strong>
                                </span>
                                <span data-label="Товаров">{linkedProfiles.length}</span>
                                <span data-label="Действия" className="product-cost-type-actions">
                                  <button type="button" onClick={() => openProductCostTypeEditModal(costType)}>
                                    Изменить
                                  </button>
                                  <button type="button" className="secondary" onClick={() => setExpandedProductCostTypeId(isExpanded ? null : costType.id)}>
                                    {isExpanded ? 'Скрыть товары' : 'Показать товары'}
                                  </button>
                                </span>
                              </div>
                              {isExpanded && (
                                <div className="product-cost-type-products">
                                  {linkedProfiles.length === 0 ? (
                                    <p>К этому типу пока не привязан ни один товар.</p>
                                  ) : (
                                    linkedProfiles.map((profile) => {
                                      const product = ozonProducts.find(
                                        (item) => item.productId === profile.productId || item.offerId === profile.offerId,
                                      )
                                      return (
                                        <div className="product-cost-type-product-row" key={`${profile.productId}-${profile.offerId}`}>
                                          <span data-label="Фото">
                                            {product?.imageUrl ? (
                                              <ProductImageHoverPreview imageUrl={product.imageUrl} name={product.name}>
                                                <ProductThumb imageUrl={product.imageUrl} name={product.name} />
                                              </ProductImageHoverPreview>
                                            ) : (
                                              <span className="product-thumb-placeholder">Фото</span>
                                            )}
                                          </span>
                                          <span data-label="Товар">
                                            <strong>{profile.productName || product?.name || profile.offerId || profile.productId}</strong>
                                            <small>{profile.productId}</small>
                                          </span>
                                          <OfferIdCell offerId={profile.offerId || product?.offerId || '-'} />
                                          <span data-label="Себестоимость">
                                            {profile.costTotal ? formatMoney(profile.costTotal, product?.currencyCode || 'KZT') : '-'}
                                          </span>
                                        </div>
                                      )
                                    })
                                  )}
                                </div>
                              )}
                            </div>
                          )
                        })
                      )}
                    </div>
                  </div>
                )
              })()}
            </section>
          )}

          {activeTab === 'analytics' && (
            <section className="tab-panel">
              <div className="section-title">
                <h2>Аналитика</h2>
                <p>
                  {shopRegion === 'rf'
                    ? analyticsStatus || 'Продажи и выручка из Ozon API'
                    : analyticsStatus || `Аналитика ${getKzMarketplaceLabel(kzMarketplace)}`}
                </p>
              </div>
              {shopRegion === 'kz' && (
                <KzMarketplaceTabs activeMarketplace={kzMarketplace} onChange={handleKzMarketplaceChange} />
              )}
              <div className="inner-tabs">
                {hasFeature('analytics.summary') && (
                <button
                  type="button"
                  className={analyticsSubTab === 'summary' ? 'active' : ''}
                  onClick={() => setAnalyticsSubTab('summary')}
                >
                  Общая аналитика
                </button>
                )}
                {hasFeature('analytics.topProducts') && (
                <button
                  type="button"
                  className={analyticsSubTab === 'topProducts' ? 'active' : ''}
                  onClick={() => setAnalyticsSubTab('topProducts')}
                >
                  Топ товары
                </button>
                )}
                {hasFeature('analytics.noSales') && (
                <button
                  type="button"
                  className={analyticsSubTab === 'noSales' ? 'active' : ''}
                  onClick={() => setAnalyticsSubTab('noSales')}
                >
                  Без продаж
                </button>
                )}
                {hasFeature('analytics.production') && (
                <button
                  type="button"
                  className={analyticsSubTab === 'production' ? 'active' : ''}
                  onClick={() => setAnalyticsSubTab('production')}
                >
                  Производство
                </button>
                )}
                {hasFeature('analytics.internal') && (
                <button
                  type="button"
                  className={analyticsSubTab === 'internal' ? 'active' : ''}
                  onClick={() => setAnalyticsSubTab('internal')}
                >
                  Внутренняя
                </button>
                )}
                {hasFeature('analytics.calculator') && (
                <button
                  type="button"
                  className={analyticsSubTab === 'calculator' ? 'active' : ''}
                  onClick={() => setAnalyticsSubTab('calculator')}
                >
                  Калькулятор
                </button>
                )}
                {hasFeature('analytics.finances') && (
                <button
                  type="button"
                  className={analyticsSubTab === 'finances' ? 'active' : ''}
                  onClick={() => setAnalyticsSubTab('finances')}
                >
                  Финансы
                </button>
                )}
              </div>
              <div className="subtabs-placeholder analytics-toolbar">
                {(((analyticsSubTab === 'summary' || analyticsSubTab === 'topProducts') && showFullAnalytics) ||
                  analyticsSubTab === 'internal' ||
                  analyticsSubTab === 'finances') && (
                  <div className="date-filter">
                    <label>
                      <span>С</span>
                      <input
                        type="date"
                        value={analyticsDateFrom}
                        onChange={(event) => setAnalyticsDateFrom(event.target.value)}
                      />
                    </label>
                    <label>
                      <span>По</span>
                      <input
                        type="date"
                        value={analyticsDateTo}
                        onChange={(event) => setAnalyticsDateTo(event.target.value)}
                      />
                    </label>
                    <button
                      type="button"
                      className="date-filter-preset"
                      onClick={() => {
                        setAnalyticsDateFrom(ALL_PERIOD_START)
                        setAnalyticsDateTo(new Date().toISOString().slice(0, 10))
                      }}
                    >
                      За весь период
                    </button>
                  </div>
                )}
                {analyticsSubTab === 'production' && (
                  <div className="date-filter production-analytics-filters">
                    <label>
                      <span>С</span>
                      <input
                        type="date"
                        value={productionAnalyticsDateFrom}
                        onChange={(event) => setProductionAnalyticsDateFrom(event.target.value)}
                      />
                    </label>
                    <label>
                      <span>По</span>
                      <input
                        type="date"
                        value={productionAnalyticsDateTo}
                        onChange={(event) => setProductionAnalyticsDateTo(event.target.value)}
                      />
                    </label>
                    <label>
                      <span>Исполнитель</span>
                      <select
                        value={productionAnalyticsUserId}
                        onChange={(event) => setProductionAnalyticsUserId(event.target.value)}
                      >
                        <option value="">Все пользователи</option>
                        {productionAnalyticsAssignees.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.displayName || item.userName} ({getRoleLabel(item.role)})
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                )}
                <div className="analytics-toolbar-actions">
                  <button type="button" onClick={() => void refreshAnalytics()}>
                    {analyticsSubTab === 'production'
                      ? 'Обновить отчёт'
                      : analyticsSubTab === 'internal'
                        ? 'Обновить данные'
                        : 'Обновить аналитику'}
                  </button>
                  {analyticsSubTab === 'production' && (
                    <button
                      type="button"
                      className="analytics-export-button"
                      onClick={() => void exportProductionAnalyticsExcel()}
                    >
                      Excel
                    </button>
                  )}
                </div>
              </div>
              {productionAnalyticsStatus && analyticsSubTab === 'production' && (
                <p className="analytics-status-line">{productionAnalyticsStatus}</p>
              )}
              {analyticsSubTab === 'summary' && showFullAnalytics && (
                <>
                  <AnalyticsPipelineBoard
                    snapshot={analyticsSnapshot}
                    analytics={filteredAnalytics}
                    marketplaceLabel={analyticsMarketplaceLabel}
                  />
                  <div className="analytics-table-toolbar">
                    <input
                      className="toolbar-search"
                      placeholder="Поиск по товару, артикулу или SKU"
                      value={analyticsRowSearch}
                      onChange={(event) => setAnalyticsRowSearch(event.target.value)}
                    />
                    <span className="analytics-table-meta">
                      {filteredGroupedAnalyticsProducts.length} товаров · {filteredAnalyticsOrderRows.length} заказов
                      {analyticsRowSearch.trim() || analyticsStatusFilter !== 'all'
                        ? ` из ${groupedAnalyticsProducts.length}`
                        : ''}
                    </span>
                  </div>
                  <div className="analytics-status-filters-bar">
                    <div className="analytics-status-filters">
                      {(
                        [
                          ['all', 'Все'],
                          ['awaiting_deliver', 'Собираются'],
                          ['delivering', 'Едут'],
                          ['delivered', 'Доставлены'],
                          ['cancelled', 'Отменены'],
                        ] as const
                      ).map(([value, label]) => (
                        <button
                          type="button"
                          key={value}
                          className={analyticsStatusFilter === value ? 'active' : ''}
                          onClick={() => setAnalyticsStatusFilter(value)}
                        >
                          {label}
                          <small>{analyticsStatusCounts[value] ?? 0}</small>
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      className="analytics-export-button"
                      title="Выгрузить Excel по выбранному фильтру"
                      onClick={exportCurrentAnalyticsExcel}
                    >
                      Excel
                    </button>
                  </div>
                  <div className="analytics-products-list">
                    {filteredGroupedAnalyticsProducts.map((group) => (
                      <AnalyticsProductGroupCard
                        key={group.key}
                        group={group}
                        imageUrl={getAnalyticsProductImageUrl(analyticsProductImages, group)}
                        expanded={expandedAnalyticsProductKeys[group.key] ?? false}
                        onToggle={() =>
                          setExpandedAnalyticsProductKeys((current) => ({
                            ...current,
                            [group.key]: !current[group.key],
                          }))
                        }
                        onExport={() => exportAnalyticsProductExcel(group)}
                      />
                    ))}
                    {filteredGroupedAnalyticsProducts.length === 0 && (
                      <div className="empty-state">
                        <strong>
                          {analyticsRowSearch.trim() || analyticsStatusFilter !== 'all'
                            ? 'По вашему запросу ничего не найдено.'
                            : 'Данных по заказам пока нет.'}
                        </strong>
                      </div>
                    )}
                  </div>
                </>
              )}
              {analyticsSubTab === 'summary' && shopRegion === 'kz' && !showKzFullAnalytics && (
                <div className="empty-state">
                  <strong>Аналитика {getKzMarketplaceLabel(kzMarketplace)}</strong>
                  <span>Полная аналитика пока доступна только для Satu.</span>
                </div>
              )}
              {analyticsSubTab === 'internal' && shopRegion === 'rf' && (
                <InternalAnalyticsPanel data={internalAnalytics} />
              )}
              {analyticsSubTab === 'internal' && shopRegion === 'kz' && (
                <div className="empty-state">
                  <strong>Внутренняя аналитика</strong>
                  <span>Склад по себестоимости сейчас считается для Ozon в LShop РФ.</span>
                </div>
              )}
              {analyticsSubTab === 'topProducts' && showFullAnalytics && (
                <>
                  <div className="ozon-status">
                    <strong>Все продажи без фильтра по статусу доставки</strong>
                    <span>Сортировка по количеству заказов</span>
                  </div>
                  <div className="data-table">
                    <div className="table-row top-products-row table-head">
                      <span>Место</span>
                      <span>Товар</span>
                      <span>Артикул</span>
                      <span>SKU</span>
                      <span>Заказано</span>
                      <span>Остаток</span>
                      <span>Сумма заказов</span>
                    </div>
                    {topAnalyticsProducts.map((row, index) => {
                      const imageUrl = getAnalyticsProductImageUrl(analyticsProductImages, row)

                      return (
                      <div className="table-row top-products-row" key={row.key}>
                        <span>{index + 1}</span>
                        <span className="unsold-product-name">
                          {imageUrl ? (
                            <ProductImageHoverPreview imageUrl={imageUrl} name={row.productName}>
                              <ProductThumb imageUrl={imageUrl} name={row.productName} />
                            </ProductImageHoverPreview>
                          ) : (
                            <ProductThumb name={row.productName} />
                          )}
                          <strong>{row.productName}</strong>
                        </span>
                        <OfferIdCell offerId={row.offerId} />
                        <span>{row.sku || '-'}</span>
                        <span>{row.quantity}</span>
                        <span>{row.stockTotal}</span>
                        <span>{formatMoney(row.revenue, row.currencyCode)}</span>
                      </div>
                      )
                    })}
                    {topAnalyticsProducts.length === 0 && (
                      <div className="empty-state">
                        <strong>Заказанных товаров пока нет.</strong>
                      </div>
                    )}
                  </div>
                </>
              )}
              {analyticsSubTab === 'topProducts' && shopRegion === 'kz' && !showKzFullAnalytics && (
                <div className="empty-state">
                  <strong>Топ товаров {getKzMarketplaceLabel(kzMarketplace)}</strong>
                  <span>Полная аналитика пока доступна только для Satu.</span>
                </div>
              )}
              {analyticsSubTab === 'noSales' && showFullAnalytics && (
                <>
                  <div className="ozon-status">
                    <strong>Товары без продаж после отгрузки</strong>
                    <span>
                      Каталог {analyticsMarketplaceLabel} без продаж с момента отгрузки
                      {shopRegion === 'rf'
                        ? ' · дата и дни считаются от последней отгрузки Ozon'
                        : ''}
                      {shopRegion === 'rf' && rfUnsoldTimestamp ? ` · обновлено ${rfUnsoldTimestamp}` : ''}
                      {' · '}
                      найдено: {filteredUnsoldAnalyticsProducts.length}
                      {unsoldProductStatusFilter !== 'all'
                        ? ` из ${showKzFullAnalytics ? kzUnsoldTotal : unsoldAnalyticsProducts.length}`
                        : showKzFullAnalytics && kzUnsoldTotal > unsoldAnalyticsProducts.length
                          ? ` (показано ${unsoldAnalyticsProducts.length} из ${kzUnsoldTotal})`
                          : ''}
                    </span>
                  </div>
                  <div className="analytics-status-filters-bar unsold-status-filters-bar">
                    <div className="analytics-status-filters">
                      {(
                        [
                          ['all', 'Все'],
                          ['selling', 'Продается'],
                          ['ready', 'Готов к продаже'],
                        ] as const
                      ).map(([value, label]) => (
                        <button
                          type="button"
                          key={value}
                          className={unsoldProductStatusFilter === value ? 'active' : ''}
                          onClick={() => setUnsoldProductStatusFilter(value)}
                        >
                          {label}
                          <small>{unsoldProductStatusCounts[value] ?? 0}</small>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="data-table">
                    <div className="table-row unsold-products-row table-head">
                      <span>Товар</span>
                      <span>Артикул</span>
                      <span>SKU</span>
                      <span>Дата отгрузки</span>
                      <span>Дней без продаж</span>
                      <span>Статус</span>
                      <span>Остаток</span>
                      <span>Цена</span>
                    </div>
                    {filteredUnsoldAnalyticsProducts.map((row) => (
                      <div className="table-row unsold-products-row" key={row.key}>
                        <span className="unsold-product-name">
                          {row.imageUrl ? (
                            <ProductImageHoverPreview imageUrl={row.imageUrl} name={row.productName}>
                              <ProductThumb imageUrl={row.imageUrl} name={row.productName} />
                            </ProductImageHoverPreview>
                          ) : (
                            <ProductThumb name={row.productName} />
                          )}
                          <strong>{row.productName}</strong>
                        </span>
                        <OfferIdCell offerId={row.offerId} />
                        <span>{row.sku || '-'}</span>
                        <span>{formatOzonCreatedAt(row.ozonSellingSince)}</span>
                        <span>{formatDaysWithoutSales(undefined, row.ozonSellingSince)}</span>
                        <span>{translateProductStatus(row.status)}</span>
                        <span>{row.stockTotal}</span>
                        <span>{formatMoney(row.price, row.currencyCode)}</span>
                      </div>
                    ))}
                    {filteredUnsoldAnalyticsProducts.length === 0 && (
                      <div className="empty-state">
                        <strong>
                          {unsoldAnalyticsProducts.length === 0
                            ? 'Все товары из каталога уже имели продажи.'
                            : 'Нет товаров с выбранным статусом.'}
                        </strong>
                      </div>
                    )}
                  </div>
                </>
              )}
              {analyticsSubTab === 'noSales' && shopRegion === 'kz' && !showKzFullAnalytics && (
                <div className="empty-state">
                  <strong>Без продаж · {getKzMarketplaceLabel(kzMarketplace)}</strong>
                  <span>Полная аналитика пока доступна только для Satu.</span>
                </div>
              )}
              {analyticsSubTab === 'production' && hasFeature('analytics.production') && (
                <>
                  <div className="production-analytics-board">
                    <div className="production-analytics-board-head">
                      <div>
                        <strong>Выполненные задачи</strong>
                        <span>
                          {productionAnalyticsDateFrom} — {productionAnalyticsDateTo}
                          {productionAnalyticsUserId
                            ? ` · ${productionAnalyticsAssignees.find((entry) => entry.id === productionAnalyticsUserId)?.displayName ?? 'Пользователь'}`
                            : ' · все исполнители'}
                        </span>
                      </div>
                    </div>
                    <div className="production-analytics-sections-grid">
                  {(['designer', 'production'] as const).map((section) => {
                    const sectionTitle = section === 'designer' ? 'Дизайнеры' : 'Производство'
                    const sectionRows = (visibleProductionAnalyticsReport?.summary ?? []).filter((row) =>
                      section === 'designer'
                        ? row.role === 'Designer'
                        : row.role !== 'Designer',
                    )

                    return (
                      <section className="production-analytics-section" key={section}>
                        <h3 className="production-analytics-section-title">{sectionTitle}</h3>
                        {sectionRows.length === 0 ? (
                          <div className="production-analytics-empty">
                            За выбранный период выполненных задач нет.
                          </div>
                        ) : (
                          <div className="production-analytics-cards">
                          {sectionRows.map((row) => {
                            const userKey = `${section}-${row.userName}`
                            const userTasks = (visibleProductionAnalyticsReport?.tasks ?? []).filter(
                              (task) => (task.assignedUserName || '—') === row.userName,
                            )

                            return (
                              <ProductionAnalyticsUserCard
                                key={userKey}
                                row={row}
                                tasks={userTasks}
                                productionFilePaths={productionFilePaths}
                                isExpanded={productionAnalyticsExpandedUserKey === userKey}
                                expandedTaskId={productionAnalyticsExpandedTaskId}
                                isAdmin={user?.role === 'Admin'}
                                onToggleDetails={() => {
                                  if (productionAnalyticsExpandedUserKey === userKey) {
                                    setProductionAnalyticsExpandedUserKey(null)
                                    setProductionAnalyticsExpandedTaskId(null)
                                    return
                                  }

                                  setProductionAnalyticsExpandedUserKey(userKey)
                                  setProductionAnalyticsExpandedTaskId(null)
                                }}
                                onToggleTask={(taskId) => {
                                  setProductionAnalyticsExpandedTaskId((current) =>
                                    current === taskId ? null : taskId,
                                  )
                                }}
                                onExportExcel={(userId) => void exportProductionAnalyticsExcel(userId)}
                                onEditTask={(task) => setProductionAnalyticsEditingTask(task)}
                              />
                            )
                          })}
                          </div>
                        )}
                      </section>
                    )
                  })}
                    </div>
                    <section className="production-analytics-tasks-block">
                      <div className="production-analytics-tasks-block-head">
                        <h3>Позиции задач</h3>
                        <span>{visibleProductionAnalyticsReport?.tasks.length ?? 0} задач за период</span>
                      </div>
                  <div className="production-analytics-tasks-table">
                    <div
                      className={`production-analytics-task-row production-analytics-task-row-head${user?.role === 'Admin' ? ' with-actions' : ''}`}
                    >
                      <span>Завершена</span>
                      <span>Исполнитель</span>
                      <span>Тип</span>
                      <span>Товар</span>
                      <span>Артикул</span>
                      <span>План</span>
                      <span>Факт</span>
                      {user?.role === 'Admin' && <span>Действия</span>}
                    </div>
                    {(visibleProductionAnalyticsReport?.tasks ?? []).flatMap((task) => {
                      const items = getProductionTaskItems(task)
                      return items.map((item) => (
                        <div
                          className={`production-analytics-task-row${user?.role === 'Admin' ? ' with-actions' : ''}`}
                          key={`${task.id}-${item.id ?? item.offerId}`}
                        >
                          <span>{task.completedAt ? formatDateTime(task.completedAt) : '—'}</span>
                          <span>{task.assignedUserName || '—'}</span>
                          <span>{getProductionTaskTypeLabel(task)}</span>
                          <span>{item.productName}</span>
                          <OfferIdCell offerId={item.offerId} />
                          <span>{item.requiredQuantity}</span>
                          <span>{item.actualQuantity ?? 0}</span>
                          {user?.role === 'Admin' && (
                            <span className="production-analytics-row-actions">
                                <button
                                  type="button"
                                  className="text-action-button"
                                  onClick={() => setProductionAnalyticsEditingTask(task)}
                                >
                                  Изменить
                                </button>
                            </span>
                          )}
                        </div>
                      ))
                    })}
                    {(visibleProductionAnalyticsReport?.tasks.length ?? 0) === 0 && (
                      <div className="production-analytics-empty">
                        Нет задач для отображения.
                      </div>
                    )}
                  </div>
                    </section>
                  </div>
                  {productionAnalyticsEditingTask && (
                    <ProductionAnalyticsRecordEditModal
                      task={productionAnalyticsEditingTask}
                      assignees={productionAnalyticsAssignees}
                      onClose={() => setProductionAnalyticsEditingTask(null)}
                      onSave={saveProductionAnalyticsRecord}
                    />
                  )}
                </>
              )}

              {analyticsSubTab === 'calculator' && hasFeature('analytics.calculator') && (
                <CalculatorPanel token={token} canEdit={hasFeature('analytics.calculator.edit')} />
              )}

              {analyticsSubTab === 'finances' && hasFeature('analytics.finances') && (
                <FinancesPanel token={token} dateFrom={analyticsDateFrom} dateTo={analyticsDateTo} />
              )}
            </section>
          )}

          {activeTab === 'pooling' && hasFeature('pooling') && (
            <section className="tab-panel">
              <div className="section-title">
                <h2>Склад</h2>
                <p>
                  {priceStatus ||
                    catalogStocksStatus ||
                    (shopRegion === 'rf'
                      ? 'Остатки товаров на складе Ozon'
                      : `Остатки товаров ${getKzMarketplaceLabel(kzMarketplace)}`)}
                </p>
              </div>
              {shopRegion === 'kz' && (
                <KzMarketplaceTabs activeMarketplace={kzMarketplace} onChange={handleKzMarketplaceChange} />
              )}
              <div className="subtabs-placeholder">
                <button
                  type="button"
                  onClick={() => (shopRegion === 'rf' ? void loadOzonStocks() : void loadKzStocks())}
                >
                  {shopRegion === 'rf'
                    ? 'Обновить остатки Ozon'
                    : `Обновить остатки ${getKzMarketplaceLabel(kzMarketplace)}`}
                </button>
                <input
                  className="toolbar-search"
                  placeholder="Поиск по товару, артикулу или цене"
                  value={stockSearch}
                  onChange={(event) => setStockSearch(event.target.value)}
                />
                <span className="sort-actions stock-sort-actions">
                  <button
                    type="button"
                    className={stockSortDirection === 'desc' ? 'active' : ''}
                    onClick={() => setStockSortDirection('desc')}
                  >
                    По убыванию
                  </button>
                  <button
                    type="button"
                    className={stockSortDirection === 'asc' ? 'active' : ''}
                    onClick={() => setStockSortDirection('asc')}
                  >
                    По возрастанию
                  </button>
                  <button
                    type="button"
                    className={stockSortDirection === null ? 'active' : ''}
                    onClick={() => setStockSortDirection(null)}
                  >
                    По артикулу
                  </button>
                </span>
              </div>
              <div className="data-table stock-table">
                <div className={`table-row stock-row table-head ${canEditPoolingPrices() ? '' : 'stock-row-readonly'}`}>
                  <span>Товар</span>
                  <span>Артикул</span>
                  <span>FBO</span>
                  <span>FBS</span>
                  <span>Цена</span>
                  {canEditPoolingPrices() && <span>Действие</span>}
                </div>
                {sortedOzonStocks.map((item) => (
                  <StockRow
                    item={item}
                    key={item.productId}
                    priceValue={editingPrices[item.productId] ?? String(item.price)}
                    onPriceChange={(value) =>
                      setEditingPrices((current) => ({ ...current, [item.productId]: value }))
                    }
                    onSave={() => updateOzonPrice(item)}
                    canEditPrice={canEditPoolingPrices()}
                  />
                ))}
              </div>
            </section>
          )}

          {activeTab === 'supplies' && shopRegion === 'rf' && (
            <section className="tab-panel">
              <div className="section-title">
                <div>
                  <h2>Поставки</h2>
                  <p>{supplyStatus || 'Создание, статусы и аналитика поставок'}</p>
                </div>
                {hasSubFeature('supplies.archive', 'supplies') && (
                  <button
                    type="button"
                    className="header-action"
                    onClick={() => setSupplySubTab('archive')}
                  >
                    Архив поставок
                  </button>
                )}
              </div>

              <div className="inner-tabs">
                <button
                  type="button"
                  className={supplySubTab === 'create' ? 'active' : ''}
                  onClick={() => setSupplySubTab('create')}
                  hidden={!hasSubFeature('supplies.create', 'supplies')}
                >
                  Создать
                </button>
                {hasSubFeature('supplies.editor', 'supplies') && (
                  <button
                    type="button"
                    className={supplySubTab === 'editor' ? 'active' : ''}
                    onClick={() => {
                      markSupplyNotificationsSeen(createdSupplies.map((supply) => supply.id))
                      setSupplySubTab('editor')
                    }}
                  >
                    Редактор поставок
                    {renderTabBadge(unseenCreatedSupplies.length)}
                  </button>
                )}
                <button
                  type="button"
                  className={supplySubTab === 'all' ? 'active' : ''}
                  onClick={() => {
                    markSupplyNotificationsSeen(allActiveSupplies.map((supply) => supply.id))
                    setSupplySubTab('all')
                  }}
                  hidden={!hasSubFeature('supplies.all', 'supplies')}
                >
                  Все поставки
                  {renderTabBadge(unseenSupplies.length)}
                </button>
                {hasSubFeature('supplies.analytics', 'supplies') && (
                  <button
                    type="button"
                    className={supplySubTab === 'analytics' ? 'active' : ''}
                    onClick={() => {
                      markSupplyAnalyticsSeen(supplyAnalytics.map((item) => getSupplyAnalyticsRowKey(item)))
                      setSupplySubTab('analytics')
                    }}
                  >
                    Аналитика поставок
                    {renderTabBadge(unseenSupplyAnalytics.length)}
                  </button>
                )}
                {hasSubFeature('supplies.expenses', 'supplies') && (
                  <button
                    type="button"
                    className={supplySubTab === 'expenses' ? 'active' : ''}
                    onClick={() => setSupplySubTab('expenses')}
                  >
                    Расходники
                  </button>
                )}
              </div>

              {supplySubTab !== 'expenses' && (
                <div className="toolbar-row">
                  <input
                    className="toolbar-search"
                    placeholder="Поиск по поставкам, товарам, артикулам"
                    value={supplySearch}
                    onChange={(event) => setSupplySearch(event.target.value)}
                  />
                  {supplySubTab === 'all' && (
                    <select
                      className="toolbar-select"
                      value={supplyStatusFilter}
                      onChange={(event) =>
                        setSupplyStatusFilter(event.target.value as 'all' | SupplyStatus)
                      }
                    >
                      <option value="all">Все статусы</option>
                      <option value="Created">Создано</option>
                      <option value="Sent">Отправлено</option>
                      <option value="Accepted">Принято</option>
                    </select>
                  )}
                </div>
              )}

              {supplySubTab === 'create' && (
                <>
                  <div className="supply-create-bar">
                    <button type="button" onClick={() => setShowCreateSupplyModal(true)}>
                      Создать
                    </button>
                    {user?.role === 'Admin' && (
                      <>
                      <button type="button" onClick={downloadSupplyTemplate}>
                        Скачать Excel-шаблон
                      </button>
                      <input
                        type="file"
                        accept=".xlsx"
                        onChange={(event) => setSupplyImportFile(event.target.files?.[0] ?? null)}
                      />
                      <button type="button" onClick={uploadSupplyExcel}>
                        Загрузить Excel
                      </button>
                      </>
                    )}
                      <button type="button" onClick={() => setShowSupplyHelp(true)}>
                        Справка создать поставку
                      </button>
                  </div>

                  {showSupplyHelp && (
                    <div className="modal-backdrop" role="presentation">
                      <div className="modal-card" role="dialog" aria-modal="true">
                        <h3>Создание поставки</h3>
                        <p>
                          Добавьте товары из списка Ozon или новые товары, если товара еще
                          нет в продаже. После сохранения поставка появится в статусе "Создано";
                          статус "Отправлено" ставится отдельно.
                        </p>
                        <button type="button" onClick={() => setShowSupplyHelp(false)}>
                          Понятно
                        </button>
                      </div>
                    </div>
                  )}

                  {showCreateSupplyModal && (
                    <SupplyItemsModal
                      title="Создать поставку"
                      listIdPrefix="supply-products"
                      token={token}
                      ozonProducts={productionLookupProducts}
                      novinkaProducts={supplyPackedCatalogItems}
                      items={draftSupplyItems}
                      setItems={setDraftSupplyItems}
                      productId={supplyProductId}
                      setProductId={setSupplyProductId}
                      quantity={supplyQuantity}
                      setQuantity={setSupplyQuantity}
                      selectedNovinkaOfferId={selectedNovinkaOfferId}
                      setSelectedNovinkaOfferId={setSelectedNovinkaOfferId}
                      reserveQuantity={reserveQuantity}
                      setReserveQuantity={setReserveQuantity}
                      materialName={supplyMaterialName}
                      setMaterialName={setSupplyMaterialName}
                      materialQuantity={supplyMaterialQuantity}
                      setMaterialQuantity={setSupplyMaterialQuantity}
                      materialKind={supplyMaterialKind}
                      setMaterialKind={setSupplyMaterialKind}
                      onAddProduct={addSupplyProduct}
                      onAddReserve={addReserveSupplyProduct}
                      onAddMaterial={addSupplyMaterialItem}
                      onSave={createSupply}
                      onClose={() => setShowCreateSupplyModal(false)}
                    />
                  )}

                  <SupplyTable
                    supplies={createdSupplies}
                    ozonProducts={productionLookupProducts}
                    replaceProducts={replaceProducts}
                    setReplaceProducts={setReplaceProducts}
                    editingSupplyId={editingSupplyId}
                    onStartEdit={startEditSupply}
                    onDeleteSupply={deleteSupply}
                    onArchiveSupply={archiveSupply}
                    onStatusChange={updateSupplyStatus}
                    onRequestSent={openShippingCostModal}
                    onUpdateDates={updateSupplyDates}
                    onReplaceReserve={replaceReserveItem}
                    userRole={user?.role}
                  />
                </>
              )}

              {supplySubTab === 'editor' && (
                <SupplyTable
                  supplies={editableSupplies}
                  ozonProducts={ozonProducts}
                  replaceProducts={replaceProducts}
                  setReplaceProducts={setReplaceProducts}
                  editingSupplyId={editingSupplyId}
                  onStartEdit={startEditSupply}
                  onDeleteSupply={deleteSupply}
                  onArchiveSupply={archiveSupply}
                  onStatusChange={updateSupplyStatus}
                  onRequestSent={openShippingCostModal}
                  onUpdateDates={updateSupplyDates}
                  onReplaceReserve={replaceReserveItem}
                  userRole={user?.role}
                  collapsible
                />
              )}

              {supplySubTab === 'all' && <AllSuppliesTable supplies={visibleAllSupplies} />}

              {supplySubTab === 'archive' && user?.role === 'Admin' && (
                <SupplyTable
                  supplies={archivedSupplies}
                  ozonProducts={ozonProducts}
                  replaceProducts={replaceProducts}
                  setReplaceProducts={setReplaceProducts}
                  editingSupplyId={editingSupplyId}
                  onStartEdit={startEditSupply}
                  onDeleteSupply={deleteSupply}
                  onArchiveSupply={archiveSupply}
                  onStatusChange={updateSupplyStatus}
                  onRequestSent={openShippingCostModal}
                  onUpdateDates={updateSupplyDates}
                  onReplaceReserve={replaceReserveItem}
                  userRole={user?.role}
                  archiveMode
                />
              )}

              {supplySubTab === 'expenses' && (
                <div className="supply-expenses-panel">
                  <div className="supply-expense-create">
                    <label>
                      Что купили
                      <input
                        value={supplyExpenseName}
                        onChange={(event) => setSupplyExpenseName(event.target.value)}
                        placeholder="Например: пакетики, бумага, скотч"
                      />
                    </label>
                    <label>
                      Сумма покупки
                      <input
                        inputMode="decimal"
                        value={supplyExpenseAmount}
                        onChange={(event) => setSupplyExpenseAmount(event.target.value)}
                        placeholder="0,00"
                      />
                    </label>
                    <label>
                      Дата покупки
                      <input
                        type="date"
                        value={supplyExpenseDate}
                        onChange={(event) => setSupplyExpenseDate(event.target.value)}
                      />
                    </label>
                    <button type="button" onClick={createSupplyExpense}>
                      Добавить
                    </button>
                  </div>

                  <div className="supply-fbo-summary">
                    <div className="analytics-pipeline-card analytics-pipeline-card--highlight-success">
                      <span>Сумма покупок</span>
                      <strong>{formatMoney(supplyExpensesTotal, 'KZT')}</strong>
                    </div>
                    <div className="analytics-pipeline-card">
                      <span>Позиций</span>
                      <strong>{supplyExpenses.length}</strong>
                    </div>
                  </div>

                  <div className="toolbar-row">
                    <input
                      className="toolbar-search"
                      placeholder="Поиск по расходникам"
                      value={supplyExpenseSearch}
                      onChange={(event) => setSupplyExpenseSearch(event.target.value)}
                    />
                    <label className="date-chip">
                      С
                      <input
                        type="date"
                        value={supplyExpenseDateFrom}
                        onChange={(event) => setSupplyExpenseDateFrom(event.target.value)}
                      />
                    </label>
                    <label className="date-chip">
                      По
                      <input
                        type="date"
                        value={supplyExpenseDateTo}
                        onChange={(event) => setSupplyExpenseDateTo(event.target.value)}
                      />
                    </label>
                    <button type="button" onClick={loadSupplyExpenses}>
                      Обновить
                    </button>
                  </div>

                  <SupplyExpensesTable
                    rows={supplyExpenses}
                    onSave={updateSupplyExpense}
                    onDelete={deleteSupplyExpense}
                  />
                </div>
              )}

              {supplySubTab === 'analytics' && (
                <>
                  <div className="supply-fbo-summary">
                    <div className="analytics-pipeline-card analytics-pipeline-card--highlight-success">
                      <span>Отгружено на Ozon</span>
                      <strong>{supplyFboSummary.shippedToOzon}</strong>
                    </div>
                    <div className="analytics-pipeline-card analytics-pipeline-card--text-progress">
                      <span>Осталось отгрузить</span>
                      <strong>{supplyFboSummary.remainingToShip}</strong>
                    </div>
                  </div>

                  <div className="supply-filter">
                    <select
                      value={analyticsProductKey}
                      onChange={(event) => setAnalyticsProductKey(event.target.value)}
                    >
                      <option value="">Все товары</option>
                      {Array.from(
                        new Map(
                          supplyAnalytics.map((item) => [
                            item.isReserve
                              ? `reserve:${item.productName}`
                              : `product:${item.ozonProductId}`,
                            item,
                          ]),
                        ).values(),
                      ).map((item) => (
                        <option
                          value={
                            item.isReserve
                              ? `reserve:${item.productName}`
                              : `product:${item.ozonProductId}`
                          }
                          key={`${item.supplyId}-${item.id}`}
                        >
                          {item.productName}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => {
                        void Promise.all([
                          loadSupplyAnalytics(),
                          loadOzonSupplyShipments(),
                          loadSupplyFboDefects(),
                        ])
                      }}
                    >
                      Обновить
                    </button>
                    <button type="button" onClick={exportSupplyAnalytics}>
                      Скачать CSV
                    </button>
                    <button
                      type="button"
                      className={showSupplyFboRemaining ? 'secondary active' : 'secondary'}
                      onClick={() => setShowSupplyFboRemaining((current) => !current)}
                    >
                      {showSupplyFboRemaining
                        ? 'Скрыть остаток к отгрузке'
                        : 'Показать что осталось отгрузить'}
                    </button>
                    <button
                      type="button"
                      className={showSupplyFboDefects ? 'secondary active' : 'secondary'}
                      onClick={() => setShowSupplyFboDefects((current) => !current)}
                    >
                      Брак ({supplyFboDefects.length})
                    </button>
                  </div>

                  {showSupplyFboRemaining && (
                    <SupplyFboRemainingTable
                      rows={supplyFboSummary.remainingItems}
                      onMarkDefect={markSupplyFboDefect}
                    />
                  )}

                  {showSupplyFboDefects && (
                    <SupplyFboDefectsTable
                      rows={supplyFboDefects}
                      onRemoveDefect={removeSupplyFboDefect}
                    />
                  )}

                  <SupplyAnalyticsTable rows={filteredSupplyAnalytics} />
                </>
              )}

              {editingSupplyId && (
                <SupplyItemsModal
                  title="Редактировать поставку"
                  listIdPrefix={`edit-supply-${editingSupplyId}`}
                  token={token}
                  ozonProducts={ozonProducts}
                  novinkaProducts={supplyPackedCatalogItems}
                  items={editSupplyItems}
                  setItems={setEditSupplyItems}
                  productId={editSupplyProductId}
                  setProductId={setEditSupplyProductId}
                  quantity={editSupplyQuantity}
                  setQuantity={setEditSupplyQuantity}
                  selectedNovinkaOfferId={selectedNovinkaOfferId}
                  setSelectedNovinkaOfferId={setSelectedNovinkaOfferId}
                  reserveQuantity={editReserveQuantity}
                  setReserveQuantity={setEditReserveQuantity}
                  materialName={editSupplyMaterialName}
                  setMaterialName={setEditSupplyMaterialName}
                  materialQuantity={editSupplyMaterialQuantity}
                  setMaterialQuantity={setEditSupplyMaterialQuantity}
                  materialKind={editSupplyMaterialKind}
                  setMaterialKind={setEditSupplyMaterialKind}
                  shippingCost={editSupplyShippingCost}
                  setShippingCost={setEditSupplyShippingCost}
                  onAddProduct={addEditSupplyProduct}
                  onAddReserve={addEditReserveSupplyProduct}
                  onAddMaterial={addEditSupplyMaterialItem}
                  onSave={() => saveSupplyEdit(editingSupplyId)}
                  onClose={cancelEditSupply}
                  allowReserveNameEdit
                  allowOzonProductRelink
                  itemsTableTitle="Товар в поставке"
                />
              )}

              {shippingCostModalSupply && (
                <div className="modal-backdrop" role="presentation">
                  <div className="modal-card supply-shipping-modal" role="dialog" aria-modal="true">
                    <div className="modal-title-row">
                      <div>
                        <h3>Отправить поставку</h3>
                        <p>{formatSupplyTitle(shippingCostModalSupply)}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setShippingCostModalSupply(null)
                          setShippingCostDraft('')
                        }}
                      >
                        Закрыть
                      </button>
                    </div>
                    <div className="supply-shipping-summary">
                      <span>Товаров</span>
                      <strong>{shippingCostModalSupply.items.reduce((sum, item) => sum + item.quantity, 0)} шт.</strong>
                    </div>
                    <label className="supply-shipping-field">
                      <span>Сумма отправки</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={shippingCostDraft}
                        placeholder="Например: 15000"
                        onChange={(event) => setShippingCostDraft(event.target.value)}
                        autoFocus
                      />
                    </label>
                    <p className="supply-shipping-note">
                      После отправки обычный пользователь уже не сможет редактировать поставку.
                    </p>
                    <div className="supply-shipping-actions">
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => {
                          setShippingCostModalSupply(null)
                          setShippingCostDraft('')
                        }}
                      >
                        Отмена
                      </button>
                      <button type="button" onClick={() => void confirmSupplySent()}>
                        Отправить
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </section>
          )}

          {activeTab === 'chats' && (
            <section className="tab-panel chat-panel">
              <div className="section-title">
                <div>
                  <h2>Чаты</h2>
                  <p>{chatStatus || 'Личные сообщения и групповые беседы'}</p>
                </div>
                <span className="section-actions">
                  {canManageChatGroups() && (
                    <button type="button" className="header-action" onClick={() => {
                      setCreateGroupHint('')
                      setShowCreateGroupModal(true)
                    }}>
                      Создать группу
                    </button>
                  )}
                  <button type="button" className="header-action" onClick={loadChatThreads}>
                    Обновить
                  </button>
                </span>
              </div>

              {showCreateGroupModal && (
                <div className="modal-backdrop" role="presentation">
                  <div className="modal-card modal-card-wide chat-modal" role="dialog" aria-modal="true">
                    <div className="modal-title-row">
                      <h3>Создать группу</h3>
                      <button type="button" className="chat-modal-btn secondary" onClick={() => {
                        setCreateGroupHint('')
                        setShowCreateGroupModal(false)
                      }}>
                        Закрыть
                      </button>
                    </div>
                    <label className="chat-field-label">
                      Название группы
                      <input
                        className="chat-group-name-input"
                        placeholder="Например: Склад и производство"
                        value={newGroupName}
                        onChange={(event) => {
                          setCreateGroupHint('')
                          setNewGroupName(event.target.value)
                        }}
                      />
                    </label>
                    <div className="group-member-picker-section">
                      <strong>Участники</strong>
                      <p className="group-member-picker-hint">
                        Нажмите на пользователя, чтобы добавить или убрать. Минимум 3 участника: вы и ещё двое.
                      </p>
                      {newGroupMemberIds.length < 2 && (
                        <p className="group-create-hint">
                          Выбрано участников: {newGroupMemberIds.length}. Нужно минимум 2 — вместе с вами получится
                          группа из 3 человек.
                        </p>
                      )}
                      <div className="group-member-picker-list">
                        {chatPickerUsers.map((item) => (
                          <button
                            type="button"
                            key={item.id}
                            className={`group-member-option ${newGroupMemberIds.some((id) => isSameUserId(id, item.id)) ? 'selected' : ''}`}
                            onClick={() => toggleNewGroupMember(item.id)}
                          >
                            <span>{item.displayName || item.userName}</span>
                            <small>{item.position || 'Должность не указана'}</small>
                          </button>
                        ))}
                      </div>
                    </div>
                    {createGroupHint && (
                      <p className="group-create-hint group-create-hint-error" role="alert">
                        {createGroupHint}
                      </p>
                    )}
                    <div className="chat-modal-actions">
                      <button type="button" className="chat-modal-btn" onClick={createChatGroup}>
                        Создать
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {showGroupMembersModal && selectedChatType === 'group' && (
                <div className="modal-backdrop" role="presentation">
                  <div className="modal-card modal-card-wide chat-modal" role="dialog" aria-modal="true">
                    <div className="modal-title-row">
                      <h3>Участники</h3>
                      <div className="modal-title-actions">
                        {isSameUserId(
                          groupMembersModalState?.detail?.createdByUserId ||
                            selectedChatThread?.createdByUserId,
                          user?.id,
                        ) && (
                          <button type="button" className="chat-modal-btn danger compact" onClick={deleteChatGroup}>
                            Удалить группу
                          </button>
                        )}
                        <button
                          type="button"
                          className="chat-modal-btn secondary"
                          onClick={() => {
                            setShowGroupMembersModal(false)
                            setGroupMembersModalState(null)
                          }}
                        >
                          Закрыть
                        </button>
                      </div>
                    </div>
                    {groupMembersModalState?.loading ? (
                      <div className="empty-state">
                        <strong>Загрузка участников...</strong>
                      </div>
                    ) : groupMembersModalState?.error ? (
                      <div className="empty-state">
                        <strong>{groupMembersModalState.error}</strong>
                      </div>
                    ) : groupMembersModalState?.detail ? (
                      <>
                        <div className="group-member-picker">
                          <strong>В группе · {groupMembersModalState.detail.members.length}</strong>
                          {groupMembersModalState.detail.members.map((member) => {
                            const groupDetail = groupMembersModalState.detail!
                            const isCreator = isSameUserId(
                              groupDetail.createdByUserId || selectedChatThread?.createdByUserId,
                              user?.id,
                            )
                            const isSelf = isSameUserId(member.userId, user?.id)
                            const canRemoveOther = isCreator && !isSelf
                            const canLeaveSelf = isSelf
                            return (
                              <div key={member.userId} className="group-member-row">
                                <button
                                  type="button"
                                  className="group-member-profile-btn"
                                  onClick={() => openUserProfileFromMember(member)}
                                >
                                  <strong>{member.displayName || member.userName}</strong>
                                  <small>{member.position || 'Должность не указана'}</small>
                                </button>
                                {canRemoveOther && (
                                  <button
                                    type="button"
                                    className="chat-modal-btn danger compact"
                                    onClick={() => removeMemberFromGroup(member.userId)}
                                  >
                                    Удалить
                                  </button>
                                )}
                                {canLeaveSelf && (
                                  <button
                                    type="button"
                                    className="chat-modal-btn secondary compact"
                                    onClick={() => removeMemberFromGroup(member.userId)}
                                  >
                                    Выйти
                                  </button>
                                )}
                              </div>
                            )
                          })}
                        </div>
                        {groupMembersModalState.detail.members.some((member) =>
                          isSameUserId(member.userId, user?.id),
                        ) && (
                          <div className="group-member-picker">
                            <strong>Добавить</strong>
                            {chatPickerUsers
                              .filter(
                                (item) =>
                                  !groupMembersModalState.detail?.members.some((member) =>
                                    isSameUserId(member.userId, item.id),
                                  ),
                              )
                              .map((item) => (
                                <button
                                  type="button"
                                  key={item.id}
                                  className="group-member-option"
                                  onClick={() => addSingleMemberToGroup(item.id)}
                                >
                                  <span>{item.displayName || item.userName}</span>
                                  <small>{item.position || 'Должность не указана'}</small>
                                </button>
                              ))}
                            {chatPickerUsers.filter(
                              (item) =>
                                !groupMembersModalState.detail?.members.some((member) =>
                                  isSameUserId(member.userId, item.id),
                                ),
                            ).length === 0 && (
                              <div className="empty-state">
                                <strong>Все пользователи уже в группе.</strong>
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="empty-state">
                        <strong>Участники не найдены.</strong>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div className="chat-layout">
                <aside className="chat-users">
                  {chatThreads.map((item) => {
                    const isActive =
                      isSameChatId(selectedChatId, item.id) && selectedChatType === item.type

                    return (
                    <div className={`chat-thread-item ${isActive ? 'active' : ''}`} key={`${item.type}-${item.id}`}>
                      {item.type === 'user' ? (
                        <button
                          type="button"
                          className="chat-thread-avatar-btn"
                          title="Открыть карточку"
                          onClick={() => openUserProfileFromThread(item)}
                        >
                          <span className="chat-avatar">
                            <UserAvatarPreview
                              avatarUrl={item.avatarUrl}
                              displayName={item.title}
                              nested
                              hoverPreview={false}
                            />
                          </span>
                        </button>
                      ) : (
                        <span className="chat-thread-avatar-static">
                          <span className="chat-avatar group-avatar">
                            <span>ГР</span>
                          </span>
                        </span>
                      )}
                      <button
                        type="button"
                        className="chat-thread-main"
                        onClick={() => selectChatThread(item.type, item.id)}
                      >
                        <span>
                          <strong>{item.title}</strong>
                          <small>{item.subtitle || (item.type === 'group' ? 'Группа' : 'Пользователь')}</small>
                        </span>
                        {item.type === 'user' && (
                          <b className={item.isOnline ? 'online-dot' : 'offline-dot'}>
                            {item.isOnline ? 'В сети' : 'Не в сети'}
                          </b>
                        )}
                        {(item.unreadCount ?? 0) > 0 && (
                          <span className="tab-badge">{item.unreadCount}</span>
                        )}
                      </button>
                    </div>
                    )
                  })}
                  {chatThreads.length === 0 && (
                    <div className="empty-state">
                      <strong>Пока нет чатов. Создайте группу или дождитесь других пользователей.</strong>
                    </div>
                  )}
                </aside>

                <section className="chat-window">
                  {selectedChatThread ? (
                    <>
                      <div className="chat-window-head">
                      <button
                        type="button"
                        className="chat-window-profile-btn"
                        onClick={() =>
                          selectedChatType === 'user' && selectedChatThread
                            ? openUserProfileFromThread(selectedChatThread)
                            : undefined
                        }
                        disabled={selectedChatType !== 'user'}
                      >
                        <span className={`chat-avatar ${selectedChatType === 'group' ? 'group-avatar' : ''}`}>
                          {selectedChatType === 'group' ? (
                            <span>ГР</span>
                          ) : (
                            <UserAvatarPreview
                              avatarUrl={selectedChatThread.avatarUrl}
                              displayName={selectedChatThread.title}
                              nested
                              hoverPreview={false}
                            />
                          )}
                        </span>
                        <span className="chat-window-profile-text">
                          <strong>{selectedChatThread.title}</strong>
                          <small>
                            {selectedChatType === 'group'
                              ? `${chatGroupDetail?.members.length ?? selectedChatThread.memberCount} участников`
                              : `${selectedChatThread.subtitle || 'Должность не указана'} | ${selectedChatThread.isOnline ? 'В сети' : 'Не в сети'}`}
                          </small>
                        </span>
                      </button>
                        {selectedChatType === 'group' && (
                          <button type="button" className="chat-modal-btn compact chat-participants-btn" onClick={openGroupMembersModal}>
                            Участники
                          </button>
                        )}
                      </div>

                      <div className="chat-messages">
                        {chatMessages.map((message) => (
                          <div
                            className={`chat-message ${message.isOwn ? 'own' : 'incoming'}`}
                            key={message.id}
                          >
                            {selectedChatType === 'group' && !message.isOwn && (
                              <button
                                type="button"
                                className="chat-message-author"
                                onClick={() =>
                                  openUserProfileFromSender(message.senderId, message.senderDisplayName)
                                }
                              >
                                {message.senderDisplayName || 'Пользователь'}
                              </button>
                            )}
                            {message.text && <p>{message.text}</p>}
                            {message.hasAttachment && (
                              <ChatAttachmentPreview
                                message={message}
                                token={token}
                                onDownload={downloadChatAttachment}
                              />
                            )}
                            <span className="chat-message-meta">
                              <time>{formatDateTime(message.createdAt)}</time>
                              {message.isOwn && (
                                <button
                                  type="button"
                                  className="chat-message-delete"
                                  onClick={() => deleteChatMessage(message)}
                                  title="Удалить у себя"
                                >
                                  Удалить
                                </button>
                              )}
                            </span>
                          </div>
                        ))}
                        {chatMessages.length === 0 && (
                          <div className="empty-state">
                            <strong>Сообщений пока нет.</strong>
                          </div>
                        )}
                        <div ref={chatMessagesEndRef} />
                      </div>

                      {canEditChats() ? (
                      <form className="chat-form" onSubmit={sendChatMessage}>
                        <div className="chat-compose">
                          <textarea
                            placeholder="Напишите сообщение"
                            value={chatText}
                            onChange={(event) => setChatText(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' && !event.shiftKey) {
                                event.preventDefault()
                                event.currentTarget.form?.requestSubmit()
                              }
                            }}
                            rows={3}
                          />
                          {chatFile && (
                            <div className="chat-file-preview">
                              <span>{chatFile.name}</span>
                              <button type="button" onClick={() => setChatFile(null)}>
                                Убрать
                              </button>
                            </div>
                          )}
                        </div>
                        <label className="chat-file-button">
                          Прикрепить
                          <input
                            type="file"
                            accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.txt,.zip,.rar"
                            onChange={(event) => setChatFile(event.target.files?.[0] ?? null)}
                          />
                        </label>
                        <button type="submit">Отправить</button>
                      </form>
                      ) : (
                        <p className="integration-hint">Отправка сообщений недоступна. Включите право «Отправка сообщений» в настройках пользователя.</p>
                      )}
                    </>
                  ) : (
                    <div className="empty-state">
                      <strong>Выберите чат слева.</strong>
                    </div>
                  )}
                </section>
              </div>
            </section>
          )}

          {activeTab === 'users' && canViewUsers() && (
            <UsersAdminPanel
              token={token}
              users={users}
              usersLoadError={usersLoadError}
              roleProfiles={roleProfiles}
              currentUser={user}
              canCreateUsers={canCreateUsers()}
              canEditUsers={canEditUsers()}
              canChangeOtherPasswords={canChangeOtherPasswords}
              onUsersChange={setUsers}
              onCurrentUserChange={(updatedUser) => {
                setUser(updatedUser)
                localStorage.setItem('authUser', JSON.stringify(updatedUser))
              }}
              onOpenUserProfile={openUserProfile}
            />
          )}

          {activeTab === 'integrations' && hasFeature('integrations') && (
            <section className="integrations-panel">
              <div className="section-title">
                <div>
                  <h2>Интеграции</h2>
                  <p>
                    {shopRegion === 'rf'
                      ? 'Подключение Ozon API, Telegram и настройки оповещений'
                      : 'Подключение Kaspi, Satu, Halyk, Telegram и настройки оповещений'}
                  </p>
                </div>
                <span className="section-actions">
                  {canViewIntegrationsTelegram() && (
                    <button type="button" className="header-action" onClick={() => void loadIntegrationsTelegram()}>
                      Обновить Telegram
                    </button>
                  )}
                  {canViewIntegrationsOzon() && shopRegion === 'rf' && (
                    <button type="button" className="header-action" onClick={() => void loadIntegrationsOzon()}>
                      Обновить Ozon
                    </button>
                  )}
                  {canViewIntegrationsOzon() && shopRegion === 'kz' && (
                    <button
                      type="button"
                      className="header-action"
                      onClick={() => {
                        void loadKzIntegration('kaspi')
                        void loadKzIntegration('satu')
                        void loadKzIntegration('halyk')
                      }}
                    >
                      Обновить маркетплейсы
                    </button>
                  )}
                </span>
              </div>

              {(canViewIntegrationsOzon() || canViewIntegrationsTelegram() || canViewIntegrationsNotifications() || canViewIntegrationsReports()) && (
                <div className="integration-subtabs">
                  {(canViewIntegrationsOzon() || canViewIntegrationsTelegram()) && (
                    <button
                      type="button"
                      className={integrationsSubTab === 'connections' ? 'active' : ''}
                      onClick={() => setIntegrationsSubTab('connections')}
                    >
                      Подключения
                    </button>
                  )}
                  {canViewIntegrationsNotifications() && (
                    <button
                      type="button"
                      className={integrationsSubTab === 'telegram-notifications' ? 'active' : ''}
                      onClick={() => setIntegrationsSubTab('telegram-notifications')}
                    >
                      Оповещения пользователям
                    </button>
                  )}
                  {canViewIntegrationsReports() && (
                    <button
                      type="button"
                      className={integrationsSubTab === 'telegram-reports' ? 'active' : ''}
                      onClick={() => setIntegrationsSubTab('telegram-reports')}
                    >
                      Отчёты Telegram
                    </button>
                  )}
                </div>
              )}

              {integrationsSubTab === 'connections' && (canViewIntegrationsOzon() || canViewIntegrationsTelegram()) && (
                <>
              {canViewIntegrationsOzon() && shopRegion === 'rf' && (
                <article className="integration-card">
                  <div className="integration-card-head">
                    <div>
                      <h3>Ozon Seller API</h3>
                      <p>{ozonSettingsStatus || 'Client ID и API Key хранятся в базе данных'}</p>
                    </div>
                    <span className={`integration-badge ${ozonSettingsData?.configured ? 'ok' : 'warn'}`}>
                      {ozonSettingsData?.configured ? 'Настроено' : 'Не настроено'}
                    </span>
                  </div>

                  {ozonSettingsData && (
                    <div className="integration-meta">
                      <small>Client ID: {ozonSettingsData.clientIdMasked || '—'}</small>
                      <small>API Key: {ozonSettingsData.apiKeyMasked || '—'}</small>
                      {ozonSettingsData.updatedAt && (
                        <small>Обновлено: {formatDateTime(ozonSettingsData.updatedAt)}</small>
                      )}
                    </div>
                  )}

                  <div className="integration-form-grid">
                    <label>
                      <span>Client ID</span>
                      <input
                        type="text"
                        value={ozonSettingsForm.clientId}
                        disabled={!canEditIntegrationsOzon()}
                        onChange={(event) =>
                          setOzonSettingsForm((current) => ({ ...current, clientId: event.target.value }))
                        }
                        placeholder={ozonSettingsData?.hasStoredClientId ? 'Оставьте пустым, чтобы не менять' : 'Введите Client ID'}
                        autoComplete="off"
                      />
                    </label>
                    <label>
                      <span>API Key</span>
                      <input
                        type="password"
                        value={ozonSettingsForm.apiKey}
                        disabled={!canEditIntegrationsOzon()}
                        onChange={(event) =>
                          setOzonSettingsForm((current) => ({ ...current, apiKey: event.target.value }))
                        }
                        placeholder={ozonSettingsData?.hasStoredApiKey ? 'Оставьте пустым, чтобы не менять' : 'Введите API Key'}
                        autoComplete="off"
                      />
                    </label>
                    <label>
                      <span>Base URL</span>
                      <input
                        type="url"
                        value={ozonSettingsForm.baseUrl}
                        disabled={!canEditIntegrationsOzon()}
                        onChange={(event) =>
                          setOzonSettingsForm((current) => ({ ...current, baseUrl: event.target.value }))
                        }
                      />
                    </label>
                  </div>

                  {canEditIntegrationsOzon() && (
                  <div className="integration-actions">
                    <button
                      type="button"
                      className="header-action"
                      disabled={ozonSettingsSaving}
                      onClick={() => void saveIntegrationsOzon()}
                    >
                      {ozonSettingsSaving ? 'Сохранение...' : 'Сохранить Ozon'}
                    </button>
                    <button type="button" className="header-action secondary" onClick={() => void testIntegrationsOzon()}>
                      Проверить подключение
                    </button>
                  </div>
                  )}
                </article>
              )}

              {canViewIntegrationsOzon() && shopRegion === 'kz' && (
                <KzIntegrationsPanel
                  activeMarketplace={integrationKzMarketplace}
                  onMarketplaceChange={setIntegrationKzMarketplace}
                  settings={kzIntegrationSettings}
                  forms={kzIntegrationForms}
                  status={kzIntegrationStatus}
                  saving={kzIntegrationSaving}
                  canEdit={canEditIntegrationsOzon()}
                  onMerchantIdChange={(marketplace, value) =>
                    setKzIntegrationForms((current) => ({
                      ...current,
                      [marketplace]: { ...current[marketplace], merchantId: value },
                    }))
                  }
                  onApiKeyChange={(marketplace, value) =>
                    setKzIntegrationForms((current) => ({
                      ...current,
                      [marketplace]: { ...current[marketplace], apiKey: value },
                    }))
                  }
                  onSave={(marketplace) => void saveKzIntegration(marketplace)}
                  onTest={(marketplace) => void testKzIntegration(marketplace)}
                />
              )}

              {canViewIntegrationsTelegram() && (
              <article className="integration-card">
                <div className="integration-card-head">
                  <div>
                    <h3>Telegram-бот</h3>
                    <p>{telegramStatus || 'Подключите бота для получения оповещений, настроенных администратором'}</p>
                  </div>
                  <span
                    className={`integration-badge ${
                      telegramIntegration?.connected ? 'ok' : telegramIntegration?.botConfigured ? 'warn' : 'off'
                    }`}
                  >
                    {telegramIntegration?.connected
                      ? 'Подключён'
                      : telegramIntegration?.botConfigured
                        ? 'Не подключён'
                        : 'Бот не настроен'}
                  </span>
                </div>

                {telegramIntegration?.botConfigured && (
                  <div className="integration-meta">
                    {telegramIntegration.botDisplayName && (
                      <small>
                        Бот: {telegramIntegration.botDisplayName}
                        {telegramIntegration.botUsername ? ` (@${telegramIntegration.botUsername})` : ''}
                      </small>
                    )}
                    {telegramIntegration.connected && telegramIntegration.chatIdMasked && (
                      <small>Chat ID: {telegramIntegration.chatIdMasked}</small>
                    )}
                    {telegramIntegration.connectUrl && !telegramIntegration.connected && (
                      <a href={telegramIntegration.connectUrl} target="_blank" rel="noreferrer">
                        Открыть бота в Telegram
                      </a>
                    )}
                  </div>
                )}

                <div className="integration-actions">
                  {!telegramIntegration?.connected ? (
                    canConnectIntegrationsTelegram() && (
                    <button
                      type="button"
                      className="header-action"
                      disabled={!telegramIntegration?.botConfigured || !telegramIntegration?.connectAllowed}
                      onClick={() => void connectTelegramBot()}
                    >
                      Подключить Telegram
                    </button>
                    )
                  ) : (
                    canConnectIntegrationsTelegram() && (
                    <>
                      <button type="button" className="header-action" onClick={() => void testTelegramNotification()}>
                        Тестовое сообщение
                      </button>
                      <button
                        type="button"
                        className="header-action secondary"
                        onClick={() => void disconnectTelegramBot()}
                      >
                        Отключить
                      </button>
                    </>
                    )
                  )}
                </div>

                {!telegramIntegration?.connectAllowed && !telegramIntegration?.connected && !canConnectIntegrationsTelegram() && (
                  <p className="integration-hint">
                    Администратор не разрешил вам подключение Telegram. Включите галочку «Telegram: подключение» в настройках пользователя.
                  </p>
                )}

                {telegramIntegration?.connected && (
                  <p className="integration-hint">
                    {(canViewIntegrationsNotifications() || canViewIntegrationsReports())
                      ? 'Оповещения и отчёты настраиваются во вкладках «Оповещения пользователям» и «Отчёты Telegram».'
                      : 'Какие оповещения приходят, определяет администратор.'}
                  </p>
                )}

                {!telegramIntegration?.botConfigured && (
                  <p className="integration-hint">
                    Администратор должен добавить <code>TELEGRAM_BOT_TOKEN</code> в файл <code>.env</code> на сервере.
                  </p>
                )}
              </article>
              )}
                </>
              )}

              {canViewIntegrationsNotifications() && integrationsSubTab === 'telegram-notifications' && (
                <article className="integration-card integration-admin-card">
                  <div className="integration-card-head">
                    <div>
                      <h3>Оповещения пользователям</h3>
                      <p>Настройки РФ и КЗ разделены: задачи Ozon и поставки — в РФ, задачи Kaspi/Satu/Halyk — в КЗ</p>
                    </div>
                  </div>

                  <div className="integration-region-tabs">
                    <button
                      type="button"
                      className={telegramNotificationsRegion === 'rf' ? 'active' : ''}
                      onClick={() => setTelegramNotificationsRegion('rf')}
                    >
                      РФ
                    </button>
                    <button
                      type="button"
                      className={telegramNotificationsRegion === 'kz' ? 'active' : ''}
                      onClick={() => setTelegramNotificationsRegion('kz')}
                    >
                      КЗ
                    </button>
                  </div>

                  <div className="integration-admin-toolbar">
                    <label className="integration-user-select">
                      <span>Пользователь</span>
                      <select
                        value={integrationAdminUserId}
                        onChange={(event) => setIntegrationAdminUserId(event.target.value)}
                      >
                        {users.filter((item) => item.id !== SYSTEM_USER_ID).map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.displayName || item.userName} · {getRoleLabel(item.role)}
                          </option>
                        ))}
                      </select>
                    </label>
                    {integrationAdminUserId && (
                      <span className={`user-badge user-badge-telegram ${users.find((item) => item.id === integrationAdminUserId)?.telegramConnected ? 'is-online' : 'is-offline'}`}>
                        Telegram:{' '}
                        {users.find((item) => item.id === integrationAdminUserId)?.telegramConnected
                          ? 'подключён'
                          : 'не подключён'}
                      </span>
                    )}
                  </div>

                  {integrationAdminUserId && userTelegramData[integrationAdminUserId]?.connected ? (
                    <>
                      <div className="integration-event-grid">
                        {groupItemsByField(telegramEvents, (eventItem) => eventItem.group).map(([group, events]) => (
                          <fieldset key={group}>
                            <legend>{group}</legend>
                            <div className="integration-event-list">
                              {events.map((eventItem) => {
                                const selectedEvents =
                                  telegramNotificationsRegion === 'kz'
                                    ? (userTelegramEventsKz[integrationAdminUserId] ?? [])
                                    : (userTelegramEvents[integrationAdminUserId] ?? [])
                                const setSelectedEvents =
                                  telegramNotificationsRegion === 'kz'
                                    ? setUserTelegramEventsKz
                                    : setUserTelegramEvents

                                return (
                                <label key={eventItem.id}>
                                  <input
                                    type="checkbox"
                                    checked={selectedEvents.includes(eventItem.id)}
                                    disabled={!canEditIntegrationsNotifications()}
                                    onChange={(changeEvent) =>
                                      setSelectedEvents((current) => {
                                        const selected = current[integrationAdminUserId] ?? []
                                        return {
                                          ...current,
                                          [integrationAdminUserId]: changeEvent.target.checked
                                            ? [...selected, eventItem.id]
                                            : selected.filter((value) => value !== eventItem.id),
                                        }
                                      })
                                    }
                                  />
                                  {eventItem.label}
                                </label>
                                )
                              })}
                            </div>
                          </fieldset>
                        ))}
                        {(() => {
                          const report = userReportData[integrationAdminUserId]
                          const selectedSections = userReportSections[integrationAdminUserId] ?? report?.enabledSections ?? []
                          const accountingSections = reportSections.filter(isAccountingReportSection)
                          if (accountingSections.length === 0) {
                            return null
                          }

                          return (
                            <fieldset>
                              <legend>{accountingReportGroup}</legend>
                              <div className="integration-event-list">
                                {accountingSections.map((section) => (
                                  <label key={section.id}>
                                    <input
                                      type="checkbox"
                                      checked={selectedSections.includes(section.id)}
                                      disabled={!canEditIntegrationsReports()}
                                      onChange={(changeEvent) =>
                                        setUserReportSections((current) => {
                                          const selected = current[integrationAdminUserId] ?? selectedSections
                                          return {
                                            ...current,
                                            [integrationAdminUserId]: changeEvent.target.checked
                                              ? [...selected, section.id]
                                              : selected.filter((value) => value !== section.id),
                                          }
                                        })
                                      }
                                    />
                                    {section.label}
                                  </label>
                                ))}
                              </div>
                            </fieldset>
                          )
                        })()}
                      </div>
                      {canEditIntegrationsNotifications() && (
                      <div className="integration-actions">
                        <button type="button" className="header-action" onClick={() => void saveUserTelegramAndAccountingPreferences(integrationAdminUserId)}>
                          Сохранить оповещения ({telegramNotificationsRegion === 'rf' ? 'РФ' : 'КЗ'})
                        </button>
                      </div>
                      )}
                      {userTelegramStatus[integrationAdminUserId] && (
                        <p className="integration-hint">{userTelegramStatus[integrationAdminUserId]}</p>
                      )}
                    </>
                  ) : (
                    <p className="integration-hint">
                      Пользователь должен подключить Telegram. Разрешение включается галочкой «Telegram: подключение» в настройках пользователя.
                    </p>
                  )}
                </article>
              )}

              {canViewIntegrationsReports() && integrationsSubTab === 'telegram-reports' && (
                <article className="integration-card integration-admin-card">
                  <div className="integration-card-head">
                    <div>
                      <h3>Отчёты Telegram</h3>
                      <p>{reportsStatus || 'Ежедневные и ежемесячные отчёты настраиваются для каждого пользователя отдельно'}</p>
                    </div>
                    <button type="button" className="header-action secondary" onClick={() => void loadReportSections()}>
                      Обновить метрики
                    </button>
                  </div>

                  <div className="integration-admin-toolbar">
                    <label className="integration-user-select">
                      <span>Пользователь</span>
                      <select
                        value={integrationAdminUserId}
                        onChange={(event) => setIntegrationAdminUserId(event.target.value)}
                      >
                        {users.filter((item) => item.id !== SYSTEM_USER_ID).map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.displayName || item.userName} · {getRoleLabel(item.role)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  {integrationAdminUserId && (() => {
                    const report = userReportData[integrationAdminUserId]
                    const selectedSections = userReportSections[integrationAdminUserId] ?? report?.enabledSections ?? []
                    const selectedMonthlySections =
                      userMonthlyReportSections[integrationAdminUserId] ?? report?.monthlyEnabledSections ?? []
                    const selectedUser = users.find((item) => item.id === integrationAdminUserId)
                    const defaultReport: AdminUserReport = {
                      enabled: false,
                      reportTime: '19:00',
                      timezone: 'Asia/Almaty',
                      enabledSections: [],
                      availableSections: reportSections.map((section) => section.id),
                      lastSentOn: null,
                      monthlyEnabled: false,
                      monthlyReportTime: '19:00',
                      monthlyTimezone: 'Asia/Almaty',
                      monthlyEnabledSections: [],
                      monthlyLastSentOn: null,
                      telegramConnected: selectedUser?.telegramConnected ?? false,
                    }
                    const activeReport = report ?? defaultReport
                    const updateReport = (patch: Partial<AdminUserReport>) =>
                      setUserReportData((current) => ({
                        ...current,
                        [integrationAdminUserId]: {
                          ...(current[integrationAdminUserId] ?? defaultReport),
                          ...patch,
                        },
                      }))

                    return (
                      <div className="integration-report-form">
                        <section className="integration-report-block">
                          <div className="integration-report-block-head">
                            <label className="integration-toggle">
                              <input
                                type="checkbox"
                                checked={activeReport.enabled}
                                disabled={!canEditIntegrationsReports()}
                                onChange={(event) => updateReport({ enabled: event.target.checked })}
                              />
                              Отправлять ежедневный отчёт
                            </label>
                            {activeReport.lastSentOn && (
                              <span className="integration-hint">Последний: {activeReport.lastSentOn}</span>
                            )}
                          </div>

                          <div className="integration-form-grid">
                            <label>
                              <span>Время отправки</span>
                              <input
                                type="time"
                                value={activeReport.reportTime}
                                disabled={!canEditIntegrationsReports()}
                                onChange={(event) => updateReport({ reportTime: event.target.value })}
                              />
                            </label>
                            <label>
                              <span>Часовой пояс</span>
                              <select
                                value={normalizeReportTimezone(activeReport.timezone)}
                                disabled={!canEditIntegrationsReports()}
                                onChange={(event) => updateReport({ timezone: event.target.value })}
                              >
                                {reportTimezoneOptions.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>

                          <div className="integration-event-grid">
                            {groupItemsByField(reportSections.filter(isRegularReportSection), (section) => section.group).map(([group, sections]) => (
                              <fieldset key={group}>
                                <legend>{group}</legend>
                                <div className="integration-event-list">
                                  {sections.map((section) => (
                                    <label key={section.id}>
                                      <input
                                        type="checkbox"
                                        checked={selectedSections.includes(section.id)}
                                        disabled={!canEditIntegrationsReports()}
                                        onChange={(changeEvent) =>
                                          setUserReportSections((current) => {
                                            const selected = current[integrationAdminUserId] ?? selectedSections
                                            return {
                                              ...current,
                                              [integrationAdminUserId]: changeEvent.target.checked
                                                ? [...selected, section.id]
                                                : selected.filter((value) => value !== section.id),
                                            }
                                          })
                                        }
                                      />
                                      {section.label}
                                    </label>
                                  ))}
                                </div>
                              </fieldset>
                            ))}
                          </div>
                        </section>

                        <section className="integration-report-block">
                          <div className="integration-report-block-head">
                            <label className="integration-toggle">
                              <input
                                type="checkbox"
                                checked={activeReport.monthlyEnabled}
                                disabled={!canEditIntegrationsReports()}
                                onChange={(event) => updateReport({ monthlyEnabled: event.target.checked })}
                              />
                              Отправлять ежемесячный отчёт
                            </label>
                            {activeReport.monthlyLastSentOn && (
                              <span className="integration-hint">Последний: {activeReport.monthlyLastSentOn}</span>
                            )}
                          </div>

                          <div className="integration-form-grid">
                            <label>
                              <span>Время отправки</span>
                              <input
                                type="time"
                                value={activeReport.monthlyReportTime}
                                disabled={!canEditIntegrationsReports()}
                                onChange={(event) => updateReport({ monthlyReportTime: event.target.value })}
                              />
                            </label>
                            <label>
                              <span>Часовой пояс</span>
                              <select
                                value={normalizeReportTimezone(activeReport.monthlyTimezone)}
                                disabled={!canEditIntegrationsReports()}
                                onChange={(event) => updateReport({ monthlyTimezone: event.target.value })}
                              >
                                {reportTimezoneOptions.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>

                          <p className="integration-hint">
                            Отправляется в последний день месяца за период с 1 числа по последний день месяца.
                          </p>

                          <div className="integration-event-grid">
                            {groupItemsByField(reportSections.filter(isRegularReportSection), (section) => section.group).map(([group, sections]) => (
                              <fieldset key={group}>
                                <legend>{group}</legend>
                                <div className="integration-event-list">
                                  {sections.map((section) => (
                                    <label key={section.id}>
                                      <input
                                        type="checkbox"
                                        checked={selectedMonthlySections.includes(section.id)}
                                        disabled={!canEditIntegrationsReports()}
                                        onChange={(changeEvent) =>
                                          setUserMonthlyReportSections((current) => {
                                            const selected = current[integrationAdminUserId] ?? selectedMonthlySections
                                            return {
                                              ...current,
                                              [integrationAdminUserId]: changeEvent.target.checked
                                                ? [...selected, section.id]
                                                : selected.filter((value) => value !== section.id),
                                            }
                                          })
                                        }
                                      />
                                      {section.label}
                                    </label>
                                  ))}
                                </div>
                              </fieldset>
                            ))}
                          </div>
                        </section>

                        {!selectedUser?.telegramConnected && !report?.telegramConnected && (
                          <p className="integration-hint">Для отчёта пользователь должен подключить Telegram.</p>
                        )}

                        {canEditIntegrationsReports() && (
                        <div className="integration-actions">
                          <button type="button" className="header-action" onClick={() => void saveUserReport(integrationAdminUserId)}>
                            Сохранить отчёт
                          </button>
                          <button type="button" className="header-action secondary" onClick={() => void testUserReport(integrationAdminUserId)}>
                            Тестовый ежедневный
                          </button>
                          <button type="button" className="header-action secondary" onClick={() => void testUserMonthlyReport(integrationAdminUserId)}>
                            Тестовый ежемесячный
                          </button>
                        </div>
                        )}
                        {userReportStatus[integrationAdminUserId] && (
                          <p className="integration-hint">{userReportStatus[integrationAdminUserId]}</p>
                        )}
                      </div>
                    )
                  })()}
                </article>
              )}
            </section>
          )}

          {activeTab === 'accounting' && hasFeature('accounting') && <AccountingReportsPrototype token={token} />}

          {activeTab === 'settings' && canViewSettings() && (
            <section className="admin-panel">
              <div className="section-title">
                <div>
                  <h2>Настройки</h2>
                  <p>{canEditSettings() ? 'Системные инструменты, роли и журнал действий' : 'Просмотр системного состояния и журнала'}</p>
                </div>
                <span className="section-actions">
                  <button type="button" className="header-action" onClick={() => loadAuditLogs()}>
                    Обновить журнал
                  </button>
                  {canViewSettings() && (
                    <button type="button" className="header-action" onClick={exportAuditLogs}>
                      Скачать Excel
                    </button>
                  )}
                </span>
              </div>

              <div className="settings-grid settings-grid-compact">
                <div>
                  <span>База данных</span>
                  <strong>{systemHealth?.databaseOk ? 'PostgreSQL OK' : 'Проверка...'}</strong>
                  <small>{systemHealthStatus || 'Работает внутри Docker Compose.'}</small>
                </div>
                <div>
                  <span>Р‘СЌРєР°РїС‹</span>
                  <strong>{backupFiles.length ? `${backupFiles.length} файлов` : 'Нет файлов'}</strong>
                  <small>{backupStatus || 'Файлы складываются в папку backups рядом с проектом.'}</small>
                  <button type="button" className="settings-card-action" onClick={loadBackups}>
                    Обновить список
                  </button>
                </div>
                <div>
                  <span>Просмотр БД</span>
                  <strong>Adminer</strong>
                  {systemHealth?.adminerUrl ? (
                    <>
                      <a href={systemHealth.adminerUrl} target="_blank" rel="noreferrer">
                        Открыть Adminer
                      </a>
                      <small>
                        {systemHealth.adminerUrl.includes('127.0.0.1')
                          ? 'Сначала откройте SSH-туннель: ssh -p 2222 -L 8082:127.0.0.1:8082 root@217.114.4.89. Пароль БД — POSTGRES_PASSWORD в .env на сервере.'
                          : 'Пароль вводится вручную — из POSTGRES_PASSWORD в .env'}
                      </small>
                    </>
                  ) : (
                    <small>Adminer не настроен. Добавьте ADMINER_PUBLIC_URL в .env (локально: http://127.0.0.1:18082).</small>
                  )}
                </div>
                <div>
                  <span>Сервер</span>
                  <strong>{systemHealth ? 'Работает' : 'Проверка...'}</strong>
                  <small>{systemHealth ? 'Сервер приложения доступен.' : 'Статус загружается'}</small>
                </div>
              </div>

              <details className="settings-details-panel role-profiles-panel">
                <summary className="settings-details-head role-profiles-head">
                  <div>
                    <h3>Роли и главная страница</h3>
                    <p>
                      {roleProfilesStatus ||
                        (canEditSettings()
                          ? 'Шаблоны доступа и блоки главной · нажмите «Показать»'
                          : 'Только просмотр — нажмите «Показать»')}
                    </p>
                  </div>
                </summary>
                <div className="settings-details-body role-profiles-list">
                  {roleProfiles.map((profile) => {
                    const edit = roleProfileEdits[profile.role] ?? profile
                    const editFeatures = edit.allowedFeatures ?? []
                    return (
                      <details className="settings-nested-panel role-profile-card" key={profile.role}>
                        <summary className="settings-nested-head role-profile-summary">
                          <span className="settings-nested-head-text">
                            <strong>{getRoleLabel(profile.role)}</strong>
                            <small>{edit.displayName || profile.displayName}</small>
                          </span>
                        </summary>
                        <div className="role-profile-body">
                        <div className="role-profile-head">
                          <label className="role-profile-title">
                            <span>Название</span>
                            <input
                              value={edit.displayName}
                              disabled={!canEditSettings()}
                              onChange={(event) =>
                                setRoleProfileEdits((current) => ({
                                  ...current,
                                  [profile.role]: { ...edit, displayName: event.target.value },
                                }))
                              }
                            />
                          </label>
                          <label className="role-profile-checkbox">
                            <input
                              type="checkbox"
                              checked={edit.canChangeOtherUserPasswords}
                              disabled={!canEditSettings()}
                              onChange={(event) =>
                                setRoleProfileEdits((current) => ({
                                  ...current,
                                  [profile.role]: {
                                    ...edit,
                                    canChangeOtherUserPasswords: event.target.checked,
                                  },
                                }))
                              }
                            />
                            Может менять пароли
                          </label>
                        </div>
                        <UserPermissionsEditor
                          role={edit.role}
                          allowedFeatures={editFeatures}
                          onFeaturesChange={(allowedFeatures) =>
                            setRoleProfileEdits((current) => ({
                              ...current,
                              [profile.role]: { ...edit, allowedFeatures },
                            }))
                          }
                          homeBlocks={edit.homeBlocks}
                          onHomeBlocksChange={(homeBlocks) =>
                            setRoleProfileEdits((current) => ({
                              ...current,
                              [profile.role]: { ...edit, homeBlocks },
                            }))
                          }
                          featuresDisabled={!canEditSettings()}
                          isRoleTemplate
                        />
                        {canEditSettings() && (
                          <button type="button" className="user-action-btn role-profile-save" onClick={() => void saveRoleProfile(profile.role)}>
                            Сохранить роль
                          </button>
                        )}
                        </div>
                      </details>
                    )
                  })}
                </div>
              </details>

              <details className="settings-details-panel backup-panel">
                <summary className="settings-details-head backup-panel-head">
                  <div>
                    <h3>Бэкапы базы данных</h3>
                    <p>{backupStatus || 'Последние сохраненные копии PostgreSQL'}</p>
                  </div>
                </summary>
                <div className="settings-details-body">
                <button type="button" className="header-action backup-refresh" onClick={loadBackups}>
                  Обновить
                </button>
                <div className="backup-list">
                  {backupFiles.map((file) => (
                    <div className="backup-row" key={file.fileName}>
                      <span>
                        <strong>{file.fileName}</strong>
                        <small>
                          {formatDateTime(file.createdAt)} | {formatFileSize(file.sizeBytes)}
                        </small>
                      </span>
                      <button type="button" onClick={() => downloadBackup(file.fileName)}>
                        Скачать
                      </button>
                    </div>
                  ))}
                  {backupFiles.length === 0 && (
                    <div className="empty-state">Бэкапы появятся после первого запуска backup-контейнера.</div>
                  )}
                </div>
                </div>
              </details>

              <details className="settings-details-panel audit-panel">
                <summary className="settings-details-head backup-panel-head">
                  <div>
                    <h3>Журнал действий</h3>
                    <p>{auditStatus || 'Последние действия пользователей и системы'}</p>
                  </div>
                </summary>
                <div className="settings-details-body">
                <form
                  className="audit-filter"
                  onSubmit={(event) => {
                    event.preventDefault()
                    loadAuditLogs(auditSearch)
                  }}
                >
                  <input
                    placeholder="Поиск по журналу"
                    value={auditSearch}
                    onChange={(event) => setAuditSearch(event.target.value)}
                  />
                  <label className="audit-filter-field">
                    <span>Дата с</span>
                    <input
                      type="date"
                      value={auditDateFrom}
                      onChange={(event) => setAuditDateFrom(event.target.value)}
                    />
                  </label>
                  <label className="audit-filter-field">
                    <span>Дата по</span>
                    <input
                      type="date"
                      value={auditDateTo}
                      onChange={(event) => setAuditDateTo(event.target.value)}
                    />
                  </label>
                  <label className="audit-filter-field">
                    <span>Исполнитель</span>
                    <select value={auditUserId} onChange={(event) => setAuditUserId(event.target.value)}>
                      <option value="">Все пользователи</option>
                      {users.map((entry) => (
                        <option key={entry.id} value={entry.id}>
                          {entry.displayName || entry.userName} ({entry.userName})
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="submit">Найти</button>
                  {canViewSettings() && (
                    <button type="button" className="analytics-export-button" onClick={exportAuditLogs}>
                      Excel
                    </button>
                  )}
                  <button
                    type="button"
                    className="audit-filter-reset"
                    onClick={() => {
                      setAuditSearch('')
                      setAuditDateFrom('')
                      setAuditDateTo('')
                      setAuditUserId('')
                      void loadAuditLogs('', { dateFrom: '', dateTo: '', userId: '' })
                    }}
                  >
                    Сбросить
                  </button>
                </form>

                <div className="data-table audit-table">
                  <div className="table-row audit-row table-head">
                    <span>Дата</span>
                    <span>Пользователь</span>
                    <span>Действие</span>
                    <span>Объект</span>
                    <span>Детали</span>
                  </div>
                  {auditLogs.map((log) => (
                    <div className="table-row audit-row" key={log.id}>
                      <span>{formatDateTime(log.createdAt)}</span>
                      <span>
                        <strong>{log.displayName || log.userName || '-'}</strong>
                        <small>{log.userName}</small>
                      </span>
                      <span>{log.action}</span>
                      <span>
                        <strong>{log.entityType}</strong>
                        <small>{log.entityId}</small>
                      </span>
                      <span>{log.details}</span>
                    </div>
                  ))}
                  {auditLogs.length === 0 && (
                    <div className="empty-state">
                      <strong>В журнале пока нет записей.</strong>
                    </div>
                  )}
                </div>
                </div>
              </details>
            </section>
          )}

          {productCostModalProduct && (
            <div className="modal-backdrop" role="presentation">
              <div className="modal-card product-cost-modal" role="dialog" aria-modal="true">
                <div className="modal-title-row">
                  <div>
                    <h3>Карточка товара</h3>
                    <p className="product-cost-subtitle">{productCostModalProduct.name}</p>
                  </div>
                  <button type="button" onClick={() => setProductCostModalProduct(null)}>
                    Закрыть
                  </button>
                </div>

                <div className="product-cost-product">
                  {productCostModalProduct.imageUrl ? (
                    <ProductImageHoverPreview imageUrl={productCostModalProduct.imageUrl} name={productCostModalProduct.name}>
                      <ProductThumb imageUrl={productCostModalProduct.imageUrl} name={productCostModalProduct.name} />
                    </ProductImageHoverPreview>
                  ) : (
                    <span className="product-thumb product-thumb-empty">Фото</span>
                  )}
                  <div>
                    <strong>{productCostModalProduct.offerId || '-'}</strong>
                    <small>{productCostModalProduct.productId}</small>
                    <small>{formatMoney(productCostModalProduct.price, productCostModalProduct.currencyCode)}</small>
                  </div>
                </div>

                <div className="product-cost-source">
                  <label className="product-cost-purchase-toggle">
                    <input
                      type="checkbox"
                      checked={!productCostForm.useIndividualCost}
                      onChange={(event) =>
                        setProductCostForm((current) => ({
                          ...current,
                          useIndividualCost: !event.target.checked,
                        }))
                      }
                    />
                    <span>Брать себестоимость из типа товара</span>
                  </label>

                  {!productCostForm.useIndividualCost && (
                    <label className="product-cost-field">
                      <span>Тип себестоимости</span>
                      <select
                        value={productCostForm.costTypeId}
                        onChange={(event) => {
                          const nextCostTypeId = event.target.value
                          setProductCostForm((current) => ({ ...current, costTypeId: nextCostTypeId }))
                          fillProductCostTypeEditForm(productCostTypes.find((type) => type.id === nextCostTypeId))
                        }}
                      >
                        <option value="">Выберите тип</option>
                        {productCostTypes.map((type) => (
                          <option key={type.id} value={type.id}>
                            {type.name} · {type.costTotal ? formatMoney(type.costTotal, productCostModalProduct.currencyCode || 'KZT') : '-'}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>

                {!productCostForm.useIndividualCost && productCostTypeEditForm.id && hasFeature('products.edit') && (
                  <div className="product-cost-type-edit-compact">
                    <div>
                      <strong>Выбран тип: {productCostTypeEditForm.name}</strong>
                      <span>Изменение этого типа пересчитает все товары, которые к нему привязаны.</span>
                    </div>
                    <button
                      type="button"
                      className="secondary"
                      onClick={() =>
                        openProductCostTypeEditModal(productCostTypes.find((type) => type.id === productCostTypeEditForm.id))
                      }
                    >
                      Изменить тип
                    </button>
                  </div>
                )}

                {productCostForm.useIndividualCost && (
                  <>
                    <label className="product-cost-purchase-toggle">
                      <input
                        type="checkbox"
                        checked={productCostForm.isPurchased}
                        onChange={(event) =>
                          setProductCostForm((current) => ({
                            ...current,
                            isPurchased: event.target.checked,
                          }))
                        }
                      />
                      <span>Закупной товар</span>
                    </label>

                    {productCostForm.isPurchased ? (
                      <label className="product-cost-field">
                        <span>Себестоимость</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={productCostForm.purchaseCost}
                          placeholder="Например: 450"
                          onChange={(event) =>
                            setProductCostForm((current) => ({ ...current, purchaseCost: event.target.value }))
                          }
                        />
                      </label>
                    ) : (
                      <div className="product-cost-grid">
                        <label className="product-cost-field">
                          <span>Упаковка</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={productCostForm.packagingCost}
                            placeholder="0"
                            onChange={(event) =>
                              setProductCostForm((current) => ({ ...current, packagingCost: event.target.value }))
                            }
                          />
                        </label>
                        <label className="product-cost-field">
                          <span>Производство</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={productCostForm.productionCost}
                            placeholder="0"
                            onChange={(event) =>
                              setProductCostForm((current) => ({ ...current, productionCost: event.target.value }))
                            }
                          />
                        </label>
                      </div>
                    )}
                  </>
                )}

                {hasFeature('products.edit') && (
                  <div className="product-cost-type-editor">
                    <div className="product-cost-type-title">
                      <strong>Новый тип себестоимости</strong>
                      <span>Например: магнит, значок, кружка</span>
                    </div>
                    <div className="product-cost-type-form">
                      <label className="product-cost-field">
                        <span>Название типа</span>
                        <input
                          type="text"
                          value={productCostTypeForm.name}
                          placeholder="Магнит"
                          onChange={(event) =>
                            setProductCostTypeForm((current) => ({ ...current, name: event.target.value }))
                          }
                        />
                      </label>
                      <label className="product-cost-purchase-toggle product-cost-type-toggle">
                        <input
                          type="checkbox"
                          checked={productCostTypeForm.isPurchased}
                          onChange={(event) =>
                            setProductCostTypeForm((current) => ({ ...current, isPurchased: event.target.checked }))
                          }
                        />
                        <span>Закупной</span>
                      </label>
                      {productCostTypeForm.isPurchased ? (
                        <label className="product-cost-field">
                          <span>Себестоимость</span>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={productCostTypeForm.purchaseCost}
                            placeholder="0"
                            onChange={(event) =>
                              setProductCostTypeForm((current) => ({ ...current, purchaseCost: event.target.value }))
                            }
                          />
                        </label>
                      ) : (
                        <>
                          <label className="product-cost-field">
                            <span>Упаковка</span>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={productCostTypeForm.packagingCost}
                              placeholder="0"
                              onChange={(event) =>
                                setProductCostTypeForm((current) => ({ ...current, packagingCost: event.target.value }))
                              }
                            />
                          </label>
                          <label className="product-cost-field">
                            <span>Производство</span>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={productCostTypeForm.productionCost}
                              placeholder="0"
                              onChange={(event) =>
                                setProductCostTypeForm((current) => ({ ...current, productionCost: event.target.value }))
                              }
                            />
                          </label>
                        </>
                      )}
                      <button type="button" disabled={productCostTypeSaving} onClick={() => void saveProductCostType()}>
                        {productCostTypeSaving ? 'Сохраняем...' : 'Добавить тип'}
                      </button>
                    </div>
                  </div>
                )}

                <div className="product-cost-total">
                  <span>Себестоимость</span>
                  <strong>
                    {(() => {
                      const total = getProductCostFormTotal()
                      return total ? formatMoney(total, productCostModalProduct.currencyCode || 'KZT') : '-'
                    })()}
                  </strong>
                </div>

                {(() => {
                  const salePrice = Number(productCostModalProduct.price || 0)
                  const costTotal = getProductCostFormTotal()
                  const payout = salePrice > 0 ? salePrice * 0.55 : null
                  const profit = payout !== null && costTotal !== null ? payout - costTotal : null
                  const margin = salePrice > 0 && profit !== null ? (profit / salePrice) * 100 : null
                  const moneyCurrency = productCostModalProduct.currencyCode || 'KZT'

                  return (
                    <div className="product-cost-margin">
                      <div className="product-cost-margin-item">
                        <span>К получение после продажи</span>
                        <strong>{payout !== null ? formatMoney(payout, moneyCurrency) : '-'}</strong>
                      </div>
                      <div className="product-cost-margin-item">
                        <span>Чистая с продажи</span>
                        <strong className={profit !== null && profit < 0 ? 'negative' : 'positive'}>
                          {profit !== null ? formatMoney(profit, moneyCurrency) : '-'}
                        </strong>
                      </div>
                      <div className="product-cost-margin-item">
                        <span>Маржинальность</span>
                        <strong className={margin !== null && margin < 0 ? 'negative' : 'positive'}>
                          {margin !== null
                            ? `${margin.toLocaleString('ru-RU', {
                                minimumFractionDigits: 1,
                                maximumFractionDigits: 1,
                              })}%`
                            : '-'}
                        </strong>
                      </div>
                    </div>
                  )
                })()}

                {productCostStatus && <p className="product-cost-status">{productCostStatus}</p>}

                <div className="product-cost-actions">
                  <p className="product-cost-note">
                    Данные приблизительные. Могут отличаться в зависимости от стоимости логистики Ozon
                  </p>
                  <button type="button" className="secondary" onClick={() => setProductCostModalProduct(null)}>
                    Закрыть
                  </button>
                  {hasFeature('products.edit') && (
                    <button type="button" disabled={productCostSaving} onClick={() => void saveProductCostProfile()}>
                      {productCostSaving ? 'Сохраняем...' : 'Сохранить'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

      {productCostTypeEditModalOpen && productCostTypeEditForm.id && (
        <div className="modal-backdrop product-cost-type-backdrop" role="presentation">
              <div className="modal-card product-cost-modal product-cost-type-modal">
                <div className="modal-title-row">
                  <div>
                    <h3>Редактировать тип себестоимости</h3>
                    <p className="product-cost-subtitle">{productCostTypeEditForm.name}</p>
                  </div>
                  <button type="button" onClick={closeProductCostTypeEditModal}>
                    Закрыть
                  </button>
                </div>

                <div className="product-cost-type-modal-body">
                  <label className="product-cost-field">
                    <span>Название типа</span>
                    <input
                      type="text"
                      value={productCostTypeEditForm.name}
                      onChange={(event) => setProductCostTypeEditForm((current) => ({ ...current, name: event.target.value }))}
                    />
                  </label>

                  <label className="product-cost-purchase-toggle product-cost-type-toggle">
                    <input
                      type="checkbox"
                      checked={productCostTypeEditForm.isPurchased}
                      onChange={(event) =>
                        setProductCostTypeEditForm((current) => ({ ...current, isPurchased: event.target.checked }))
                      }
                    />
                    <span>Закупной</span>
                  </label>

                  {productCostTypeEditForm.isPurchased ? (
                    <label className="product-cost-field">
                      <span>Себестоимость</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={productCostTypeEditForm.purchaseCost}
                        placeholder="0"
                        onChange={(event) =>
                          setProductCostTypeEditForm((current) => ({ ...current, purchaseCost: event.target.value }))
                        }
                      />
                    </label>
                  ) : (
                    <div className="product-cost-grid">
                      <label className="product-cost-field">
                        <span>Упаковка</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={productCostTypeEditForm.packagingCost}
                          placeholder="0"
                          onChange={(event) =>
                            setProductCostTypeEditForm((current) => ({ ...current, packagingCost: event.target.value }))
                          }
                        />
                      </label>
                      <label className="product-cost-field">
                        <span>Производство</span>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={productCostTypeEditForm.productionCost}
                          placeholder="0"
                          onChange={(event) =>
                            setProductCostTypeEditForm((current) => ({ ...current, productionCost: event.target.value }))
                          }
                        />
                      </label>
                    </div>
                  )}

                  <div className="product-cost-total">
                    <span>Себестоимость</span>
                    <strong>
                      {(() => {
                        const total = productCostTypeEditForm.isPurchased
                          ? parseCostInput(productCostTypeEditForm.purchaseCost)
                          : (parseCostInput(productCostTypeEditForm.packagingCost) ?? 0) +
                            (parseCostInput(productCostTypeEditForm.productionCost) ?? 0)

                        return total ? formatMoney(total, productCostModalProduct?.currencyCode || 'KZT') : '-'
                      })()}
                    </strong>
                  </div>

                  {productCostStatus && <p className="product-cost-status">{productCostStatus}</p>}
                </div>

                <div className="product-cost-actions">
                  <button type="button" className="secondary" onClick={closeProductCostTypeEditModal}>
                    Закрыть
                  </button>
                  <button type="button" disabled={productCostTypeSaving} onClick={() => void saveProductCostTypeEdit()}>
                    {productCostTypeSaving ? 'Сохраняем...' : 'Сохранить'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  )
}

function CompactProductionPathsPanel({ paths }: { paths: ProductionFilePath[] }) {
  if (paths.length === 0) {
    return null
  }

  return (
    <details className="compact-paths-panel">
      <summary>
        Пути ({paths.length})
      </summary>
      <ProductionPathsPanel paths={paths} showCopy />
    </details>
  )
}

function isProductAlreadyInDraftTask(
  draftItems: DraftTaskItem[],
  product: { ozonProductId?: number; productId?: number; offerId?: string },
) {
  return draftItems.some((item) => matchesProductionCatalogProduct(item, product))
}

function normalizeUserId(value?: string | null) {
  return (value ?? '').trim().toLowerCase()
}

function normalizeApiUser(raw: User & { Id?: string }): User {
  return {
    ...raw,
    id: String(raw.id ?? raw.Id ?? ''),
  }
}

function normalizeApiGroupMember(raw: ChatGroupMember & { UserId?: string }): ChatGroupMember {
  return {
    ...raw,
    userId: String(raw.userId ?? raw.UserId ?? ''),
  }
}

function normalizeApiThread(raw: ChatThread & { Id?: string; CreatedByUserId?: string; Members?: ChatGroupMember[] }): ChatThread {
  return {
    ...raw,
    id: String(raw.id ?? raw.Id ?? ''),
    createdByUserId: raw.createdByUserId ?? raw.CreatedByUserId
      ? String(raw.createdByUserId ?? raw.CreatedByUserId)
      : undefined,
    members: raw.members ?? raw.Members
      ? (raw.members ?? raw.Members ?? []).map(normalizeApiGroupMember)
      : undefined,
  }
}

function isSameUserId(left?: string | null, right?: string | null) {
  const normalizedLeft = normalizeUserId(left)
  const normalizedRight = normalizeUserId(right)
  return normalizedLeft !== '' && normalizedLeft === normalizedRight
}

function isSameChatId(left?: string | null, right?: string | null) {
  return isSameUserId(left, right)
}

function normalizeApiChatMessage(
  raw: ChatMessage & {
    Id?: string
    GroupId?: string
    SenderId?: string
    SenderDisplayName?: string
    ReceiverId?: string
    AttachmentFileName?: string
    AttachmentContentType?: string
    HasAttachment?: boolean
    CreatedAt?: string
    IsOwn?: boolean
  },
): ChatMessage {
  return {
    ...raw,
    id: String(raw.id ?? raw.Id ?? ''),
    groupId: raw.groupId ?? raw.GroupId ? String(raw.groupId ?? raw.GroupId) : undefined,
    senderId: String(raw.senderId ?? raw.SenderId ?? ''),
    senderDisplayName: raw.senderDisplayName ?? raw.SenderDisplayName,
    receiverId: raw.receiverId ?? raw.ReceiverId ? String(raw.receiverId ?? raw.ReceiverId) : undefined,
    attachmentFileName: raw.attachmentFileName ?? raw.AttachmentFileName ?? '',
    attachmentContentType: raw.attachmentContentType ?? raw.AttachmentContentType ?? '',
    hasAttachment: raw.hasAttachment ?? raw.HasAttachment ?? false,
    createdAt: raw.createdAt ?? raw.CreatedAt ?? '',
    isOwn: raw.isOwn ?? raw.IsOwn ?? false,
  }
}

function isActiveChatMessageEvent(
  senderId: string,
  receiverId: string | null,
  groupId: string | null,
  chatType: 'user' | 'group',
  chatId: string,
) {
  if (!chatId) {
    return false
  }

  if (groupId) {
    return chatType === 'group' && isSameChatId(groupId, chatId)
  }

  return (
    chatType === 'user' &&
    (isSameUserId(senderId, chatId) || isSameUserId(receiverId, chatId))
  )
}

function getSupplyItemImageUrl(ozonProducts: OzonProduct[], item: DraftSupplyItem) {
  if (item.imageUrl) {
    return item.imageUrl
  }

  if (item.ozonProductId) {
    return ozonProducts.find((product) => product.productId === item.ozonProductId)?.imageUrl
  }

  if (item.offerId) {
    return ozonProducts.find((product) => product.offerId === item.offerId)?.imageUrl
  }

  return undefined
}

function getAnalyticsProductImageUrl(
  productImages: Map<string, string>,
  product: { sku: number; offerId: string },
) {
  if (product.sku) {
    const bySku = productImages.get(`sku:${product.sku}`)
    if (bySku) {
      return bySku
    }
  }

  if (product.offerId) {
    return productImages.get(`offer:${product.offerId}`)
  }

  return undefined
}

function getTaskNotificationStorageKey(
  userId: string,
  kind: 'new' | 'in-progress' | 'cancelled' | 'completed',
) {
  return `lshop:${userId}:seen-production-${kind}-tasks`
}

function getSupplyNotificationStorageKey(userId: string) {
  return `lshop:${userId}:seen-supplies`
}

function getSupplyAnalyticsNotificationStorageKey(userId: string) {
  return `lshop:${userId}:seen-supply-analytics`
}

function getSupplyAnalyticsRowKey(item: SupplyAnalyticsItem) {
  return item.id
}

function renderTabBadge(count: number) {
  if (count <= 0) {
    return null
  }

  return <span className="tab-badge">{count > 99 ? '99+' : count}</span>
}

function readStringListFromStorage(key: string) {
  try {
    const value = localStorage.getItem(key)
    const parsed = value ? JSON.parse(value) : []
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === 'string') : []
  } catch {
    return []
  }
}

function parseApiErrorMessage(raw: string) {
  const text = raw.trim()
  if (!text) {
    return ''
  }

  try {
    const parsed = JSON.parse(text) as Record<string, unknown>
    const direct =
      parsed.detail ?? parsed.title ?? parsed.message ?? parsed.error ?? parsed.Error

    if (typeof direct === 'string' && direct.trim()) {
      return direct.trim()
    }
  } catch {
    // Plain text response from Results.BadRequest("...").
  }

  return text
}

function isImageAttachment(message: ChatMessage) {
  if (message.attachmentContentType.toLowerCase().startsWith('image/')) {
    return true
  }

  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(message.attachmentFileName)
}

const chatAttachmentUrlCache = new Map<string, string>()

function ChatAttachmentPreview({
  message,
  token,
  onDownload,
}: {
  message: ChatMessage
  token: string
  onDownload: (message: ChatMessage) => void
}) {
  const [src, setSrc] = useState<string | null>(() => chatAttachmentUrlCache.get(message.id) ?? null)
  const [loading, setLoading] = useState(isImageAttachment(message) && !chatAttachmentUrlCache.has(message.id))

  useEffect(() => {
    if (!isImageAttachment(message) || !token) {
      return
    }

    const cached = chatAttachmentUrlCache.get(message.id)
    if (cached) {
      setSrc(cached)
      setLoading(false)
      return
    }

    let cancelled = false
    setLoading(true)

    fetch(`/api/chat/messages/${message.id}/attachment`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error('attachment load failed')
        }

        return response.blob()
      })
      .then((blob) => {
        if (cancelled) {
          return
        }

        const url = URL.createObjectURL(blob)
        chatAttachmentUrlCache.set(message.id, url)
        setSrc(url)
      })
      .catch(() => {
        if (!cancelled) {
          setSrc(null)
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [message.id, token])

  if (isImageAttachment(message)) {
    return (
      <button
        type="button"
        className="chat-image-attachment"
        onClick={() => {
          if (src) {
            window.open(src, '_blank', 'noopener,noreferrer')
          }
        }}
        disabled={!src}
        title={message.attachmentFileName || 'Открыть изображение'}
      >
        {src ? (
          <img src={src} alt={message.attachmentFileName || 'Изображение в чате'} />
        ) : (
          <span>{loading ? 'Загрузка…' : 'Не удалось показать изображение'}</span>
        )}
      </button>
    )
  }

  return (
    <button type="button" className="chat-attachment" onClick={() => onDownload(message)}>
      <span>Файл</span>
      <strong>{message.attachmentFileName}</strong>
    </button>
  )
}

function getProductSupplySummary(
  ozonProductId: number,
  offerId: string,
  supplies: Supply[],
) {
  let createdQuantity = 0
  let sentQuantity = 0

  for (const supply of supplies) {
    if (supply.isArchived || (supply.status !== 'Created' && supply.status !== 'Sent')) {
      continue
    }

    for (const item of supply.items) {
      if (item.isReserve) {
        continue
      }

      const matchesProduct =
        (item.ozonProductId != null && item.ozonProductId === ozonProductId) ||
        (item.offerId.trim() !== '' &&
          offerId.trim() !== '' &&
          item.offerId.trim().toLowerCase() === offerId.trim().toLowerCase())

      if (!matchesProduct) {
        continue
      }

      if (supply.status === 'Created') {
        createdQuantity += item.quantity
      } else {
        sentQuantity += item.quantity
      }
    }
  }

  return { createdQuantity, sentQuantity }
}

function formatProductSupplyHint(summary: { createdQuantity: number; sentQuantity: number }) {
  const parts: string[] = []

  if (summary.createdQuantity > 0) {
    parts.push(`${summary.createdQuantity} шт. собирается на отправку`)
  }

  if (summary.sentQuantity > 0) {
    parts.push(`${summary.sentQuantity} шт. уже в пути`)
  }

  return parts.join(', ')
}

function buildAnalyticsExportRows(rows: OzonAnalytics['orderRows']) {
  const header = [
    'Товар',
    'Артикул',
    'SKU',
    'Статус',
    'Номер отправления',
    'Кол-во',
    'Выручка',
    'Комиссия %',
    'Комиссия',
    'К выплате',
    'Логистика',
    'Валюта',
    'Дата',
  ]

  const data = rows.map((row) => [
    row.productName,
    row.offerId,
    row.sku ? String(row.sku) : '',
    translateStatus(normalizeOrderStatus(row.status)),
    row.postingNumber,
    String(row.quantity),
    String(row.revenue),
    String(row.commissionPercent),
    String(row.commissionAmount),
    String(row.payout),
    String(row.logisticsAmount),
    row.currencyCode,
    row.operationDate ? formatDateTime(row.operationDate) : '',
  ])

  return [header, ...data]
}

function getAnalyticsProductKey(row: OzonAnalytics['rows'][number]) {
  return row.sku ? `sku:${row.sku}` : `name:${row.productName}`
}

type AnalyticsProductGroup = {
  key: string
  sku: number
  offerId: string
  productName: string
  status: string
  isCancelledOnly: boolean
  quantity: number
  revenue: number
  commissionPercent: number
  commissionAmount: number
  logisticsAmount: number
  payout: number
  currencyCode: string
  ordersCount: number
  byDate: Array<{
    date: string
    quantity: number
    revenue: number
    commissionAmount: number
    logisticsAmount: number
    payout: number
    rows: OzonAnalytics['rows']
  }>
}

function groupAnalyticsProducts(rows: OzonAnalytics['rows']): AnalyticsProductGroup[] {
  const groups = new Map<string, OzonAnalytics['rows']>()

  for (const row of rows) {
    const key = getAnalyticsProductKey(row)
    const list = groups.get(key) ?? []
    list.push(row)
    groups.set(key, list)
  }

  return Array.from(groups.entries())
    .map(([key, productRows]) => {
      const first = productRows[0]
      const revenue = productRows.reduce((sum, row) => sum + row.revenue, 0)
      const commissionAmount = productRows.reduce((sum, row) => sum + row.commissionAmount, 0)
      const logisticsAmount = productRows.reduce((sum, row) => sum + row.logisticsAmount, 0)
      const payout = productRows.reduce((sum, row) => sum + row.payout, 0)
      const quantity = productRows.reduce((sum, row) => sum + row.quantity, 0)
      const byDateMap = new Map<string, OzonAnalytics['rows']>()

      for (const row of productRows) {
        const dateKey = getAnalyticsRowDateKey(row)
        const dateRows = byDateMap.get(dateKey) ?? []
        dateRows.push(row)
        byDateMap.set(dateKey, dateRows)
      }

      const byDate = Array.from(byDateMap.entries())
        .sort(([leftDate], [rightDate]) => rightDate.localeCompare(leftDate))
        .map(([date, dateRows]) => ({
          date,
          quantity: dateRows.reduce((sum, row) => sum + row.quantity, 0),
          revenue: dateRows.reduce((sum, row) => sum + row.revenue, 0),
          commissionAmount: dateRows.reduce((sum, row) => sum + row.commissionAmount, 0),
          logisticsAmount: dateRows.reduce((sum, row) => sum + row.logisticsAmount, 0),
          payout: dateRows.reduce((sum, row) => sum + row.payout, 0),
          rows: dateRows.sort((left, right) => right.operationDate.localeCompare(left.operationDate)),
        }))

      return {
        key,
        sku: first.sku,
        offerId: first.offerId,
        productName: first.productName,
        isCancelledOnly: productRows.every((row) => normalizeOrderStatus(row.status) === 'cancelled'),
        status: (() => {
          const statuses = [...new Set(productRows.map((row) => normalizeOrderStatus(row.status)))]
          if (statuses.length === 1) {
            return translateStatus(statuses[0])
          }

          return statuses.map((status) => translateStatus(status)).join(' · ')
        })(),
        quantity,
        revenue,
        commissionPercent: resolveCommissionPercent(productRows, commissionAmount),
        commissionAmount,
        logisticsAmount,
        payout,
        currencyCode: first.currencyCode || 'KZT',
        ordersCount: productRows.length,
        byDate,
      }
    })
    .sort((left, right) => right.revenue - left.revenue)
}

function getAnalyticsRowDateKey(row: OzonAnalytics['rows'][number]) {
  const normalized = row.operationDate?.trim().slice(0, 10)
  return normalized && normalized !== '—' ? normalized : 'unknown'
}

function buildFilteredAnalytics(
  analytics: OzonAnalytics | null,
  rows: OzonAnalytics['rows'],
): OzonAnalytics | null {
  if (!analytics) {
    return null
  }

  const normalizedRows = rows.map((row) => ({
    ...row,
    status: normalizeOrderStatus(row.status),
  }))
  const activeRows = normalizedRows.filter((row) => row.status !== 'cancelled')
  const awaitingRows = normalizedRows.filter((row) => row.status === 'awaiting_deliver')
  const deliveringRows = normalizedRows.filter((row) => row.status === 'delivering')
  const deliveredRows = normalizedRows.filter((row) => row.status === 'delivered')
  const cancelledRows = normalizedRows.filter((row) => row.status === 'cancelled')
  const inTransitRows = [...awaitingRows, ...deliveringRows]
  const cancelledLogisticsTotal = sumAnalyticsRows(cancelledRows, 'logisticsAmount')

  return {
    ...analytics,
    rows,
    orderRows: rows,
    topProducts: buildTopProductsFromRows(activeRows, analytics.topProducts),
    orderedUnitsTotal: sumAnalyticsRows(normalizedRows, 'quantity'),
    revenueTotal: analytics.revenueTotal,
    commissionTotal: analytics.commissionTotal,
    payoutTotal: analytics.payoutTotal,
    logisticsTotal: analytics.logisticsTotal,
    servicesTotal: analytics.servicesTotal,
    awaitingDeliverCount: countDistinctPostings(awaitingRows),
    awaitingDeliverAmount: sumAnalyticsRows(awaitingRows, 'revenue'),
    deliveringCount: countDistinctPostings(deliveringRows),
    deliveredCount: countDistinctPostings(deliveredRows),
    salesTotalCount: countDistinctPostings(normalizedRows),
    salesAmountTotal: sumAnalyticsRows(normalizedRows, 'revenue'),
    inTransitCount: sumAnalyticsRows(inTransitRows, 'quantity'),
    inTransitAmount: sumAnalyticsRows(inTransitRows, 'revenue'),
    deliveredProductCount: sumAnalyticsRows(deliveredRows, 'quantity'),
    deliveredAmount: sumAnalyticsRows(deliveredRows, 'revenue'),
    cancelledCount: countDistinctPostings(cancelledRows),
    cancelledAmount: sumAnalyticsRows(cancelledRows, 'revenue'),
    cancelledLogisticsTotal,
    cancelledMissedProfitTotal: sumAnalyticsRows(cancelledRows, 'revenue') - cancelledLogisticsTotal,
  }
}

function sumAnalyticsRows(
  rows: OzonAnalytics['rows'],
  field: 'quantity' | 'revenue' | 'commissionAmount' | 'payout' | 'logisticsAmount',
) {
  return rows.reduce((sum, row) => sum + (Number.isFinite(row[field]) ? row[field] : 0), 0)
}

function countDistinctPostings(rows: OzonAnalytics['rows']) {
  const keys = new Set<string>()

  rows.forEach((row, index) => {
    keys.add(row.postingNumber?.trim() || `${row.offerId || row.productName}-${row.operationDate}-${index}`)
  })

  return keys.size
}

function buildTopProductsFromRows(
  rows: OzonAnalytics['rows'],
  sourceTopProducts: OzonAnalytics['topProducts'],
): OzonAnalytics['topProducts'] {
  const sourceByKey = new Map<string, OzonAnalytics['topProducts'][number]>()

  sourceTopProducts.forEach((product) => {
    sourceByKey.set(product.offerId || String(product.sku), product)
  })

  return groupAnalyticsProducts(rows)
    .map((group) => {
      const source = sourceByKey.get(group.offerId || String(group.sku))

      return {
        sku: group.sku,
        offerId: group.offerId,
        productName: group.productName,
        quantity: group.quantity,
        revenue: group.revenue,
        currencyCode: group.currencyCode,
        stockTotal: source?.stockTotal ?? 0,
      }
    })
    .sort((left, right) => right.quantity - left.quantity || right.revenue - left.revenue)
}

function getAnalyticsRevenueLabel(isCancelled: boolean) {
  return isCancelled ? 'Упущенная сумма заказа' : 'Сумма заказа'
}

function resolveCommissionPercent(rows: OzonAnalytics['rows'], commissionAmount: number) {
  const commissionedRows = rows.filter((row) => row.commissionAmount > 0)
  if (commissionedRows.length === 0) {
    return 0
  }

  const withApiPercent = commissionedRows.filter((row) => row.commissionPercent > 0)
  if (withApiPercent.length > 0) {
    const uniquePercents = [...new Set(withApiPercent.map((row) => row.commissionPercent))]
    if (uniquePercents.length === 1) {
      return uniquePercents[0]
    }

    const weightedTotal = withApiPercent.reduce(
      (sum, row) => sum + row.commissionPercent * row.commissionAmount,
      0,
    )
    const totalCommission = withApiPercent.reduce((sum, row) => sum + row.commissionAmount, 0)
    if (totalCommission > 0) {
      return Math.round((weightedTotal / totalCommission) * 100) / 100
    }

    return withApiPercent[0].commissionPercent
  }

  const commissionedRevenue = commissionedRows.reduce((sum, row) => sum + row.revenue, 0)
  if (commissionedRevenue > 0 && commissionAmount > 0) {
    return Math.round((commissionAmount / commissionedRevenue) * 10000) / 100
  }

  return 0
}

function formatCommissionDisplay(amount: number, percent: number, currency: string) {
  if (amount <= 0) {
    return '—'
  }

  const formattedAmount = formatLossMoney(amount, currency)
  return percent > 0 ? `${percent}% · ${formattedAmount}` : formattedAmount
}

function AnalyticsProductGroupCard({
  group,
  imageUrl,
  expanded,
  onToggle,
  onExport,
}: {
  group: AnalyticsProductGroup
  imageUrl?: string
  expanded: boolean
  onToggle: () => void
  onExport: () => void
}) {
  const revenueLabel = getAnalyticsRevenueLabel(group.isCancelledOnly)

  return (
    <section className={`analytics-product-card ${expanded ? 'expanded' : ''}`}>
      <div className="analytics-product-card-head">
        <button type="button" className="analytics-product-card-toggle" onClick={onToggle}>
        <div className="analytics-product-card-main">
          <span className="analytics-product-chevron" aria-hidden="true">
            {expanded ? '▾' : '▸'}
          </span>
          {imageUrl && (
            <ProductImageHoverPreview imageUrl={imageUrl} name={group.productName}>
              <ProductThumb imageUrl={imageUrl} name={group.productName} />
            </ProductImageHoverPreview>
          )}
          <div className="analytics-product-info">
            <strong className="analytics-product-title">{group.productName}</strong>
            <small>
              SKU {group.sku || '—'}
              {group.offerId ? ` · ${group.offerId}` : ''}
              {' · '}
              {group.ordersCount} заказ(ов) · {group.quantity} шт.
              {' · '}
              {group.status}
            </small>
          </div>
        </div>
        <div className="analytics-product-metrics">
          <div className="analytics-metric">
            <span>{revenueLabel}</span>
            <strong>{formatMoney(group.revenue, group.currencyCode)}</strong>
          </div>
          <div className="analytics-metric analytics-metric-loss">
            <span>Комиссия</span>
            <strong>
              {formatCommissionDisplay(group.commissionAmount, group.commissionPercent, group.currencyCode)}
            </strong>
          </div>
          <div className="analytics-metric analytics-metric-loss">
            <span>Логистика</span>
            <strong>{formatLossMoney(group.logisticsAmount, group.currencyCode)}</strong>
          </div>
          <div className="analytics-metric">
            <span>К выплате</span>
            <strong>{formatMoney(group.payout, group.currencyCode)}</strong>
          </div>
        </div>
        </button>
      </div>
      {expanded && (
        <div className="analytics-product-card-body">
          <div className="analytics-card-export-row">
            <button
              type="button"
              className="analytics-card-export"
              title="Выгрузить Excel по товару"
              onClick={onExport}
            >
              Excel
            </button>
          </div>
          {group.byDate.map((dateGroup) => {
            const dateGroupCancelledOnly = dateGroup.rows.every(
              (row) => normalizeOrderStatus(row.status) === 'cancelled',
            )
            const dateRevenueLabel = getAnalyticsRevenueLabel(dateGroupCancelledOnly)

            return (
            <div className="analytics-date-group" key={`${group.key}-${dateGroup.date}`}>
              <div className="analytics-date-group-head">
                <strong>{formatAnalyticsDate(dateGroup.date)}</strong>
                <span>
                  {dateGroup.rows.length} заказ(ов) · {dateGroup.quantity} шт. ·{' '}
                  {formatMoney(dateGroup.revenue, group.currencyCode)}
                  {' · '}
                  комиссия{' '}
                  {formatCommissionDisplay(
                    dateGroup.commissionAmount,
                    resolveCommissionPercent(dateGroup.rows, dateGroup.commissionAmount),
                    group.currencyCode,
                  )}
                </span>
              </div>
              <div className="analytics-order-list-head">
                <span>Р—Р°РєР°Р·</span>
                <span>{dateRevenueLabel}</span>
                <span>Комиссия</span>
                <span>Логистика</span>
                <span>К выплате</span>
              </div>
              <div className="analytics-order-list">
                {dateGroup.rows.map((row) => {
                  const rowCancelled = normalizeOrderStatus(row.status) === 'cancelled'
                  const rowCommissionPercent =
                    row.commissionPercent > 0
                      ? row.commissionPercent
                      : row.revenue > 0 && row.commissionAmount > 0
                        ? Math.round((row.commissionAmount / row.revenue) * 10000) / 100
                        : 0

                  return (
                  <div className="analytics-order-row" key={`${row.postingNumber}-${row.sku}-${row.operationDate}`}>
                    <div className="analytics-order-main">
                      <strong>{row.postingNumber || 'Без номера'}</strong>
                      <small>
                        <span className={`analytics-status-badge status-${normalizeOrderStatus(row.status)}`}>
                          {translateStatus(normalizeOrderStatus(row.status))}
                        </span>
                        {' · '}
                        {row.quantity} шт.
                      </small>
                    </div>
                    <div className="analytics-order-metric">
                      <span>{getAnalyticsRevenueLabel(rowCancelled)}</span>
                      <strong>{formatMoney(row.revenue, row.currencyCode || 'KZT')}</strong>
                    </div>
                    <div className="analytics-order-metric analytics-metric-loss">
                      <span>Комиссия</span>
                      <strong>
                        {formatCommissionDisplay(
                          row.commissionAmount,
                          rowCommissionPercent,
                          row.currencyCode || 'KZT',
                        )}
                      </strong>
                    </div>
                    <div className="analytics-order-metric analytics-metric-loss">
                      <span>Логистика</span>
                      <strong>{formatLossMoney(row.logisticsAmount, row.currencyCode || 'KZT')}</strong>
                    </div>
                    <div className="analytics-order-metric">
                      <span>К выплате</span>
                      <strong>{formatMoney(row.payout, row.currencyCode || 'KZT')}</strong>
                    </div>
                  </div>
                  )
                })}
              </div>
            </div>
            )
          })}
        </div>
      )}
    </section>
  )
}


function ProductTypeEditorPanel({
  token,
  novinkaProducts,
  catalogProducts,
  selectedNovinkaOfferId,
  selectedCatalogProductId,
  onNovinkaOfferIdChange,
  onCatalogProductIdChange,
  selectedNovinka,
  selectedCatalogProduct,
  status,
  saving,
  onConvert,
  onRefreshCatalogProducts,
  productionFiles,
  productionFilePaths,
  onRefreshProductionData,
  onDownloadFile,
  onDeleteFile,
  shopRegion,
  kzMarketplace,
  kzProducts,
  onKzMarketplaceChange,
}: {
  token: string
  novinkaProducts: ProductionCatalogItem[]
  catalogProducts: OzonProduct[]
  selectedNovinkaOfferId: string
  selectedCatalogProductId: string
  onNovinkaOfferIdChange: (offerId: string) => void
  onCatalogProductIdChange: (productId: string) => void
  selectedNovinka?: ProductionCatalogItem
  selectedCatalogProduct?: OzonProduct
  status: string
  saving: boolean
  onConvert: () => void
  onRefreshCatalogProducts: () => void
  productionFiles: ProductionFile[]
  productionFilePaths: ProductionFilePath[]
  onRefreshProductionData: () => Promise<void>
  onDownloadFile: (id: string) => void
  onDeleteFile?: (id: string) => void
  shopRegion: ShopRegion
  kzMarketplace: KzMarketplace
  kzProducts: Record<KzMarketplace, OzonProduct[]>
  onKzMarketplaceChange: (marketplace: KzMarketplace) => void
}) {
  const catalogLabel = shopRegion === 'rf' ? 'Ozon' : getKzMarketplaceLabel(kzMarketplace)

  return (
    <>
      <div className="section-title soft-title">
        <div>
          <h2>Редактор товаров</h2>
          <p>
            {shopRegion === 'rf'
              ? 'Измените тип «Новинка» на «Ozon». Превью останется на товаре.'
              : 'Измените тип «Новинка» на товар маркетплейса KZ. Превью останется на товаре.'}
          </p>
        </div>
      </div>

      <div className="product-type-editor-layout">
        <div className="supply-form-block supply-form-block-novinka product-type-editor-block">
          <strong>Новинка</strong>
          <span className="product-type-editor-hint">Выберите товар из списка новинок</span>
          <NovinkaSearchInput
            listId="product-editor-novinka-list"
            products={novinkaProducts}
            selectedOfferId={selectedNovinkaOfferId}
            onOfferIdChange={onNovinkaOfferIdChange}
            placeholder="Начните писать название или артикул"
            showClearButton
          />
          <div className="product-type-editor-preview">
            {selectedNovinka ? (
              <NovinkaProductPreview item={selectedNovinka} token={token} />
            ) : (
              <div className="task-form-modal-preview task-form-modal-preview-empty">
                <span>Выберите новинку для превью</span>
              </div>
            )}
          </div>
        </div>

        <div className="product-type-editor-divider" aria-hidden="true" />

        <div className="supply-form-block supply-form-block-ozon product-type-editor-block">
          {shopRegion === 'kz' && (
            <KzMarketplaceTabs
              activeMarketplace={kzMarketplace}
              onChange={(marketplace) => {
                onKzMarketplaceChange(marketplace)
                onCatalogProductIdChange('')
              }}
            />
          )}
          <strong>Товар {catalogLabel}</strong>
          <span className="product-type-editor-hint">
            {shopRegion === 'rf'
              ? 'Выберите соответствующий товар из каталога Ozon'
              : `Выберите товар из каталога ${getKzMarketplaceLabel(kzMarketplace)}`}
          </span>
          <ProductSearchInput
            listId="product-editor-catalog-list"
            products={catalogProducts}
            selectedProductId={selectedCatalogProductId}
            onProductIdChange={onCatalogProductIdChange}
            placeholder="Начните писать название или артикул"
            hideInlinePreview
            showClearButton
          />
          <div className="product-type-editor-preview">
            {selectedCatalogProduct ? (
              <TaskProductPreview product={selectedCatalogProduct} />
            ) : (
              <div className="task-form-modal-preview task-form-modal-preview-empty">
                <span>Выберите товар {catalogLabel} для превью</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="supply-create-bar product-type-editor-footer">
        <button
          type="button"
          disabled={!selectedNovinka || !selectedCatalogProduct || saving}
          onClick={onConvert}
        >
          {saving ? 'Сохранение...' : `Изменить тип на ${catalogLabel}`}
        </button>
        <button type="button" className="product-type-editor-secondary" onClick={onRefreshCatalogProducts}>
          {shopRegion === 'rf' ? 'Обновить список Ozon' : `Обновить список ${getKzMarketplaceLabel(kzMarketplace)}`}
        </button>
        {status && <p className="modal-status">{status}</p>}
      </div>

      <ProductCatalogFilesEditor
        token={token}
        novinkaProducts={novinkaProducts}
        catalogProducts={shopRegion === 'rf' ? catalogProducts : kzProducts[kzMarketplace]}
        kzProducts={kzProducts}
        productionFiles={productionFiles}
        productionFilePaths={productionFilePaths}
        onRefreshProductionData={onRefreshProductionData}
        onDownloadFile={onDownloadFile}
        onDeleteFile={onDeleteFile}
        shopRegion={shopRegion}
        kzMarketplace={kzMarketplace}
      />
    </>
  )
}



function UserProfileModal({
  profileUser,
  isOwnProfile,
  profileForm,
  setProfileForm,
  profileAvatar,
  setProfileAvatar,
  profileStatus,
  profilePasswordForm,
  setProfilePasswordForm,
  onClose,
  onSaveProfile,
  onUploadAvatar,
  onChangePassword,
}: {
  profileUser: User
  isOwnProfile: boolean
  profileForm: { displayName: string; position: string }
  setProfileForm: Dispatch<SetStateAction<{ displayName: string; position: string }>>
  profileAvatar: File | null
  setProfileAvatar: Dispatch<SetStateAction<File | null>>
  profileStatus: string
  profilePasswordForm: { currentPassword: string; newPassword: string; confirmPassword: string }
  setProfilePasswordForm: Dispatch<
    SetStateAction<{ currentPassword: string; newPassword: string; confirmPassword: string }>
  >
  onClose: () => void
  onSaveProfile: (event: FormEvent<HTMLFormElement>) => void
  onUploadAvatar: () => void
  onChangePassword: (event: FormEvent<HTMLFormElement>) => void
}) {
  const displayName = profileUser.displayName || profileUser.userName

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-card user-profile-modal"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-title-row">
          <h3>{isOwnProfile ? 'Моя карточка' : 'Карточка пользователя'}</h3>
          <button type="button" onClick={onClose}>
            Закрыть
          </button>
        </div>
        <div className="profile-card">
          {isOwnProfile ? (
            <label className="profile-avatar profile-avatar-upload">
              {profileUser.avatarUrl ? (
                <ProductImageHoverPreview imageUrl={profileUser.avatarUrl} name={displayName}>
                  <img src={profileUser.avatarUrl} alt={displayName} />
                </ProductImageHoverPreview>
              ) : (
                <span>Загрузить фото</span>
              )}
              <input
                type="file"
                accept="image/*"
                onChange={(event) => setProfileAvatar(event.target.files?.[0] ?? null)}
              />
            </label>
          ) : (
            <UserAvatarPreview
              avatarUrl={profileUser.avatarUrl}
              displayName={displayName}
              className="profile-avatar profile-avatar-readonly"
            />
          )}
          <div className="profile-card-info">
            <strong>{displayName}</strong>
            <small>
              {profileUser.position ||
                (isOwnProfile ? 'Должность указывает администратор' : 'Должность не указана')}
            </small>
            <small className="profile-card-meta">Логин: {profileUser.userName}</small>
            {!isOwnProfile && (
              <small className="profile-card-meta">
                {profileUser.isOnline
                  ? 'В сети'
                  : profileUser.lastSeenAt
                    ? `Был: ${formatDateTime(profileUser.lastSeenAt)}`
                    : 'Не в сети'}
              </small>
            )}
            {profileAvatar && isOwnProfile && <small>Выбрано: {profileAvatar.name}</small>}
          </div>
        </div>
        {isOwnProfile ? (
          <>
            <form className="profile-form" onSubmit={onSaveProfile}>
              <input
                placeholder="Имя"
                value={profileForm.displayName}
                onChange={(event) => setProfileForm({ ...profileForm, displayName: event.target.value })}
                required
              />
              <span className="profile-actions">
                <button type="submit">Сохранить имя</button>
                <button type="button" onClick={onUploadAvatar}>
                  Сохранить фото
                </button>
              </span>
            </form>
            <form className="profile-form profile-password-form" onSubmit={onChangePassword}>
              <h4>Смена пароля</h4>
              <input
                placeholder="Текущий пароль"
                type="password"
                value={profilePasswordForm.currentPassword}
                onChange={(event) =>
                  setProfilePasswordForm({ ...profilePasswordForm, currentPassword: event.target.value })
                }
                required
              />
              <input
                placeholder="Новый пароль"
                type="password"
                value={profilePasswordForm.newPassword}
                onChange={(event) =>
                  setProfilePasswordForm({ ...profilePasswordForm, newPassword: event.target.value })
                }
                required
              />
              <input
                placeholder="Подтверждение пароля"
                type="password"
                value={profilePasswordForm.confirmPassword}
                onChange={(event) =>
                  setProfilePasswordForm({ ...profilePasswordForm, confirmPassword: event.target.value })
                }
                required
              />
              <button type="submit">Сменить пароль</button>
            </form>
            {profileStatus && <p className="modal-status">{profileStatus}</p>}
          </>
        ) : (
          <p className="profile-readonly-note">Редактировать профиль может только сам пользователь.</p>
        )}
      </div>
    </div>
  )
}




function getSupplyNotificationSummary(supply: Supply) {
  const items = supply.items ?? []
  return items.length === 1 ? items[0].productName : `${items.length} товаров в поставке`
}

function matchesSupply(supply: Supply, search: string) {
  return [
    supply.id,
    supply.status,
    supply.createdAt,
    supply.sentAt,
    supply.acceptedAt,
    ...supply.items.flatMap((item) => [
      item.offerId,
      item.productName,
      item.quantity,
      formatSupplyItemKind(item),
    ]),
  ]
    .filter((value) => value !== undefined && value !== null)
    .some((value) => String(value).toLowerCase().includes(search))
}

function SupplyItemsModal({
  title,
  listIdPrefix,
  token,
  ozonProducts,
  novinkaProducts,
  items,
  setItems,
  productId,
  setProductId,
  quantity,
  setQuantity,
  selectedNovinkaOfferId,
  setSelectedNovinkaOfferId,
  reserveQuantity,
  setReserveQuantity,
  materialName,
  setMaterialName,
  materialQuantity,
  setMaterialQuantity,
  materialKind,
  setMaterialKind,
  onAddProduct,
  onAddReserve,
  onAddMaterial,
  onSave,
  onClose,
  allowReserveNameEdit = false,
  allowOzonProductRelink = false,
  itemsTableTitle = 'Товар в новой поставке',
  shippingCost,
  setShippingCost,
}: {
  title: string
  listIdPrefix: string
  token: string
  ozonProducts: OzonProduct[]
  novinkaProducts: ProductionCatalogItem[]
  items: DraftSupplyItem[]
  setItems: Dispatch<SetStateAction<DraftSupplyItem[]>>
  productId: string
  setProductId: Dispatch<SetStateAction<string>>
  quantity: string
  setQuantity: Dispatch<SetStateAction<string>>
  selectedNovinkaOfferId: string
  setSelectedNovinkaOfferId: Dispatch<SetStateAction<string>>
  reserveQuantity: string
  setReserveQuantity: Dispatch<SetStateAction<string>>
  materialName?: string
  setMaterialName?: Dispatch<SetStateAction<string>>
  materialQuantity?: string
  setMaterialQuantity?: Dispatch<SetStateAction<string>>
  materialKind?: Exclude<SupplyItemKind, 'Product'>
  setMaterialKind?: Dispatch<SetStateAction<Exclude<SupplyItemKind, 'Product'>>>
  onAddProduct: () => void
  onAddReserve: () => void
  onAddMaterial?: () => void
  onSave: () => void
  onClose: () => void
  allowReserveNameEdit?: boolean
  allowOzonProductRelink?: boolean
  itemsTableTitle?: string
  shippingCost?: string
  setShippingCost?: Dispatch<SetStateAction<string>>
}) {
  const selectedProduct = ozonProducts.find((item) => String(item.productId) === productId)
  const selectedNovinka = novinkaProducts.find((item) => item.offerId === selectedNovinkaOfferId)

  useEffect(() => {
    if (selectedNovinka?.packedQuantity && selectedNovinka.packedQuantity > 0) {
      setReserveQuantity(String(selectedNovinka.packedQuantity))
      return
    }

    if (!selectedNovinkaOfferId) {
      setReserveQuantity('')
    }
  }, [selectedNovinkaOfferId, selectedNovinka?.packedQuantity, setReserveQuantity])

  function relinkSupplyItemToOzon(tempId: string, nextProductId: string) {
    const product = ozonProducts.find((candidate) => String(candidate.productId) === nextProductId)
    if (!product) {
      return
    }

    setItems((current) =>
      current.map((draft) =>
        draft.tempId === tempId
          ? {
              ...draft,
              ozonProductId: product.productId,
              offerId: product.offerId,
              productName: product.name,
              imageUrl: product.imageUrl,
              isReserve: false,
              itemKind: 'Product',
            }
          : draft,
      ),
    )
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal-card modal-card-wide" role="dialog" aria-modal="true">
        <div className="modal-title-row">
          <h3>{title}</h3>
          <button type="button" onClick={onClose}>
            Закрыть
          </button>
        </div>

        <div className="supply-forms">
          <div className="supply-form-block supply-form-block-ozon">
            <strong>Товар из Ozon</strong>
            <ProductSearchInput
              listId={listIdPrefix}
              products={ozonProducts}
              selectedProductId={productId}
              onProductIdChange={setProductId}
              placeholder="Начните писать название или артикул"
              hideInlinePreview
              showClearButton
            />
            <div className="task-form-modal-compose supply-form-compose">
              {selectedProduct ? (
                <TaskProductPreview product={selectedProduct} />
              ) : (
                <div className="task-form-modal-preview task-form-modal-preview-empty">
                  <span>Выберите товар для превью</span>
                </div>
              )}
              <div className="task-form-modal-actions">
                <input
                  className="task-form-modal-qty"
                  type="number"
                  min="1"
                  placeholder="Количество"
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                />
                <button type="button" onClick={onAddProduct}>
                  Добавить
                </button>
              </div>
            </div>
          </div>

          <div className="supply-form-block supply-form-block-ozon supply-form-block-novinka">
            <strong>Упакованные товары</strong>
            <NovinkaSearchInput
              listId={`${listIdPrefix}-novinka`}
              products={novinkaProducts}
              selectedOfferId={selectedNovinkaOfferId}
              onOfferIdChange={setSelectedNovinkaOfferId}
              placeholder="Начните писать название или артикул"
              showClearButton
            />
            <div className="task-form-modal-compose supply-form-compose">
              {selectedNovinka ? (
                <NovinkaProductPreview item={selectedNovinka} token={token} />
              ) : (
                <div className="task-form-modal-preview task-form-modal-preview-empty">
                  <span>Выберите упакованный товар для превью</span>
                </div>
              )}
              <div className="task-form-modal-actions">
                <input
                  className="task-form-modal-qty"
                  type="number"
                  min="1"
                  placeholder="Количество"
                  value={reserveQuantity}
                  onChange={(event) => setReserveQuantity(event.target.value)}
                />
                {selectedNovinka?.packedQuantity ? (
                  <small className="task-product-supply-hint-inline">
                    Упаковано всего: {selectedNovinka.packedQuantity}
                  </small>
                ) : null}
                <button type="button" onClick={onAddReserve}>
                  Добавить
                </button>
              </div>
            </div>
          </div>
          {onAddMaterial && setMaterialName && setMaterialQuantity && materialKind && setMaterialKind && (
            <div className="supply-form-block supply-form-block-ozon supply-form-block-material">
              <strong>Расходники и мат. ценности</strong>
              <input
                value={materialName ?? ''}
                onChange={(event) => setMaterialName(event.target.value)}
                placeholder="Например: принтер, бумага, расходник"
              />
              <div className="task-form-modal-compose supply-form-compose">
                <div className="task-form-modal-preview task-form-modal-preview-empty">
                  <span>{materialKind === 'Consumable' ? 'Расходный материал' : 'Материальная ценность'}</span>
                </div>
                <div className="task-form-modal-actions">
                  <select
                    value={materialKind}
                    onChange={(event) =>
                      setMaterialKind(event.target.value as Exclude<SupplyItemKind, 'Product'>)
                    }
                  >
                    <option value="Consumable">Расходный материал</option>
                    <option value="MaterialAsset">Мат. ценность</option>
                  </select>
                  <input
                    className="task-form-modal-qty"
                    type="number"
                    min="1"
                    placeholder="Количество"
                    value={materialQuantity ?? ''}
                    onChange={(event) => setMaterialQuantity(event.target.value)}
                  />
                  <button type="button" onClick={onAddMaterial}>
                    Добавить
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>

        {setShippingCost && (
          <div className="supply-shipping-cost-editor">
            <label>
              <span>Сумма отправки</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={shippingCost ?? ''}
                placeholder="KZT"
                onChange={(event) => setShippingCost(event.target.value)}
              />
            </label>
          </div>
        )}

        <div className="data-table modal-table">
          <div
            className={`table-row supply-item-row${allowOzonProductRelink ? ' supply-item-row-editable' : ''} table-head`}
          >
            <span>{itemsTableTitle}</span>
            <span>Артикул</span>
            <span>Количество</span>
            <span>Тип</span>
            {allowOzonProductRelink && <span>Постоянный товар</span>}
            <span></span>
          </div>
          {items.map((item) => {
            const imageUrl = getSupplyItemImageUrl(ozonProducts, item)

            return (
              <div
                className={`table-row supply-item-row${allowOzonProductRelink ? ' supply-item-row-editable' : ''}`}
                key={item.tempId}
              >
                <span className="unsold-product-name">
                  {imageUrl ? (
                    <ProductImageHoverPreview imageUrl={imageUrl} name={item.productName}>
                      <ProductThumb imageUrl={imageUrl} name={item.productName} />
                    </ProductImageHoverPreview>
                  ) : (
                    <ProductThumb name={item.productName} />
                  )}
                  {allowReserveNameEdit && item.isReserve ? (
                    <input
                      value={item.productName}
                      onChange={(event) =>
                        setItems((current) =>
                          current.map((draft) =>
                            draft.tempId === item.tempId
                              ? { ...draft, productName: event.target.value }
                              : draft,
                          ),
                        )
                      }
                    />
                  ) : (
                    <strong>{item.productName}</strong>
                  )}
                </span>
                <OfferIdCell offerId={item.offerId} />
                <span>
                  <input
                    className="supply-item-quantity-input"
                    type="number"
                    min="1"
                    value={item.quantity}
                    onChange={(event) => {
                      const nextQuantity = Number(event.target.value)
                      if (!Number.isFinite(nextQuantity) || nextQuantity <= 0) {
                        return
                      }

                      setItems((current) =>
                        current.map((draft) =>
                          draft.tempId === item.tempId ? { ...draft, quantity: nextQuantity } : draft,
                        ),
                      )
                    }}
                  />
                </span>
                <span>{formatSupplyItemKind(item)}</span>
                {allowOzonProductRelink && (
                  <span className="supply-relink-cell">
                    {!item.isReserve && item.itemKind === 'Product' ? (
                      <ProductSearchInput
                        listId={`${listIdPrefix}-relink-${item.tempId}`}
                        products={ozonProducts}
                        selectedProductId={item.ozonProductId ? String(item.ozonProductId) : ''}
                        onProductIdChange={(nextProductId) =>
                          relinkSupplyItemToOzon(item.tempId, nextProductId)
                        }
                        placeholder="Сменить постоянный товар"
                        hideInlinePreview
                      />
                    ) : (
                      <span className="muted">-</span>
                    )}
                  </span>
                )}
                <span>
                  <button
                    type="button"
                    className="danger"
                    onClick={() =>
                      setItems((current) => current.filter((draft) => draft.tempId !== item.tempId))
                    }
                  >
                    Убрать
                  </button>
                </span>
              </div>
            )
          })}
          {items.length === 0 && (
            <div className="empty-state">
              <strong>Добавьте товары в поставку.</strong>
            </div>
          )}
        </div>

        <div className="supply-actions">
          <button type="button" onClick={onSave}>
            Сохранить
          </button>
        </div>
      </div>
    </div>
  )
}

function SupplyDatesEditor({
  supply,
  onUpdateDates,
}: {
  supply: Supply
  onUpdateDates: (id: string, sentAt?: string, acceptedAt?: string, shippingCost?: number | null) => Promise<boolean>
}) {
  const [editing, setEditing] = useState(false)
  const [sentAt, setSentAt] = useState(() => toDatetimeLocalValue(supply.sentAt))
  const [acceptedAt, setAcceptedAt] = useState(() => toDatetimeLocalValue(supply.acceptedAt))
  const [shippingCost, setShippingCost] = useState(() => (supply.shippingCost ? String(supply.shippingCost) : ''))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setSentAt(toDatetimeLocalValue(supply.sentAt))
    setAcceptedAt(toDatetimeLocalValue(supply.acceptedAt))
    setShippingCost(supply.shippingCost ? String(supply.shippingCost) : '')
    setEditing(false)
  }, [supply.id, supply.sentAt, supply.acceptedAt, supply.shippingCost])

  async function saveDates() {
    setSaving(true)
    const saved = await onUpdateDates(
      supply.id,
      fromDatetimeLocalValue(sentAt),
      fromDatetimeLocalValue(acceptedAt),
      parseMoneyInput(shippingCost),
    )
    setSaving(false)
    if (saved) {
      setEditing(false)
    }
  }

  if (!editing) {
    return (
      <small className="supply-dates-line">
        Отгрузка: {supply.sentAt ? formatDateTime(supply.sentAt) : '-'} | Приемка:{' '}
        {supply.acceptedAt ? formatDateTime(supply.acceptedAt) : '-'} | Сумма отправки:{' '}
        {supply.shippingCost ? formatMoney(supply.shippingCost, 'KZT') : '-'}
        <button type="button" className="link-button" onClick={() => setEditing(true)}>
          Изменить
        </button>
      </small>
    )
  }

  return (
    <small className="supply-dates-editor">
      <label>
        Отгрузка
        <input type="datetime-local" value={sentAt} onChange={(event) => setSentAt(event.target.value)} />
      </label>
      <label>
        Приемка
        <input
          type="datetime-local"
          value={acceptedAt}
          onChange={(event) => setAcceptedAt(event.target.value)}
        />
      </label>
      <label>
        Сумма отправки
        <input
          type="number"
          min="0"
          step="0.01"
          value={shippingCost}
          placeholder="KZT"
          onChange={(event) => setShippingCost(event.target.value)}
        />
      </label>
      <button type="button" disabled={saving} onClick={() => void saveDates()}>
        {saving ? 'Сохранение...' : 'Сохранить'}
      </button>
      <button
        type="button"
        disabled={saving}
        onClick={() => {
          setSentAt(toDatetimeLocalValue(supply.sentAt))
          setAcceptedAt(toDatetimeLocalValue(supply.acceptedAt))
          setShippingCost(supply.shippingCost ? String(supply.shippingCost) : '')
          setEditing(false)
        }}
      >
        Отмена
      </button>
    </small>
  )
}

function SupplyTable({
  supplies,
  ozonProducts,
  replaceProducts,
  setReplaceProducts,
  editingSupplyId,
  onStartEdit,
  onDeleteSupply,
  onArchiveSupply,
  onStatusChange,
  onRequestSent,
  onUpdateDates,
  onReplaceReserve,
  userRole,
  archiveMode = false,
  collapsible = false,
}: {
  supplies: Supply[]
  ozonProducts: OzonProduct[]
  replaceProducts: Record<string, string>
  setReplaceProducts: Dispatch<SetStateAction<Record<string, string>>>
  editingSupplyId: string | null
  onStartEdit: (supply: Supply) => void
  onDeleteSupply: (id: string) => void
  onArchiveSupply: (id: string) => void
  onStatusChange: (id: string, status: SupplyStatus) => void
  onRequestSent: (supply: Supply) => void
  onUpdateDates: (id: string, sentAt?: string, acceptedAt?: string, shippingCost?: number | null) => Promise<boolean>
  onReplaceReserve: (itemId: string) => void
  userRole?: string
  archiveMode?: boolean
  collapsible?: boolean
}) {
  const [expandedArchiveSupplyIds, setExpandedArchiveSupplyIds] = useState<Record<string, boolean>>({})
  const [expandedSupplyIds, setExpandedSupplyIds] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (!collapsible || !editingSupplyId) {
      return
    }

    setExpandedSupplyIds((current) => ({ ...current, [editingSupplyId]: true }))
  }, [collapsible, editingSupplyId])

  return (
    <div className="supply-list">
      {supplies.map((supply) => {
        const isEditing = editingSupplyId === supply.id
        const canEdit = !archiveMode && (userRole === 'Admin' || supply.status === 'Created')
        const isArchiveExpanded = expandedArchiveSupplyIds[supply.id] ?? false
        const isSupplyExpanded = expandedSupplyIds[supply.id] ?? false
        const showItems =
          collapsible && !archiveMode
            ? isSupplyExpanded || isEditing
            : !archiveMode || isArchiveExpanded
        const rows: DraftSupplyItem[] = supply.items.map((item) => ({
          tempId: item.id,
          id: item.id,
          ozonProductId: item.ozonProductId,
          offerId: item.offerId,
          productName: item.productName,
          imageUrl: getSupplyItemImageUrl(ozonProducts, {
            tempId: item.id,
            ozonProductId: item.ozonProductId,
            offerId: item.offerId,
            productName: item.productName,
            quantity: item.quantity,
            isReserve: item.isReserve,
            itemKind: item.itemKind ?? 'Product',
          }),
          quantity: item.quantity,
          isReserve: item.isReserve,
          itemKind: item.itemKind ?? 'Product',
        }))
        const totalQuantity = rows.reduce((sum, item) => sum + item.quantity, 0)

        return (
          <section
            className={`supply-card${collapsible && !archiveMode ? ' supply-card-collapsible' : ''}${showItems ? ' supply-card-expanded' : ''}`}
            key={supply.id}
          >
            <div className="supply-card-head">
              <span className="supply-card-title">
                {collapsible && !archiveMode && (
                  <button
                    type="button"
                    className="supply-card-toggle"
                    aria-expanded={showItems}
                    aria-label={showItems ? 'Свернуть поставку' : 'Развернуть поставку'}
                    onClick={() =>
                      setExpandedSupplyIds((current) => ({
                        ...current,
                        [supply.id]: !isSupplyExpanded,
                      }))
                    }
                  >
                    {showItems ? '▾' : '▸'}
                  </button>
                )}
                <span>
                  <strong>{formatSupplyTitle(supply)}</strong>
                  {collapsible && !archiveMode && !showItems ? (
                    <small>
                      {rows.length} поз. · {totalQuantity} шт. | Отгрузка:{' '}
                      {supply.sentAt ? formatDateTime(supply.sentAt) : '-'} | Приемка:{' '}
                      {supply.acceptedAt ? formatDateTime(supply.acceptedAt) : '-'} | Сумма отправки:{' '}
                      {supply.shippingCost ? formatMoney(supply.shippingCost, 'KZT') : '-'}
                    </small>
                  ) : userRole === 'Admin' ? (
                    <SupplyDatesEditor supply={supply} onUpdateDates={onUpdateDates} />
                  ) : (
                    <small>
                      Отгрузка: {supply.sentAt ? formatDateTime(supply.sentAt) : '-'} | Приемка:{' '}
                      {supply.acceptedAt ? formatDateTime(supply.acceptedAt) : '-'} | Сумма отправки:{' '}
                      {supply.shippingCost ? formatMoney(supply.shippingCost, 'KZT') : '-'}
                    </small>
                  )}
                </span>
              </span>
              <span className="status-pill">{formatSupplyDisplayStatus(supply)}</span>
              {(canEdit || archiveMode || collapsible) && (
                <span className="supply-status-actions">
                  {collapsible && !archiveMode && (
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedSupplyIds((current) => ({
                          ...current,
                          [supply.id]: !isSupplyExpanded,
                        }))
                      }
                    >
                      {showItems ? 'Свернуть' : 'Развернуть'}
                    </button>
                  )}
                  {!archiveMode && supply.status === 'Created' && (
                    <button type="button" onClick={() => onRequestSent(supply)}>
                      Отправлено
                    </button>
                  )}
                  {userRole === 'Admin' && !archiveMode && (
                    <button type="button" onClick={() => onStatusChange(supply.id, 'Accepted')}>
                      Принято
                    </button>
                  )}
                  {canEdit && !isEditing && (
                    <button type="button" onClick={() => onStartEdit(supply)}>
                      Редактировать
                    </button>
                  )}
                  {userRole === 'Admin' && !archiveMode && (
                    <button type="button" onClick={() => onArchiveSupply(supply.id)}>
                      Архивировать
                    </button>
                  )}
                  {userRole === 'Admin' && archiveMode && (
                    <>
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedArchiveSupplyIds((current) => ({
                            ...current,
                            [supply.id]: !isArchiveExpanded,
                          }))
                        }
                      >
                        {isArchiveExpanded ? 'Свернуть товары' : 'Показать товары'}
                      </button>
                      <button
                        type="button"
                        className="danger"
                        onClick={() => onDeleteSupply(supply.id)}
                      >
                        Удалить из архива
                      </button>
                    </>
                  )}
                </span>
              )}
            </div>

            {showItems && (
              <div className="data-table">
                <div className="table-row supply-item-row table-head">
                  <span>Товар</span>
                  <span>Артикул</span>
                  <span>Количество</span>
                  <span>Тип</span>
                  <span>Замена</span>
                </div>
                {rows.map((item) => {
                  const imageUrl = getSupplyItemImageUrl(ozonProducts, item)

                  return (
                    <div className="table-row supply-item-row" key={item.id}>
                      <span className="unsold-product-name">
                        {imageUrl ? (
                          <ProductImageHoverPreview imageUrl={imageUrl} name={item.productName}>
                            <ProductThumb imageUrl={imageUrl} name={item.productName} />
                          </ProductImageHoverPreview>
                        ) : (
                          <ProductThumb name={item.productName} />
                        )}
                        <strong>{item.productName}</strong>
                      </span>
                      <OfferIdCell offerId={item.offerId} />
                      <span>{item.quantity}</span>
                      <span>{formatSupplyItemKind(item)}</span>
                      <span className="reserve-replace">
                        {item.isReserve && userRole === 'Admin' ? (
                          <>
                            <ProductSearchInput
                              listId={`replace-products-${item.id}`}
                              products={ozonProducts}
                              selectedProductId={replaceProducts[item.id ?? ''] ?? ''}
                              onProductIdChange={(nextProductId) =>
                                setReplaceProducts((current) => ({
                                  ...current,
                                  [item.id ?? '']: nextProductId,
                                }))
                              }
                              placeholder="Найти постоянный товар"
                            />
                            <button type="button" onClick={() => item.id && onReplaceReserve(item.id)}>
                              Заменить
                            </button>
                          </>
                        ) : (
                          '-'
                        )}
                      </span>
                    </div>
                  )
                })}
                {rows.length === 0 && (
                  <div className="empty-state">
                    <strong>В поставке нет товаров.</strong>
                  </div>
                )}
              </div>
            )}
          </section>
        )
      })}
      {supplies.length === 0 && (
        <div className="empty-state">
          <strong>Поставок пока нет.</strong>
        </div>
      )}
    </div>
  )
}

function SupplyAnalyticsTable({ rows }: { rows: SupplyAnalyticsItem[] }) {
  return (
    <div className="data-table">
      <div className="table-row supply-analytics-row table-head">
        <span>Товар</span>
        <span>Артикул</span>
        <span>Количество</span>
        <span>Статус</span>
        <span>Создано</span>
        <span>Отправлено</span>
        <span>Принято</span>
      </div>
      {rows.map((row) => (
        <div className="table-row supply-analytics-row" key={`${row.supplyId}-${row.id}`}>
          <span>
            <strong>{row.productName}</strong>
            <small>{formatSupplyItemKind(row)}</small>
          </span>
          <OfferIdCell offerId={row.offerId} />
          <span>{row.quantity}</span>
          <span>{formatSupplyDisplayStatus(row)}</span>
          <span>{formatDateTime(row.createdAt)}</span>
          <span>{row.sentAt ? formatDateTime(row.sentAt) : '-'}</span>
          <span>{row.acceptedAt ? formatDateTime(row.acceptedAt) : '-'}</span>
        </div>
      ))}
      {rows.length === 0 && (
        <div className="empty-state">
          <strong>По этому товару поставок пока нет.</strong>
        </div>
      )}
    </div>
  )
}

function SupplyFboRemainingTable({
  rows,
  onMarkDefect,
}: {
  rows: SupplyFboRemainingItem[]
  onMarkDefect: (row: SupplyFboRemainingItem) => void
}) {
  return (
    <div className="data-table supply-fbo-remaining-table">
      <div className="table-row supply-fbo-remaining-row table-head">
        <span>Товар</span>
        <span>Артикул</span>
        <span>Принято на сайте</span>
        <span>Отгружено в Ozon</span>
        <span>Осталось отгрузить</span>
        <span>Брак</span>
      </div>
      {rows.map((row) => (
        <div className="table-row supply-fbo-remaining-row" key={row.key}>
          <span data-label="Товар">
            <strong>{row.productName}</strong>
          </span>
          <span data-label="Артикул">
            <OfferIdCell offerId={row.offerId} />
          </span>
          <span data-label="Принято на сайте">{row.acceptedQuantity}</span>
          <span data-label="Отгружено в Ozon">{row.shippedQuantity}</span>
          <span data-label="Осталось отгрузить">
            <strong>{row.remainingQuantity}</strong>
          </span>
          <span data-label="Брак">
            <button type="button" className="danger" onClick={() => onMarkDefect(row)}>
              Брак
            </button>
          </span>
        </div>
      ))}
      {rows.length === 0 && (
        <div className="empty-state">
          <strong>Все принятые товары уже отгружены на Ozon.</strong>
        </div>
      )}
    </div>
  )
}

function SupplyFboDefectsTable({
  rows,
  onRemoveDefect,
}: {
  rows: SupplyFboDefect[]
  onRemoveDefect: (row: SupplyFboDefect) => void
}) {
  return (
    <div className="data-table supply-fbo-defects-table">
      <div className="table-row supply-fbo-defect-row table-head">
        <span>Товар</span>
        <span>Артикул</span>
        <span>Брак</span>
        <span>Отмечено</span>
        <span>Действия</span>
      </div>
      {rows.map((row) => (
        <div className="table-row supply-fbo-defect-row" key={row.id}>
          <span data-label="Товар">
            <strong>{row.productName}</strong>
          </span>
          <span data-label="Артикул">
            <OfferIdCell offerId={row.offerId} />
          </span>
          <span data-label="Брак">
            <strong>{row.quantity}</strong>
          </span>
          <span data-label="Отмечено">{formatDateTime(row.createdAt)}</span>
          <span data-label="Действия">
            <button type="button" className="secondary" onClick={() => onRemoveDefect(row)}>
              Вернуть
            </button>
          </span>
        </div>
      ))}
      {rows.length === 0 && (
        <div className="empty-state">
          <strong>Брак пока не отмечен.</strong>
        </div>
      )}
    </div>
  )
}

function SupplyExpensesTable({
  rows,
  onSave,
  onDelete,
}: {
  rows: SupplyExpense[]
  onSave: (row: SupplyExpense, amountValue: string, purchasedAtValue: string) => void
  onDelete: (row: SupplyExpense) => void
}) {
  const [drafts, setDrafts] = useState<Record<string, { amount: string; purchasedAt: string }>>({})

  function getDraft(row: SupplyExpense) {
    return drafts[row.id] ?? {
      amount: String(row.amount).replace('.', ','),
      purchasedAt: dateInputValue(row.purchasedAt),
    }
  }

  function updateDraft(row: SupplyExpense, patch: Partial<{ amount: string; purchasedAt: string }>) {
    const current = getDraft(row)
    setDrafts((prev) => ({
      ...prev,
      [row.id]: {
        ...current,
        ...patch,
      },
    }))
  }

  return (
    <div className="data-table supply-expenses-table">
      <div className="table-row supply-expense-row table-head">
        <span>Название</span>
        <span>Сумма</span>
        <span>Дата покупки</span>
        <span>Добавил</span>
        <span>Создано</span>
        <span>Действия</span>
      </div>
      {rows.map((row) => {
        const draft = getDraft(row)

        return (
          <div className="table-row supply-expense-row" key={row.id}>
            <span data-label="Название">
              <strong>{row.name}</strong>
            </span>
            <span data-label="Сумма">
              <input
                inputMode="decimal"
                value={draft.amount}
                onChange={(event) => updateDraft(row, { amount: event.target.value })}
                placeholder="0,00"
              />
            </span>
            <span data-label="Дата покупки">
              <input
                type="date"
                value={draft.purchasedAt}
                onChange={(event) => updateDraft(row, { purchasedAt: event.target.value })}
              />
            </span>
            <span data-label="Добавил">{row.createdByDisplayName || '-'}</span>
            <span data-label="Создано">{formatDateTime(row.createdAt)}</span>
            <span data-label="Действия" className="supply-expense-actions">
              <button type="button" onClick={() => onSave(row, draft.amount, draft.purchasedAt)}>
                Сохранить
              </button>
              <button type="button" className="danger" onClick={() => onDelete(row)}>
                Удалить
              </button>
            </span>
          </div>
        )
      })}
      {rows.length === 0 && (
        <div className="empty-state">
          <strong>Расходников пока нет.</strong>
        </div>
      )}
    </div>
  )
}

function AllSuppliesTable({ supplies }: { supplies: Supply[] }) {
  return (
    <div className="all-supplies-list">
      {supplies.map((supply) => {
        const totalQuantity = supply.items.reduce((sum, item) => sum + item.quantity, 0)

        return (
          <details className="all-supply-card" key={supply.id}>
            <summary>
              <span>
                <strong>{formatSupplyTitle(supply)}</strong>
                <small>
                  Отгрузка: {supply.sentAt ? formatDateTime(supply.sentAt) : '-'} | Приемка:{' '}
                  {supply.acceptedAt ? formatDateTime(supply.acceptedAt) : '-'} | Сумма отправки:{' '}
                  {supply.shippingCost ? formatMoney(supply.shippingCost, 'KZT') : '-'}
                </small>
              </span>
              <span className="status-pill">{formatSupplyDisplayStatus(supply)}</span>
              <span>
                <strong>{supply.shippingCost ? formatMoney(supply.shippingCost, 'KZT') : '-'}</strong>
                <small>сумма отправки</small>
              </span>
              <span>
                <strong>{totalQuantity}</strong>
                <small>шт. всего</small>
              </span>
            </summary>

            <div className="data-table">
              <div className="table-row all-supply-item-row table-head">
                <span>Товар</span>
                <span>Артикул</span>
                <span>Количество</span>
                <span>Тип</span>
              </div>
              {supply.items.map((item) => (
                <div className="table-row all-supply-item-row" key={item.id}>
                  <span>{item.productName}</span>
                  <OfferIdCell offerId={item.offerId} />
                  <span>{item.quantity}</span>
                  <span>{formatSupplyItemKind(item)}</span>
                </div>
              ))}
            </div>
          </details>
        )
      })}
      {supplies.length === 0 && (
        <div className="empty-state">
          <strong>Поставок пока нет.</strong>
        </div>
      )}
    </div>
  )
}

function StockRow({
  item,
  priceValue,
  onPriceChange,
  onSave,
  canEditPrice,
}: {
  item: OzonStock
  priceValue: string
  onPriceChange: (value: string) => void
  onSave: () => void
  canEditPrice: boolean
}) {
  return (
    <div className={`table-row stock-row ${canEditPrice ? '' : 'stock-row-readonly'}`}>
      <span data-label="Товар" className="stock-product-cell">
        {item.imageUrl && (
          <ProductImageHoverPreview imageUrl={item.imageUrl} name={item.name}>
            <ProductThumb imageUrl={item.imageUrl} name={item.name} />
          </ProductImageHoverPreview>
        )}
        <span>
          <strong>{item.name}</strong>
          {item.productUrl && (
            <a href={item.productUrl} target="_blank" rel="noreferrer">
              Открыть Ozon
            </a>
          )}
        </span>
      </span>
      <span data-label="Артикул">
        <OfferIdCell offerId={item.offerId} />
      </span>
      <span data-label="FBO">{item.fboPresent}</span>
      <span data-label="FBS">{item.fbsPresent}</span>
      <span className="stock-price-cell" data-label="Цена">
        {canEditPrice ? (
          <>
            <input
              value={priceValue}
              onChange={(event) => onPriceChange(event.target.value)}
            />
            <small>{item.currencyCode}</small>
          </>
        ) : (
          <strong>{formatMoney(item.price, item.currencyCode || 'KZT')}</strong>
        )}
      </span>
      {canEditPrice && (
        <span className="stock-save-cell" data-label="Действие">
          <button type="button" className="stock-save-button" onClick={onSave}>
            Сохранить
          </button>
        </span>
      )}
    </div>
  )
}

function computeHomeProductionStats(tasks: ProductionTask[]) {
  const activeTasks = tasks.filter((task) => !task.isArchived)

  return {
    new: activeTasks.filter((task) => task.status === 'New').length,
    inProgress: activeTasks.filter((task) => task.status === 'InProgress').length,
    cancelled: activeTasks.filter((task) => task.status === 'Cancelled').length,
    completed: activeTasks.filter((task) => task.status === 'Completed').length,
    urgent: activeTasks.filter((task) => task.isUrgent).length,
    total: activeTasks.length,
  }
}

function HomeProductionBlock({
  title,
  stats,
  hasHomeAction,
  onOpen,
}: {
  title: string
  stats: ReturnType<typeof computeHomeProductionStats>
  hasHomeAction: (blockId: string, actionId: string) => boolean
  onOpen: (subTab: ProductionSubTab, taskUrgency?: 'all' | 'urgent' | 'normal') => void
}) {
  return (
    <article className="home-block">
      <div className="home-block-head">
        <div>
          <h3>{title}</h3>
          <p>
            {stats.urgent > 0 ? `${stats.urgent} срочных · ` : ''}
            {stats.total} активных задач
          </p>
        </div>
        <button type="button" className="home-block-link" onClick={() => onOpen('tasks')}>
          Открыть
        </button>
      </div>
      <div className="home-metrics">
        <div className="home-metric">
          <span>Новые</span>
          <strong>{stats.new}</strong>
        </div>
        <div className="home-metric home-metric-urgent">
          <span>Срочные</span>
          <strong>{stats.urgent}</strong>
        </div>
        <div className="home-metric">
          <span>В работе</span>
          <strong>{stats.inProgress}</strong>
        </div>
        <div className="home-metric">
          <span>Отменённые</span>
          <strong>{stats.cancelled}</strong>
        </div>
        <div className="home-metric">
          <span>Выполненные</span>
          <strong>{stats.completed}</strong>
        </div>
      </div>
      <div className="home-block-actions">
        {hasHomeAction('production', 'production.tasks') && (
          <button type="button" onClick={() => onOpen('tasks')}>
            Задачи
          </button>
        )}
        {hasHomeAction('production', 'production.tasks') && stats.urgent > 0 && (
          <button type="button" className="home-block-urgent" onClick={() => onOpen('tasks', 'urgent')}>
            Срочные
          </button>
        )}
        {hasHomeAction('production', 'production.inProgress') && (
          <button type="button" onClick={() => onOpen('inProgress')}>
            В работе
          </button>
        )}
        {hasHomeAction('production', 'production.cancelled') && (
          <button type="button" onClick={() => onOpen('cancelled')}>
            Отменённые
          </button>
        )}
        {hasHomeAction('production', 'production.completed') && (
          <button type="button" onClick={() => onOpen('completed')}>
            Выполненные
          </button>
        )}
      </div>
    </article>
  )
}

function HomeProductsBlock({
  title,
  subtitle,
  status,
  stats,
  onOpen,
  onRefresh,
}: {
  title: string
  subtitle: string
  status?: string
  stats: ReturnType<typeof computeCatalogProductStats>
  onOpen: () => void
  onRefresh: () => void
}) {
  return (
    <article className="home-block">
      <div className="home-block-head">
        <div>
          <h3>{title}</h3>
          <p>{subtitle}</p>
          {status && <small className="home-block-status">{status}</small>}
        </div>
        <button type="button" className="home-block-link" onClick={onOpen}>
          Открыть
        </button>
      </div>
      <div className="home-metrics">
        <div className="home-metric">
          <span>Всего</span>
          <strong>{stats.total}</strong>
        </div>
        <div className="home-metric">
          <span>Готов к продаже</span>
          <strong>{stats.ready}</strong>
        </div>
        <div className="home-metric">
          <span>В архиве</span>
          <strong>{stats.archived}</strong>
        </div>
        <div className="home-metric">
          <span>Продается</span>
          <strong>{stats.selling}</strong>
        </div>
      </div>
      <div className="home-block-actions">
        <button type="button" onClick={onOpen}>
          Каталог товаров
        </button>
        <button type="button" className="home-block-refresh" onClick={onRefresh}>
          Обновить
        </button>
      </div>
    </article>
  )
}

function HomeAnalyticsBlock({
  title,
  periodLabel,
  status,
  analytics,
  marketplaceLabel,
  hasHomeAction,
  onOpenAnalytics,
  onRefresh,
}: {
  title: string
  periodLabel: string
  status?: string
  analytics: OzonAnalytics | null
  marketplaceLabel: string
  hasHomeAction: (blockId: string, actionId: string) => boolean
  onOpenAnalytics: (subTab: AnalyticsSubTab) => void
  onRefresh: () => void
}) {
  const currency = analytics?.accountBalanceCurrency || 'KZT'

  return (
    <article className="home-block">
      <div className="home-block-head">
        <div>
          <h3>{title}</h3>
          <p>За текущий месяц · {periodLabel}</p>
          {status && <small className="home-block-status">{status}</small>}
        </div>
        <button type="button" className="home-block-link" onClick={() => onOpenAnalytics('summary')}>
          Открыть
        </button>
      </div>
      <div className="home-metrics">
        <div className="home-metric">
          <span>Продажи</span>
          <strong>{analytics?.salesTotalCount ?? '—'}</strong>
        </div>
        <div className="home-metric">
          <span>Выручка</span>
          <strong>{analytics ? formatMoney(analytics.revenueTotal, currency) : '—'}</strong>
        </div>
        <div className="home-metric">
          <span>Баланс {marketplaceLabel}</span>
          <strong>
            {analytics?.accountBalance === null || analytics?.accountBalance === undefined
              ? '—'
              : formatMoney(analytics.accountBalance, analytics.accountBalanceCurrency || currency)}
          </strong>
        </div>
        <div className="home-metric home-metric-loss">
          <span>Комиссия {marketplaceLabel}</span>
          <strong>{analytics ? formatLossMoney(analytics.commissionTotal, currency) : '—'}</strong>
        </div>
        <div className="home-metric home-metric-loss">
          <span>Логистика</span>
          <strong>{analytics ? formatLossMoney(analytics.logisticsTotal, currency) : '—'}</strong>
        </div>
        <div className="home-metric home-metric-loss">
          <span>Логистика отменённых</span>
          <strong>
            {analytics ? formatLossMoney(analytics.cancelledLogisticsTotal, currency) : '—'}
          </strong>
        </div>
      </div>
      <div className="home-metrics home-metrics-secondary">
        <div className="home-metric">
          <span>Собираются</span>
          <strong>{analytics?.awaitingDeliverCount ?? '—'}</strong>
        </div>
        <div className="home-metric">
          <span>Едут</span>
          <strong>{analytics?.inTransitCount ?? '—'}</strong>
        </div>
        <div className="home-metric">
          <span>Доставлены</span>
          <strong>{analytics?.deliveredProductCount ?? '—'}</strong>
        </div>
        <div className="home-metric">
          <span>Отменены</span>
          <strong>{analytics?.cancelledCount ?? '—'}</strong>
        </div>
      </div>
      <div className="home-block-actions">
        {hasHomeAction('analytics', 'analytics.summary') && (
          <button type="button" onClick={() => onOpenAnalytics('summary')}>
            Общая аналитика
          </button>
        )}
        {hasHomeAction('analytics', 'analytics.topProducts') && (
          <button type="button" onClick={() => onOpenAnalytics('topProducts')}>
            Топ товары
          </button>
        )}
        {hasHomeAction('analytics', 'analytics.noSales') && (
          <button type="button" onClick={() => onOpenAnalytics('noSales')}>
            Без продаж
          </button>
        )}
        <button type="button" className="home-block-refresh" onClick={onRefresh}>
          Обновить
        </button>
      </div>
    </article>
  )
}

function AnalyticsPipelineBoard({
  snapshot,
  analytics,
  marketplaceLabel = 'OZON',
}: {
  snapshot: OzonAnalyticsSnapshot | null
  analytics: OzonAnalytics | null
  marketplaceLabel?: string
}) {
  const currency = 'KZT'
  const balanceCurrency = snapshot?.accountBalanceCurrency || currency
  const totalDeductions = analytics
    ? analytics.commissionTotal +
      analytics.logisticsTotal +
      analytics.servicesTotal
    : null

  return (
    <div className="analytics-pipeline">
      <section className="analytics-pipeline-panel analytics-pipeline-panel--summary">
        <div className="analytics-pipeline-grid analytics-pipeline-grid--summary">
          <div className="analytics-pipeline-card analytics-pipeline-cell--s1c1">
            <span>Всего позиций</span>
            <strong>{snapshot?.totalProductsCount ?? '—'}</strong>
          </div>
          <div className="analytics-pipeline-card analytics-pipeline-cell--s1c2">
            <span>Товаров в продаже</span>
            <strong>{snapshot?.sellingProductsCount ?? '—'}</strong>
          </div>
          <div className="analytics-pipeline-card analytics-pipeline-cell--s1c3">
            <span>Готовых к продаже</span>
            <strong>{snapshot?.readyForSaleProductsCount ?? '—'}</strong>
          </div>
          <div className="analytics-pipeline-card analytics-pipeline-card--text-danger analytics-pipeline-cell--s1c4">
            <span>В архиве</span>
            <strong>{snapshot?.archivedProductsCount ?? '—'}</strong>
          </div>
          <div className="analytics-pipeline-card analytics-pipeline-card--balance analytics-pipeline-cell--s1c6">
            <span>Баланс на {marketplaceLabel}</span>
            <strong>
              {snapshot?.accountBalance === null || snapshot?.accountBalance === undefined
                ? '—'
                : formatMoney(snapshot.accountBalance, balanceCurrency)}
            </strong>
          </div>
        </div>
      </section>

      <section className="analytics-pipeline-panel analytics-pipeline-panel--metrics">
        <div className="analytics-pipeline-grid analytics-pipeline-grid--metrics">
        <div className="analytics-pipeline-card analytics-pipeline-cell analytics-pipeline-cell--r1c1">
          <span>Заказано товаров</span>
          <strong>{analytics?.salesTotalCount ?? '—'}</strong>
        </div>
        <div className="analytics-pipeline-card analytics-pipeline-card--text-progress analytics-pipeline-cell analytics-pipeline-cell--r1c2">
          <span>В сборке</span>
          <strong>{analytics?.awaitingDeliverCount ?? '—'}</strong>
        </div>
        <div className="analytics-pipeline-card analytics-pipeline-card--text-progress analytics-pipeline-cell analytics-pipeline-cell--r1c3">
          <span>В пути</span>
          <strong>{analytics?.inTransitCount ?? '—'}</strong>
        </div>
        <div className="analytics-pipeline-card analytics-pipeline-card--highlight-success analytics-pipeline-cell analytics-pipeline-cell--r1c4">
          <span>Выкуплено товаров</span>
          <strong>{analytics?.deliveredProductCount ?? '—'}</strong>
        </div>
        <div className="analytics-pipeline-card analytics-pipeline-card--text-danger analytics-pipeline-cell analytics-pipeline-cell--r1c5">
          <span>Возврат товаров</span>
          <strong>{analytics?.cancelledCount ?? '—'}</strong>
        </div>
        <div className="analytics-pipeline-card analytics-pipeline-card--text-danger analytics-pipeline-cell analytics-pipeline-cell--r1c6">
          <span>Возвращено товаров на сумму</span>
          <strong>{analytics ? formatLossMoney(analytics.cancelledAmount, currency) : '—'}</strong>
        </div>

        <div className="analytics-pipeline-card analytics-pipeline-cell analytics-pipeline-cell--r2c1">
          <span>Заказано товаров на сумму</span>
          <strong>{analytics ? formatMoney(analytics.salesAmountTotal, currency) : '—'}</strong>
        </div>
        <div className="analytics-pipeline-card analytics-pipeline-card--text-progress analytics-pipeline-cell analytics-pipeline-cell--r2c2">
          <span>В сборке товаров на сумму</span>
          <strong>{analytics ? formatMoney(analytics.awaitingDeliverAmount, currency) : '—'}</strong>
        </div>
        <div className="analytics-pipeline-card analytics-pipeline-card--text-progress analytics-pipeline-cell analytics-pipeline-cell--r2c3">
          <span>В пути товаров на сумму</span>
          <strong>{analytics ? formatMoney(analytics.inTransitAmount, currency) : '—'}</strong>
        </div>
        <div className="analytics-pipeline-card analytics-pipeline-card--text-success analytics-pipeline-cell analytics-pipeline-cell--r2c4">
          <span>Выкуплено товаров на сумму</span>
          <strong>{analytics ? formatMoney(analytics.revenueTotal, currency) : '—'}</strong>
        </div>

        <div className="analytics-pipeline-card analytics-pipeline-card--text-danger analytics-pipeline-cell analytics-pipeline-cell--r3c1">
          <span>Комиссия {marketplaceLabel}</span>
          <strong>{analytics ? formatLossMoney(analytics.commissionTotal, currency) : '—'}</strong>
        </div>
        <div className="analytics-pipeline-card analytics-pipeline-card--text-danger analytics-pipeline-cell analytics-pipeline-cell--r3c2">
          <span>Логистика</span>
          <strong>{analytics ? formatLossMoney(analytics.logisticsTotal, currency) : '—'}</strong>
        </div>
        <div className="analytics-pipeline-card analytics-pipeline-card--text-danger analytics-pipeline-cell analytics-pipeline-cell--r3c3">
          <span>Прочие услуги {marketplaceLabel}</span>
          <strong>{analytics ? formatLossMoney(analytics.servicesTotal, currency) : '—'}</strong>
        </div>
        <div className="analytics-pipeline-card analytics-pipeline-card--highlight-danger analytics-pipeline-cell analytics-pipeline-cell--r3c4">
          <span>Итого всех удержаний на сумму</span>
          <strong>{totalDeductions !== null ? formatLossMoney(totalDeductions, currency) : '—'}</strong>
        </div>

        <div className="analytics-pipeline-card analytics-pipeline-card--highlight-success analytics-pipeline-cell analytics-pipeline-cell--r4c4">
          <span>Остаток к выплате</span>
          <strong>{analytics ? formatMoney(analytics.payoutTotal, currency) : '—'}</strong>
        </div>
        <div className="analytics-pipeline-card analytics-pipeline-card--text-danger analytics-pipeline-cell analytics-pipeline-cell--r4c5">
          <span>Логистика отмененных товаров</span>
          <strong>{analytics ? formatLossMoney(analytics.cancelledLogisticsTotal, currency) : '—'}</strong>
        </div>
        <div className="analytics-pipeline-card analytics-pipeline-card--highlight-danger analytics-pipeline-cell analytics-pipeline-cell--r4c6">
          <span>Упущенная прибыль в возвратах</span>
          <strong>
            {analytics ? formatMoney(analytics.cancelledMissedProfitTotal, currency) : '—'}
          </strong>
        </div>
        </div>
      </section>
    </div>
  )
}

function InternalAnalyticsPanel({ data }: { data: InternalAnalyticsData }) {
  const hasMissingCost = data.productsWithoutCost > 0
  const missingCostTooltip =
    'Данные могут быть неверными: у части товаров не заполнена себестоимость в карточке товара.'
  const hasPeriodMissingCost = data.periodSoldWithoutCostQuantity > 0
  const periodMissingCostTooltip =
    'Данные могут быть неверными: у части выкупленных товаров за период не заполнена себестоимость.'

  return (
    <div className="internal-analytics">
      <section className="internal-analytics-section">
        <div className="internal-analytics-section-head">
          <div>
            <strong>Склад Ozon по себестоимости</strong>
            <span>Считается по текущим остаткам FBO + FBS и себестоимости из карточки товара.</span>
          </div>
        </div>
        <div className="internal-analytics-grid">
          <div className={`analytics-pipeline-card analytics-pipeline-card--highlight-success${hasMissingCost ? ' analytics-pipeline-card--has-warning' : ''}`}>
            <span>Сумма товаров на складе по себестоимости</span>
            {hasMissingCost ? (
              <span className="analytics-cost-warning" title={missingCostTooltip} aria-label={missingCostTooltip}>
                !
              </span>
            ) : null}
            <strong>{formatMoney(data.stockCostTotal, 'KZT')}</strong>
          </div>
          <div className="analytics-pipeline-card analytics-pipeline-card--highlight-success">
            <span>Товаров на складе на сумму с продаж</span>
            <strong>{formatMoney(data.stockSalesNetTotal, 'KZT')}</strong>
          </div>
          <div className={`analytics-pipeline-card analytics-pipeline-card--highlight-success${hasMissingCost ? ' analytics-pipeline-card--has-warning' : ''}`}>
            <span>Чистая прибыль</span>
            {hasMissingCost ? (
              <span className="analytics-cost-warning" title={missingCostTooltip} aria-label={missingCostTooltip}>
                !
              </span>
            ) : null}
            <strong>{formatMoney(data.stockProfitTotal, 'KZT')}</strong>
          </div>
          <div className="analytics-pipeline-card">
            <span>Остаток на складе Ozon</span>
            <strong>{data.stockQuantity}</strong>
          </div>
          <div className="analytics-pipeline-card">
            <span>Товаров с остатком</span>
            <strong>{data.productsWithStock}</strong>
          </div>
          <div className="analytics-pipeline-card analytics-pipeline-card--text-progress">
            <span>Штук с заполненной себестоимостью</span>
            <strong>{data.costedStockQuantity}</strong>
          </div>
          <div className="analytics-pipeline-card analytics-pipeline-card--text-danger">
            <span>Товаров без себестоимости</span>
            <strong>{data.productsWithoutCost}</strong>
          </div>
        </div>
      </section>

      <section className="internal-analytics-section">
        <div className="internal-analytics-section-head">
          <div>
            <strong>Аналитика поставок</strong>
            <span>Суммируются поставки в статусах “Отправлено” и “Принято”.</span>
          </div>
        </div>
        <div className="internal-analytics-grid internal-analytics-grid--supplies">
          <div className="analytics-pipeline-card analytics-pipeline-card--highlight-success">
            <span>Сумма отправки поставок</span>
            <strong>{formatMoney(data.suppliesShippingTotal, 'KZT')}</strong>
          </div>
          <div className="analytics-pipeline-card">
            <span>Поставок отправлено / принято</span>
            <strong>{data.suppliesCount}</strong>
          </div>
          <div className="analytics-pipeline-card">
            <span>Товаров в этих поставках</span>
            <strong>{data.suppliesItemQuantity}</strong>
          </div>
          <div className="analytics-pipeline-card analytics-pipeline-card--text-danger">
            <span>Поставок без суммы отправки</span>
            <strong>{data.suppliesWithoutShippingCost}</strong>
          </div>
        </div>
      </section>

      <section className="internal-analytics-section">
        <div className="internal-analytics-section-head">
          <div>
            <strong>Финансовый итог за период</strong>
            <span>
              {data.periodDateFrom || '—'} — {data.periodDateTo || '—'}. К выплате от Ozon уже учитывает комиссии,
              логистику и услуги Ozon; ниже дополнительно вычитаются себестоимость, расходники и отправка поставок.
            </span>
          </div>
        </div>
        <div className="internal-analytics-grid internal-analytics-grid--finance">
          <div className="analytics-pipeline-card analytics-pipeline-card--highlight-success">
            <span>К получению от Ozon</span>
            <strong>{formatMoney(data.periodPayoutTotal, 'KZT')}</strong>
          </div>
          <div className="analytics-pipeline-card">
            <span>Продаж на сумму</span>
            <strong>{formatMoney(data.periodOrderedAmount, 'KZT')}</strong>
          </div>
          <div className="analytics-pipeline-card">
            <span>Заказано товаров</span>
            <strong>{data.periodOrdersCount}</strong>
          </div>
          <div className="analytics-pipeline-card analytics-pipeline-card--text-danger">
            <span>Удержания Ozon внутри выплаты</span>
            <strong>{formatLossMoney(data.periodDeductionsTotal, 'KZT')}</strong>
          </div>
          <div className={`analytics-pipeline-card analytics-pipeline-card--text-danger${hasPeriodMissingCost ? ' analytics-pipeline-card--has-warning' : ''}`}>
            <span>Себестоимость выкупленных товаров</span>
            {hasPeriodMissingCost ? (
              <span className="analytics-cost-warning" title={periodMissingCostTooltip} aria-label={periodMissingCostTooltip}>
                !
              </span>
            ) : null}
            <strong>{formatLossMoney(data.periodSoldCostTotal, 'KZT')}</strong>
          </div>
          <div className="analytics-pipeline-card analytics-pipeline-card--text-danger">
            <span>Расходники</span>
            <strong>{formatLossMoney(data.periodExpensesTotal, 'KZT')}</strong>
          </div>
          <div className="analytics-pipeline-card analytics-pipeline-card--text-danger">
            <span>Отправка поставок</span>
            <strong>{formatLossMoney(data.periodSupplyShippingTotal, 'KZT')}</strong>
          </div>
          <div
            className={`analytics-pipeline-card ${
              data.periodNetProfit < 0
                ? 'analytics-pipeline-card--highlight-danger'
                : 'analytics-pipeline-card--highlight-success'
            }${hasPeriodMissingCost ? ' analytics-pipeline-card--has-warning' : ''}`}
          >
            <span>Чистая прибыль за период</span>
            {hasPeriodMissingCost ? (
              <span className="analytics-cost-warning" title={periodMissingCostTooltip} aria-label={periodMissingCostTooltip}>
                !
              </span>
            ) : null}
            <strong>{formatMoney(data.periodNetProfit, 'KZT')}</strong>
          </div>
          <div className="analytics-pipeline-card">
            <span>Расходников в периоде</span>
            <strong>{data.periodExpensesCount}</strong>
          </div>
          <div className="analytics-pipeline-card analytics-pipeline-card--text-progress">
            <span>Выкуплено с себестоимостью</span>
            <strong>{data.periodSoldCostedQuantity}</strong>
          </div>
          <div className="analytics-pipeline-card analytics-pipeline-card--text-danger">
            <span>Выкуплено без себестоимости</span>
            <strong>{data.periodSoldWithoutCostQuantity}</strong>
          </div>
        </div>
      </section>
    </div>
  )
}

function normalizeOrderStatus(status: string) {
  const value = status.trim().toLowerCase()

  if (value.includes('cancel') || value === 'отмен') {
    return 'cancelled'
  }

  if (value === 'delivered' || value.includes('доставлен')) {
    return 'delivered'
  }

  if (value === 'delivering' || value.includes('delivery') || value.includes('доставк')) {
    return 'delivering'
  }

  if (value === 'awaiting_deliver' || value.includes('awaiting_deliver') || value.includes('собир')) {
    return 'awaiting_deliver'
  }

  if (value === 'awaiting_packaging' || value.includes('packaging') || value.includes('упаков')) {
    return 'awaiting_deliver'
  }

  return value.replace(/\s+/g, '_')
}

function translateStatus(status: string) {
  const normalized = normalizeOrderStatus(status)
  const statuses: Record<string, string> = {
    awaiting_registration: 'Ожидает регистрации',
    awaiting_deliver: 'Собирается',
    delivering: 'Едет',
    delivered: 'Доставлен',
    cancelled: 'Отменен',
  }

  return statuses[normalized] ?? status
}

function computeCatalogProductStats(products: OzonProduct[]) {
  const stats = {
    total: products.length,
    selling: 0,
    ready: 0,
    archived: 0,
  }

  for (const product of products) {
    const group = getProductStatusGroup(product.status)

    if (group === 'selling') {
      stats.selling += 1
    } else if (group === 'ready') {
      stats.ready += 1
    } else if (group === 'archived') {
      stats.archived += 1
    }
  }

  return stats
}

function getProductStatusGroup(status: string): 'selling' | 'ready' | 'archived' | 'unknown' {
  const normalized = status.trim().toLowerCase()

  if (
    ['ready_for_sale', 'ready_to_supply', 'готов к продаже', 'готово к продаже'].includes(normalized)
  ) {
    return 'ready'
  }

  if (['archived', 'archive', 'архив', 'в архиве'].includes(normalized)) {
    return 'archived'
  }

  if (['visible', 'selling', 'active', 'on_display', 'on', 'published', 'продается', 'продаётся'].includes(normalized)) {
    return 'selling'
  }

  if (['draft', 'not_on_display', 'not_available', 'order', 'service'].includes(normalized)) {
    return 'ready'
  }

  if (['deleted', 'off', 'removed'].includes(normalized)) {
    return 'archived'
  }

  return 'unknown'
}

function translateProductStatus(status: string) {
  const normalized = status.trim().toLowerCase()
  const statuses: Record<string, string> = {
    ready_for_sale: 'Готов к продаже',
    ready_to_supply: 'Готов к продаже',
    'готов к продаже': 'Готов к продаже',
    'готово к продаже': 'Готов к продаже',
    visible: 'Продается',
    selling: 'Продается',
    active: 'Продается',
    on_display: 'Продается',
    on: 'Продается',
    published: 'Продается',
    'продается': 'Продается',
    'продаётся': 'Продается',
    archived: 'Архив',
    archive: 'Архив',
    'архив': 'Архив',
    'в архиве': 'Архив',
  }

  if (!normalized) {
    return '-'
  }

  return statuses[normalized] ?? status
}

function translateSupplyStatus(status: SupplyStatus) {
  const statuses: Record<SupplyStatus, string> = {
    Created: 'Создано',
    Sent: 'Отправлено',
    Accepted: 'Принято',
  }

  return statuses[status] ?? status
}

function formatSupplyDisplayStatus(item: { status: SupplyStatus; isArchived?: boolean }) {
  if (item.isArchived) {
    return 'Архив'
  }

  return translateSupplyStatus(item.status)
}

function getSupplyDisplayDate(supply: { sentAt?: string; createdAt: string }) {
  return supply.sentAt ?? supply.createdAt
}

function formatSupplyTitle(supply: { sentAt?: string; createdAt: string }) {
  return `Поставка от ${formatDateTime(getSupplyDisplayDate(supply))}`
}

function HomeSalesChartBlock({
  preset,
  token,
  enabled,
  loadDelayMs,
}: {
  preset: 'year' | 'month'
  token: string
  enabled: boolean
  loadDelayMs: number
}) {
  const [config, setConfig] = useState<HomeSalesChartConfig>(() =>
    preset === 'year' ? createDefaultYearChartConfig() : createDefaultMonthChartConfig(),
  )
  const [data, setData] = useState<HomeSalesChartData | null>(null)
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)

  const title = preset === 'year' ? 'Продажи за год' : 'Продажи за месяц'

  async function loadChart(nextConfig: HomeSalesChartConfig) {
    if (!token) {
      return
    }

    setLoading(true)
    setStatus('Загружаем данные графика...')

    try {
      const params = new URLSearchParams({
        dateFrom: nextConfig.dateFrom,
        dateTo: nextConfig.dateTo,
        groupBy: nextConfig.groupBy,
      })

      const response = await fetch(`/api/ozon/sales-chart?${params.toString()}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      if (!response.ok) {
        setData(null)
        setStatus(getApiErrorMessage(await response.text(), 'Не удалось загрузить график'))
        return
      }

      const chartData: HomeSalesChartData = await response.json()
      setData(chartData)
      setStatus('')
    } catch {
      setData(null)
      setStatus('Не удалось загрузить график')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!enabled || !token) {
      return
    }

    const timer = window.setTimeout(() => {
      void loadChart(config)
    }, loadDelayMs)

    return () => window.clearTimeout(timer)
  }, [enabled, token, config.dateFrom, config.dateTo, config.groupBy, loadDelayMs])

  function applyPreset(nextPreset: 'year' | 'month') {
    setConfig(nextPreset === 'year' ? createDefaultYearChartConfig() : createDefaultMonthChartConfig())
  }

  const points = data?.points ?? []
  const metricValue = (point: HomeSalesChartPoint) =>
    config.metric === 'orders' ? point.orders : point.revenue
  const maxValue = Math.max(...points.map(metricValue), config.metric === 'orders' ? 1 : 0)
  const denseChart = points.length > 12
  const chartDayCount = getChartFilterDayCount(config.dateFrom, config.dateTo)
  const rotateRevenueLabels = config.metric === 'revenue' && chartDayCount >= 10
  const totalLabel =
    config.metric === 'orders'
      ? `${data?.totalOrders ?? 0} заказов`
      : formatMoney(data?.totalRevenue ?? 0, data?.currencyCode ?? 'KZT')

  return (
    <article className="home-block home-sales-chart-block">
      <div className="home-block-head">
        <div>
          <h3>{title}</h3>
          <p>
            {config.dateFrom} — {config.dateTo}
            {data ? ` · ${totalLabel}` : ''}
          </p>
          {status && <small className="home-block-status">{status}</small>}
        </div>
        <button type="button" className="home-block-refresh" disabled={loading} onClick={() => void loadChart(config)}>
          {loading ? 'Загрузка...' : 'Обновить'}
        </button>
      </div>

      <div className="home-sales-chart-filters">
        <label>
          Показатель
          <select
            value={config.metric}
            onChange={(event) =>
              setConfig((current) => ({
                ...current,
                metric: event.target.value as HomeSalesChartMetric,
              }))
            }
          >
            <option value="orders">Количество заказов</option>
            <option value="revenue">Выручка</option>
          </select>
        </label>
        <label>
          Группировка
          <select
            value={config.groupBy}
            onChange={(event) =>
              setConfig((current) => ({
                ...current,
                groupBy: event.target.value as HomeSalesChartGroupBy,
              }))
            }
          >
            <option value="month">По месяцам</option>
            <option value="day">По дням</option>
          </select>
        </label>
        <label>
          С
          <input
            type="date"
            value={config.dateFrom}
            onChange={(event) => setConfig((current) => ({ ...current, dateFrom: event.target.value }))}
          />
        </label>
        <label>
          По
          <input
            type="date"
            value={config.dateTo}
            onChange={(event) => setConfig((current) => ({ ...current, dateTo: event.target.value }))}
          />
        </label>
        <div className="home-sales-chart-presets">
          <button type="button" onClick={() => applyPreset('year')}>
            Год
          </button>
          <button type="button" onClick={() => applyPreset('month')}>
            Месяц
          </button>
        </div>
      </div>

      {loading ? (
        <div className="home-sales-chart-empty">Загружаем график...</div>
      ) : status ? (
        <div className="home-sales-chart-empty">{status}</div>
      ) : points.length === 0 ? (
        <div className="home-sales-chart-empty">Нет данных за выбранный период.</div>
      ) : (
        <div className="home-sales-chart">
          <div
            className={`home-sales-chart-bars${denseChart ? ' is-dense' : ''}${config.metric === 'revenue' ? ' is-revenue' : ''}${rotateRevenueLabels ? ' is-revenue-rotated' : ''}`}
          >
            {points.map((point) => {
              const value = metricValue(point)
              const height = maxValue > 0 ? `${Math.max((value / maxValue) * 100, value > 0 ? 4 : 0)}%` : '0%'

              const orderValue = point.orders > 0 ? String(point.orders) : ''
              const revenueValue =
                point.revenue > 0 ? formatMoney(point.revenue, data?.currencyCode ?? 'KZT') : ''
              const tooltip =
                config.metric === 'orders'
                  ? `${point.label}: ${point.orders} заказов`
                  : `${point.label}: ${formatMoney(point.revenue, data?.currencyCode ?? 'KZT')}`

              return (
                <div className="home-sales-chart-bar-wrap" key={point.periodKey} title={tooltip}>
                  <div className="home-sales-chart-bar-track">
                    {config.metric === 'revenue' && revenueValue && (
                      <span
                        className={`home-sales-chart-bar-value home-sales-chart-bar-value--revenue${rotateRevenueLabels ? ' home-sales-chart-bar-value--revenue-rotated' : ''}`}
                        style={{
                          bottom: rotateRevenueLabels
                            ? `calc(${height} + 28px)`
                            : `calc(${height} + 6px)`,
                        }}
                      >
                        {revenueValue}
                      </span>
                    )}
                    <div className="home-sales-chart-bar" style={{ height }}>
                      {config.metric === 'orders' && orderValue && (
                        <span
                          className="home-sales-chart-bar-value home-sales-chart-bar-value--orders"
                          style={{ bottom: `calc(100% + 6px)` }}
                        >
                          {orderValue}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className="home-sales-chart-label">{point.label}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </article>
  )
}

export default App


