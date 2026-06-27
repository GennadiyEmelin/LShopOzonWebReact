import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, Dispatch, FormEvent, ReactNode, SetStateAction } from 'react'
import * as signalR from '@microsoft/signalr'
import { KzIntegrationCard, KzMarketplaceTabs, RegionSwitcher } from './KzRegionUi'
import type { KzIntegrationSettings } from './KzRegionUi'
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
  resolveNovinkaMarketplace,
  resolveNovinkaMarketplaceFromNotes,
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
  type NovinkaCatalogTab,
  type ShopRegion,
} from './shopRegion'
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
  connectAllowed: boolean
}

type AdminUserReport = {
  enabled: boolean
  reportTime: string
  timezone: string
  enabledSections: string[]
  availableSections: string[]
  lastSentOn: string | null
  telegramConnected: boolean
}

type ReportSection = {
  id: string
  group: string
  label: string
}

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
  connectAllowed: boolean
}

type BackupFile = {
  fileName: string
  sizeBytes: number
  createdAt: string
}

type OzonProduct = {
  productId: number
  offerId: string
  sku?: number
  name: string
  price: number
  oldPrice: number
  minPrice: number
  currencyCode: string
  status: string
  productUrl: string
  imageUrl: string
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

type ProductionFile = {
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

type ProductionFilePath = {
  id: string
  ozonProductId?: number
  offerId: string
  productName: string
  productLink?: string
  path: string
  createdAt: string
}

type ProductionCatalogItem = {
  offerId: string
  ozonProductId?: number
  productName: string
  productLink: string
  fileCount: number
  completedAt?: string
  marketplace?: NovinkaMarketplace
}

type ProductionTask = {
  id: string
  ozonProductId: number
  offerId: string
  productName: string
  requiredQuantity: number
  actualQuantity?: number
  status: 'New' | 'InProgress' | 'Cancelled' | 'Completed'
  taskType?: 'Ozon' | 'Novinka' | 'Kaspi' | 'Satu' | 'Halyk'
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

type ProductionTaskItem = {
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

type SupplyStatus = 'Created' | 'Sent' | 'Accepted'

type SupplyItem = {
  id: string
  ozonProductId?: number
  offerId: string
  productName: string
  quantity: number
  isReserve: boolean
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
}

type DraftTaskItem = {
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

type DraftNovinkaItem = {
  tempId: string
  productName: string
  productLink: string
  offerId?: string
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

function formatInputDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
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
      { id: 'production.cancelled', label: 'Отменённые' },
      { id: 'production.completed', label: 'Выполненные' },
      { id: 'production.archive', label: 'Архив задач' },
      { id: 'production.createTask', label: 'Создание задач' },
      { id: 'production.editTasks', label: 'Редактирование задач' },
      { id: 'production.cancelTasks', label: 'Отмена задач' },
      { id: 'production.editProducts', label: 'Редактирование товара' },
      { id: 'production.deleteFiles', label: 'Удаление файлов' },
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
const appRoles = [
  { value: 'Production', label: 'Производство' },
  { value: 'Designer', label: 'Дизайнер' },
  { value: 'Leadership', label: 'Руководство' },
  { value: 'Admin', label: 'Администратор' },
] as const

const homeBlockDefinitions = [
  {
    id: 'production',
    label: 'Производство',
    actions: [
      { id: 'production.tasks', label: 'Задачи' },
      { id: 'production.inProgress', label: 'В работе' },
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

function UserHomeBlocksEditor({
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
          <details key={block.id} className="home-block-card" open={blockEdit.enabled}>
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
}

function UserPermissionsEditor({
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
        <details key={group.title} className="permission-card" open={group.title === 'Главная'}>
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
}

function getRoleLabel(role: string) {
  return appRoles.find((item) => item.value === role)?.label ?? role
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
  task: ProductionTask,
  role: string | undefined,
  features: string[] | undefined,
) {
  return (
    (isNovinkaTask(task) && canSeeNovinkaProductionTasks(role, features)) ||
    (!isNovinkaTask(task) && canSeeOzonProductionTasks(role, features))
  )
}

const defaultUserFeatures = ['home', 'production', 'production.products', 'production.tasks', 'production.inProgress', 'production.cancelled', 'production.completed', 'products', 'supplies', 'supplies.create', 'supplies.all', 'chats', 'chats.edit', 'integrations', 'integrations.telegram', 'integrations.telegram.connect']

type TabId = (typeof tabs)[number]['id']
type ProductionSubTab = 'products' | 'tasks' | 'inProgress' | 'cancelled' | 'completed' | 'archive'
type ProductionCatalogTab = 'ozon' | 'kaspi' | 'satu' | 'halyk' | NovinkaCatalogTab | 'editor'
type TaskFormMode = 'ozon' | 'kaspi' | 'satu' | 'halyk'
type SupplySubTab = 'create' | 'editor' | 'all' | 'archive' | 'analytics'
type AnalyticsSubTab = 'summary' | 'topProducts' | 'noSales' | 'production'

type ProductionAnalyticsSummaryRow = {
  userId?: string
  userName: string
  role: string
  avatarUrl: string
  taskCount: number
  itemCount: number
}

type ProductionAnalyticsReport = {
  summary: ProductionAnalyticsSummaryRow[]
  tasks: ProductionTask[]
}

type ProductionAnalyticsAssignee = {
  id: string
  displayName: string
  userName: string
  role: string
  avatarUrl: string
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
  const [activeTab, setActiveTab] = useState<TabId>('home')
  const [shopRegion, setShopRegion] = useState<ShopRegion>(() => readShopRegion())
  const [kzMarketplace, setKzMarketplace] = useState<KzMarketplace>(() => readKzMarketplace())
  const [kzTaskMarketplace, setKzTaskMarketplace] = useState<KzMarketplace>(() => readKzMarketplace())
  const [isLoading, setIsLoading] = useState(true)
  const [loginError, setLoginError] = useState('')
  const [ozonStatus, setOzonStatus] = useState('')
  const [ozonProducts, setOzonProducts] = useState<OzonProduct[]>([])
  const [productSearch, setProductSearch] = useState('')
  const [productStatusFilter, setProductStatusFilter] = useState<'all' | 'selling' | 'ready' | 'archived'>('all')
  const [stockStatus, setStockStatus] = useState('')
  const [ozonStocks, setOzonStocks] = useState<OzonStock[]>([])
  const [stockSearch, setStockSearch] = useState('')
  const [stockSortDirection, setStockSortDirection] = useState<'desc' | 'asc' | null>(null)
  const [priceStatus, setPriceStatus] = useState('')
  const [editingPrices, setEditingPrices] = useState<Record<number, string>>({})
  const [analyticsStatus, setAnalyticsStatus] = useState('')
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
  const [analyticsSubTab, setAnalyticsSubTab] = useState<AnalyticsSubTab>('summary')
  const [analyticsDateFrom, setAnalyticsDateFrom] = useState(getDefaultAnalyticsDateFrom)
  const [analyticsDateTo, setAnalyticsDateTo] = useState(getDefaultAnalyticsDateTo)
  const [productionAnalyticsDateFrom, setProductionAnalyticsDateFrom] = useState(getDefaultAnalyticsDateFrom)
  const [productionAnalyticsDateTo, setProductionAnalyticsDateTo] = useState(getDefaultAnalyticsDateTo)
  const [productionAnalyticsUserId, setProductionAnalyticsUserId] = useState('')
  const [productionAnalyticsAssignees, setProductionAnalyticsAssignees] = useState<ProductionAnalyticsAssignee[]>([])
  const [productionAnalyticsReport, setProductionAnalyticsReport] = useState<ProductionAnalyticsReport | null>(null)
  const [productionAnalyticsStatus, setProductionAnalyticsStatus] = useState('')
  const [productionAnalyticsDetailUserName, setProductionAnalyticsDetailUserName] = useState<string | null>(null)
  const [productionAnalyticsEditingTask, setProductionAnalyticsEditingTask] = useState<ProductionTask | null>(null)
  const [analyticsRowSearch, setAnalyticsRowSearch] = useState('')
  const [analyticsStatusFilter, setAnalyticsStatusFilter] = useState<
    'all' | 'awaiting_deliver' | 'delivering' | 'delivered' | 'cancelled'
  >('all')
  const [unsoldProductStatusFilter, setUnsoldProductStatusFilter] = useState<'all' | 'selling' | 'ready'>('all')
  const [expandedAnalyticsProductKeys, setExpandedAnalyticsProductKeys] = useState<Record<string, boolean>>({})
  const [productionSearch, setProductionSearch] = useState('')
  const [productionSubTab, setProductionSubTab] = useState<ProductionSubTab>('products')
  const [taskFormMode, setTaskFormMode] = useState<TaskFormMode>(() =>
    getDefaultTaskFormMode(readShopRegion(), undefined, readKzMarketplace()),
  )
  const [productionCatalogTab, setProductionCatalogTab] = useState<ProductionCatalogTab>(() =>
    readShopRegion() === 'rf' ? 'ozon' : readKzMarketplace(),
  )
  const [kzProducts, setKzProducts] = useState<Record<KzMarketplace, OzonProduct[]>>({
    kaspi: [],
    satu: [],
    halyk: [],
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
  const [cancelTaskId, setCancelTaskId] = useState<string | null>(null)
  const [cancelTaskComment, setCancelTaskComment] = useState('')
  const [draftTaskItems, setDraftTaskItems] = useState<DraftTaskItem[]>([])
  const [actualQuantities, setActualQuantities] = useState<Record<string, string>>({})
  const [supplySubTab, setSupplySubTab] = useState<SupplySubTab>('create')
  const [supplies, setSupplies] = useState<Supply[]>([])
  const [supplySearch, setSupplySearch] = useState('')
  const [supplyStatusFilter, setSupplyStatusFilter] = useState<'all' | SupplyStatus>('all')
  const [supplyAnalytics, setSupplyAnalytics] = useState<SupplyAnalyticsItem[]>([])
  const [supplyStatus, setSupplyStatus] = useState('')
  const [supplyProductId, setSupplyProductId] = useState('')
  const [supplyQuantity, setSupplyQuantity] = useState('')
  const [reserveQuantity, setReserveQuantity] = useState('')
  const [draftSupplyItems, setDraftSupplyItems] = useState<DraftSupplyItem[]>([])
  const [replaceProducts, setReplaceProducts] = useState<Record<string, string>>({})
  const [editingSupplyId, setEditingSupplyId] = useState<string | null>(null)
  const [editSupplyItems, setEditSupplyItems] = useState<DraftSupplyItem[]>([])
  const [editSupplyProductId, setEditSupplyProductId] = useState('')
  const [editSupplyQuantity, setEditSupplyQuantity] = useState('')
  const [editReserveQuantity, setEditReserveQuantity] = useState('')
  const [analyticsProductKey, setAnalyticsProductKey] = useState('')
  const [showSupplyHelp, setShowSupplyHelp] = useState(false)
  const [showCreateSupplyModal, setShowCreateSupplyModal] = useState(false)
  const [supplyImportFile, setSupplyImportFile] = useState<File | null>(null)
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
  const [roleProfiles, setRoleProfiles] = useState<RoleProfile[]>([])
  const [roleProfileEdits, setRoleProfileEdits] = useState<Record<string, RoleProfile>>({})
  const [roleProfilesStatus, setRoleProfilesStatus] = useState('')
  const [userTelegramData, setUserTelegramData] = useState<Record<string, AdminUserTelegram>>({})
  const [userTelegramEvents, setUserTelegramEvents] = useState<Record<string, string[]>>({})
  const [userTelegramStatus, setUserTelegramStatus] = useState<Record<string, string>>({})
  const [userReportData, setUserReportData] = useState<Record<string, AdminUserReport>>({})
  const [userReportSections, setUserReportSections] = useState<Record<string, string[]>>({})
  const [userReportStatus, setUserReportStatus] = useState<Record<string, string>>({})
  const [reportSections, setReportSections] = useState<ReportSection[]>([])
  const [reportsStatus, setReportsStatus] = useState('')
  const [integrationsSubTab, setIntegrationsSubTab] = useState<'connections' | 'telegram-notifications' | 'telegram-reports'>('connections')
  const [integrationAdminUserId, setIntegrationAdminUserId] = useState('')
  const [profilePasswordForm, setProfilePasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [userSettingsEdits, setUserSettingsEdits] = useState<Record<string, User>>({})
  const [savedUserSettingsIds, setSavedUserSettingsIds] = useState<Record<string, true>>({})
  const savedUserSettingsTimeoutsRef = useRef<Record<string, number>>({})
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
  const selectedChatKey = `${selectedChatType}:${selectedChatId}`
  const selectedChatKeyRef = useRef('')
  const creatingGroupRef = useRef(false)
  const normalizedProductSearch = productSearch.trim().toLowerCase()
  const activeKzProducts = kzProducts[kzMarketplace]
  const activeKzStocks = kzStocks[kzMarketplace]
  const catalogProductsSource = shopRegion === 'rf' ? ozonProducts : activeKzProducts
  const catalogStocksSource = shopRegion === 'rf' ? ozonStocks : activeKzStocks
  const catalogProductsStatus = shopRegion === 'rf' ? ozonStatus : kzProductsStatus[kzMarketplace]
  const catalogStocksStatus = shopRegion === 'rf' ? stockStatus : kzStocksStatus[kzMarketplace]
  const productionLookupProducts =
    shopRegion === 'rf'
      ? ozonProducts
      : activeTab === 'production' && productionSubTab !== 'products'
        ? kzProducts[kzTaskMarketplace]
        : kzProducts[kzMarketplace]
  const productStatusCounts = useMemo(() => {
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

    return counts
  }, [catalogProductsSource])
  const filteredCatalogProducts = [...((
    productStatusFilter !== 'all'
      ? catalogProductsSource.filter((item) => getProductStatusGroup(item.status) === productStatusFilter)
      : catalogProductsSource
  ).filter((item) =>
    normalizedProductSearch
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
    filteredProductionTasks.filter((task) => task.status === 'InProgress' && !task.isArchived),
  )
  const cancelledProductionTasks = sortProductionTasksByUrgency(
    filteredProductionTasks.filter((task) => task.status === 'Cancelled' && !task.isArchived),
  )
  const completedProductionTasks = sortProductionTasksByUrgency(
    filteredProductionTasks.filter((task) => task.status === 'Completed' && !task.isArchived),
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
  const editorNovinkaCatalogItems = useMemo(
    () =>
      filterNovinkaCatalogByMarketplace(
        novinkaProductionCatalogItems,
        shopRegion === 'rf' ? 'ozon' : (activeNovinkaCatalogMarketplace ?? kzMarketplace),
      ),
    [novinkaProductionCatalogItems, shopRegion, activeNovinkaCatalogMarketplace, kzMarketplace],
  )
  const supplyNovinkaCatalogItems = useMemo(
    () => filterNovinkaCatalogByMarketplace(novinkaProductionCatalogItems, 'ozon'),
    [novinkaProductionCatalogItems],
  )
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
  const editorSelectedOzon = ozonProducts.find(
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
    for (const product of ozonProducts) {
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
  }, [ozonProducts])
  const topAnalyticsProducts = (analytics?.topProducts ?? [])
    .map((row) => ({
      ...row,
      key: row.sku ? `sku:${row.sku}` : `offer:${row.offerId}`,
    }))
    .sort((left, right) => right.quantity - left.quantity)
  const unsoldAnalyticsProducts = (analytics?.unsoldProducts ?? [])
    .map((row) => ({
      ...row,
      key: row.sku ? `sku:${row.sku}` : `offer:${row.offerId}`,
    }))
    .sort((left, right) => (right.daysWithoutSales ?? 0) - (left.daysWithoutSales ?? 0) || left.offerId.localeCompare(right.offerId, 'ru'))
  const unsoldProductStatusCounts = useMemo(() => {
    const counts = { all: unsoldAnalyticsProducts.length, selling: 0, ready: 0 }

    for (const row of unsoldAnalyticsProducts) {
      const group = getProductStatusGroup(row.status)
      if (group === 'selling') {
        counts.selling += 1
      } else if (group === 'ready') {
        counts.ready += 1
      }
    }

    return counts
  }, [unsoldAnalyticsProducts])
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
  const canCreateProductionTasks = () => hasFeature('production.createTask')
  const canCancelProductionTasks = () => hasFeature('production.cancelTasks')
  const canEditProductionProducts = () => hasFeature('production.editProducts')
  const canDeleteProductionFiles = () => hasFeature('production.deleteFiles')
  const canArchiveProductionTasks = () => hasFeature('production.archive')
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
  const kzCatalogAnalyticsProducts = useMemo(() => {
    if (shopRegion !== 'kz') {
      return []
    }

    return kzProducts[kzMarketplace].map((product) => ({
      key: product.sku ? `sku:${product.sku}` : `offer:${product.offerId}`,
      productName: product.name,
      offerId: product.offerId,
      sku: product.sku,
      status: product.status,
      imageUrl: product.imageUrl,
      price: product.price,
      currencyCode: product.currencyCode,
      stockTotal: 0,
    }))
  }, [shopRegion, kzMarketplace, kzProducts])
  const filteredKzCatalogAnalyticsProducts = useMemo(() => {
    const filtered =
      unsoldProductStatusFilter === 'all'
        ? kzCatalogAnalyticsProducts
        : kzCatalogAnalyticsProducts.filter(
            (row) => getProductStatusGroup(row.status) === unsoldProductStatusFilter,
          )

    const query = analyticsRowSearch.trim().toLowerCase()
    if (!query) {
      return filtered
    }

    return filtered.filter((row) =>
      [row.productName, row.offerId, row.sku]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query)),
    )
  }, [kzCatalogAnalyticsProducts, unsoldProductStatusFilter, analyticsRowSearch])
  const kzUnsoldProductStatusCounts = useMemo(() => {
    const counts = { all: kzCatalogAnalyticsProducts.length, selling: 0, ready: 0 }

    for (const row of kzCatalogAnalyticsProducts) {
      const group = getProductStatusGroup(row.status)
      if (group === 'selling') {
        counts.selling += 1
      } else if (group === 'ready') {
        counts.ready += 1
      }
    }

    return counts
  }, [kzCatalogAnalyticsProducts])
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
    ]
    if (activeTab === 'supplies' && !hasSubFeature(`supplies.${supplySubTab}`, 'supplies')) {
      setSupplySubTab(supplyFallbacks.find(([, feature]) => hasSubFeature(feature, 'supplies'))?.[0] ?? 'create')
    }

    const analyticsFallbacks: Array<[AnalyticsSubTab, string]> = [
      ['summary', 'analytics.summary'],
      ['topProducts', 'analytics.topProducts'],
      ['noSales', 'analytics.noSales'],
      ['production', 'analytics.production'],
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
    selectedChatKeyRef.current = selectedChatKey
  }, [selectedChatKey])

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
    })

    connection.on('ChatMessagesChanged', (senderId: string, receiverId: string | null, groupId: string | null) => {
      loadChatThreads()
      const activeKey = selectedChatKeyRef.current
      const activeMatch =
        groupId
          ? activeKey === `group:${groupId}`
          : user?.id === senderId || user?.id === receiverId
      if (activeMatch && selectedChatId) {
        loadChatMessages(selectedChatType, selectedChatId)
      }
    })

    connection.on('ChatThreadsChanged', () => {
      loadChatThreads()
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
    loadSupplies()
    loadSupplyAnalytics()
  }, [token, user?.id, user?.role])

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
    if (!token || shopRegion !== 'kz') {
      return
    }

    if (activeTab === 'home') {
      for (const marketplace of ['kaspi', 'satu', 'halyk'] as const) {
        if (kzProducts[marketplace].length === 0) {
          void loadKzProducts(marketplace)
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

    if (activeTab === 'products' && kzProducts[kzMarketplace].length === 0) {
      void loadKzProducts(kzMarketplace)
    }

    if (activeTab === 'analytics') {
      for (const marketplace of ['kaspi', 'satu', 'halyk'] as const) {
        if (kzProducts[marketplace].length === 0) {
          void loadKzProducts(marketplace)
        }
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
  ])

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
    if (!token || activeTab !== 'analytics' || !hasFeature('analytics') || shopRegion !== 'rf') {
      return
    }

    setAnalyticsDateFrom(getDefaultAnalyticsDateFrom())
    setAnalyticsDateTo(getDefaultAnalyticsDateTo())
    void loadAnalyticsSnapshot()
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
    }

    if (integrationsSubTab === 'telegram-reports') {
      void loadUserReport(integrationAdminUserId)
    }
  }, [activeTab, canManageIntegrationUsers, integrationsSubTab, integrationAdminUserId])

  useEffect(() => {
    if (activeTab !== 'integrations' || !hasFeature('integrations')) {
      return
    }

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
    const intervalId = window.setInterval(() => loadChatMessages(selectedChatType, selectedChatId), 5000)
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
    selectedChatKeyRef.current = ''
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
    setNewUser((current) => ({
      ...current,
      homeBlocks:
        current.homeBlocks.length > 0
          ? current.homeBlocks
          : getRoleProfileHomeBlocks(current.role, data),
    }))
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
    setUserTelegramStatus((current) => ({ ...current, [userId]: '' }))
  }

  async function saveUserTelegramPreferences(userId: string) {
    const events = userTelegramEvents[userId] ?? []
    setUserTelegramStatus((current) => ({ ...current, [userId]: 'Сохраняем оповещения...' }))

    const response = await fetch(`/api/admin/users/${userId}/telegram/preferences`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ events }),
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
    setUserTelegramStatus((current) => ({ ...current, [userId]: 'Оповещения сохранены' }))
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

  async function loadTelegramNotificationEvents() {
    const response = await fetch('/api/integrations/notification-events', {
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
    const response = await fetch('/api/production/tasks/archive/export', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

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
    const response = await fetch('/api/chat/threads', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      return
    }

    const data: ChatThread[] = await response.json()
    const normalizedData = data.map(normalizeApiThread)
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
    if (selectedChatType === 'group' && selectedChatId) {
      const groupThread = normalizedData.find((item) => item.type === 'group' && isSameChatId(item.id, selectedChatId))
      if (groupThread?.members?.length) {
        setChatGroupDetail({
          id: groupThread.id,
          name: groupThread.title,
          createdByUserId: groupThread.createdByUserId ?? '',
          members: groupThread.members,
        })
      }
    }
    const hasCurrent = normalizedData.some(
      (item) => isSameChatId(item.id, selectedChatId) && item.type === selectedChatType,
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

  async function loadChatMessages(chatType = selectedChatType, chatId = selectedChatId) {
    if (!chatId) {
      setChatMessages([])
      return
    }

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

    const data: ChatMessage[] = await response.json()
    const threadKey = `${chatType}:${chatId}`
    const previousMessageIds = knownChatMessageIdsRef.current[threadKey]
    if (previousMessageIds) {
      const incomingMessages = data.filter((message) => !message.isOwn && !previousMessageIds.has(message.id))
      if (incomingMessages.length > 0) {
        const lastMessage = incomingMessages[incomingMessages.length - 1]
        showBrowserNotification(
          chatType === 'group' ? 'Новое сообщение в группе' : 'Новое сообщение',
          lastMessage.text || lastMessage.attachmentFileName || 'Вложение',
        )
      }
    }

    knownChatMessageIdsRef.current[threadKey] = new Set(data.map((message) => message.id))
    setChatMessages(data)
    await loadChatThreads()
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

    setChatText('')
    setChatFile(null)
    setChatStatus('')
    await loadChatMessages(selectedChatType, selectedChatId)
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
    setUsers((current) => [...current, createdUser])
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
    setUsers((current) => current.map((item) => (item.id === id ? updatedUser : item)))
    if (user?.id === id) {
      setUser(updatedUser)
      localStorage.setItem('authUser', JSON.stringify(updatedUser))
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

    setUsers((current) => current.filter((item) => item.id !== id))
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

  async function loadKzProducts(marketplace: KzMarketplace = kzMarketplace) {
    const label = getKzMarketplaceLabel(marketplace)
    setKzProductsStatus((current) => ({ ...current, [marketplace]: `Загружаем товары ${label}...` }))

    const response = await fetch(`/api/kz/${marketplace}/products`, {
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
      return
    }

    const data: OzonProduct[] = await response.json()
    setKzProducts((current) => ({ ...current, [marketplace]: data }))
    setKzProductsStatus((current) => ({
      ...current,
      [marketplace]: `Загружено товаров ${label}: ${data.length}`,
    }))
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
        : `Укажите ID и API Key ${label}`,
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

  async function loadHomeKzAnalytics(marketplace: KzMarketplace) {
    const label = getKzMarketplaceLabel(marketplace)
    setHomeKzAnalyticsStatus((current) => ({
      ...current,
      [marketplace]: `Загружаем аналитику ${label} за текущий месяц...`,
    }))

    const params = new URLSearchParams({
      dateFrom: getDefaultAnalyticsDateFrom(),
      dateTo: getDefaultAnalyticsDateTo(),
    })

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

  async function loadAnalyticsSnapshot() {
    const response = await fetch('/api/ozon/analytics/snapshot', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      setAnalyticsStatus(getApiErrorMessage(await response.text(), 'Не удалось получить сводку Ozon'))
      return
    }

    const data: OzonAnalyticsSnapshot = await response.json()
    setAnalyticsSnapshot(data)
  }

  async function loadAnalytics() {
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
    setAnalyticsStatus(`Аналитика за период обновлена: ${data.timestamp}`)
  }

  async function refreshAnalytics() {
    if (shopRegion === 'kz') {
      if (analyticsSubTab === 'production') {
        await loadProductionAnalyticsReport()
      } else if (kzProducts[kzMarketplace].length === 0) {
        await loadKzProducts(kzMarketplace)
      }
      return
    }

    if (analyticsSubTab === 'production') {
      await loadProductionAnalyticsReport()
      return
    }

    await Promise.all([loadAnalyticsSnapshot(), loadAnalytics()])
  }

  async function loadProductionAnalyticsAssignees() {
    const response = await fetch('/api/production/analytics/assignees', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      setProductionAnalyticsAssignees([])
      return
    }

    const data: ProductionAnalyticsAssignee[] = await response.json()
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

    const response = await fetch(`/api/production/analytics/report?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      setProductionAnalyticsStatus(getApiErrorMessage(await response.text(), 'Не удалось загрузить отчёт'))
      return
    }

    const data: ProductionAnalyticsReport = await response.json()
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

    const response = await fetch(`/api/production/analytics/export?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

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
    const response = await fetch(`/api/production/analytics/records/${task.id}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
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
      }),
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
    const safeName = group.productName.replace(/[^\wа-яА-ЯёЁ\s-]+/gi, '').trim().slice(0, 40) || 'product'
    const period =
      analyticsDateFrom && analyticsDateTo ? `${analyticsDateFrom}_${analyticsDateTo}` : 'period'
    void exportAnalyticsOrderRowsExcel(rows, `analytics-${safeName}-${period}`, safeName)
  }

  async function loadProductionFiles(search: string) {
    const params = new URLSearchParams()
    if (search.trim()) {
      params.set('search', search.trim())
    }

    const query = params.toString()
    const suffix = query ? `?${query}` : ''
    const [filesResponse, pathsResponse] = await Promise.all([
      fetch(`/api/production/files${suffix}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }),
      fetch(`/api/production/file-paths${suffix}`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }),
    ])

    if (!filesResponse.ok) {
      setProductionStatus('Не удалось загрузить данные производства')
      setProductionFiles([])
      setProductionFilePaths([])
      return
    }

    const data: ProductionFile[] = await filesResponse.json()
    setProductionFiles(data)
    if (pathsResponse.ok) {
      const paths: ProductionFilePath[] = await pathsResponse.json()
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
    const marketplace = resolveNovinkaMarketplaceFromTaskType(taskType, shopRegion, kzTaskMarketplace)
    const formData = new FormData()
    formData.append('ozonProductId', item.ozonProductId > 0 ? String(item.ozonProductId) : '0')
    formData.append('offerId', item.offerId)
    formData.append('productName', item.productName)
    formData.append('productLink', item.productLink ?? '')
    formData.append('notes', appendNovinkaMarketplaceNote('', marketplace))
    formData.append('file', file)

    const response = await fetch('/api/production/files', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    })

    if (!response.ok) {
      setTaskStatus('Не удалось загрузить файл')
      return
    }

    setTaskStatus('Файл загружен')
    await loadProductionFiles(productionSearch)
  }

  async function downloadProductionFile(id: string) {
    const response = await fetch(`/api/production/files/${id}/download`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

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
    if (!window.confirm('Удалить файл производства?')) {
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
      const response = await fetch(`/api/production/files/${id}`, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

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
          ? 'Файл удалён. Товар убран из списка, создана новая задача для новинки.'
          : 'Файл удалён',
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
    const response = await fetch('/api/production/tasks', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      setTaskStatus('Не удалось загрузить задачи')
      return
    }

    const data: ProductionTask[] = await response.json()
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

  function resetTaskForm() {
    setDraftTaskItems([])
    setTaskIsUrgent(false)
    setSelectedTaskProductId('')
    setSelectedTaskNovinkaOfferId('')
    setTaskQuantity('')
    setTaskNovinkaQuantity('')
    setEditingTaskId(null)
  }

  function resetNovinkaTaskForm() {
    setDraftNovinkaItems([])
    setNovinkaProductName('')
    setNovinkaProductLink('')
    setTaskIsUrgent(false)
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

    if (selectedNovinka.fileCount <= 0) {
      setTaskFormStatus('У выбранной новинки нет файлов производства')
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
      setProductEditorStatus('Выберите товар Ozon из списка.')
      return
    }

    setProductEditorSaving(true)
    setProductEditorStatus('')

    try {
      const response = await fetch('/api/production/catalog/convert-to-ozon', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sourceOfferId: sourceNovinka.offerId,
          sourceProductName: sourceNovinka.productName,
          sourceProductLink: sourceNovinka.productLink,
          targetOzonProductId,
        }),
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
      setProductionCatalogTab('ozon')
      setProductEditorStatus(
        `Тип изменён на Ozon: ${result.productName} (${result.offerId}). Файлов сохранено: ${result.updatedFileCount}.`,
      )
    } finally {
      setProductEditorSaving(false)
    }
  }

  function addDraftNovinkaItem() {
    const productName = novinkaProductName.trim()
    const productLink = novinkaProductLink.trim()

    if (!productName || !productLink) {
      setTaskFormStatus('Укажите наименование и ссылку на товар')
      return
    }

    setDraftNovinkaItems((current) => [
      ...current,
      {
        tempId: createTempId(),
        productName,
        productLink,
      },
    ])
    setNovinkaProductName('')
    setNovinkaProductLink('')
    setTaskFormStatus('')
    setTaskStatus('Новинка добавлена в задачу')
  }

  function getTaskFormProducts(mode: TaskFormMode = taskFormMode): OzonProduct[] {
    if (shopRegion === 'rf') {
      return ozonProducts
    }

    if (mode === 'kaspi' || mode === 'satu' || mode === 'halyk') {
      return kzProducts[mode] ?? []
    }

    return kzProducts[kzTaskMarketplace] ?? []
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

    if (isNovinkaTask(task)) {
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
        })),
      )
      setShowCreateNovinkaTaskModal(true)
      return
    }

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

  function addDraftTaskItem() {
    const productsSource = getTaskFormProducts()
    const product = productsSource.find((item) => String(item.productId) === selectedTaskProductId)
    const quantity = Number(taskQuantity)

    if (!product || !Number.isFinite(quantity) || quantity <= 0) {
      setTaskStatus('Выберите товар и укажите количество')
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
    if (productName && productLink) {
      novinkaItems = [
        ...novinkaItems,
        {
          tempId: createTempId(),
          productName,
          productLink,
        },
      ]
    }

    if (novinkaItems.length === 0) {
      setTaskFormStatus('Добавьте новинку или заполните наименование и ссылку')
      return
    }

    setTaskFormSaving(true)
    setTaskFormStatus('')

    const itemPayload = novinkaItems.map((item) => ({
      ozonProductId: 0,
      offerId: item.offerId ?? '',
      productName: (item.productName ?? '').trim(),
      productLink: appendNovinkaMarketplaceNote(item.productLink ?? '', novinkaTaskMarketplace),
      requiredQuantity: 0,
      enforceMinimumQuantity: false,
    }))

    const payload = taskIdBeingEdited
      ? { isUrgent: taskIsUrgent, items: itemPayload }
      : { taskType: 'Novinka', isUrgent: taskIsUrgent, items: itemPayload }

    try {
      const response = await fetch(
        taskIdBeingEdited ? `/api/production/tasks/${taskIdBeingEdited}` : '/api/production/tasks',
        {
          method: taskIdBeingEdited ? 'PUT' : 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        },
      )

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

    const product = ozonProducts.find((item) => String(item.productId) === selectedTaskProductId)
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
    if (novinka && Number.isFinite(novinkaQuantity) && novinkaQuantity > 0 && novinka.fileCount > 0) {
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
      taskType:
        shopRegion === 'rf'
          ? 'Ozon'
          : isMarketplaceTaskFormMode(taskFormMode)
            ? getKzTaskType(taskFormMode as KzMarketplace)
            : getKzTaskType(kzTaskMarketplace),
      isUrgent: taskIsUrgent,
      items: normalizedOzonItems.map((item) => ({
        ozonProductId: item.ozonProductId ?? 0,
        offerId: item.offerId,
        productName: item.productName,
        productLink: item.productLink,
        requiredQuantity: item.requiredQuantity,
        enforceMinimumQuantity: item.enforceMinimumQuantity ?? false,
      })),
    }

    try {
      const response = await fetch(
        taskIdBeingEdited ? `/api/production/tasks/${taskIdBeingEdited}` : '/api/production/tasks',
        {
          method: taskIdBeingEdited ? 'PUT' : 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
        },
      )

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
    const response = await fetch(`/api/production/tasks/${id}/start`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

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

    const response = await fetch(`/api/production/tasks/${cancelTaskId}/cancel`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ comment }),
    })

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
        (item) => getProductionFilesForTaskItem(item, productionFiles).length === 0,
      )
      const missingPaths = taskItems.filter(
        (item) => getProductionPathsForTaskItem(item, productionFilePaths).length === 0,
      )
      if (missingFiles.length > 0) {
        setTaskStatus(`Добавьте файлы: ${missingFiles.map((item) => item.productName).join(', ')}`)
        return
      }
      if (missingPaths.length > 0) {
        setTaskStatus(`Укажите путь к файлу: ${missingPaths.map((item) => item.productName).join(', ')}`)
        return
      }

      const response = await fetch(`/api/production/tasks/${id}/complete`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ actualQuantity: 0, items: [] }),
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
      actualQuantity: Number(actualQuantities[item.id]),
    }))

    if (
      completedItems.length === 0 ||
      completedItems.some((item) => !Number.isFinite(item.actualQuantity) || item.actualQuantity < 0)
    ) {
      setTaskStatus('Укажите фактическое количество по каждому товару')
      return
    }

    for (const item of taskItems) {
      const actualQuantity = Number(actualQuantities[item.id])
      if (item.enforceMinimumQuantity && actualQuantity < item.requiredQuantity) {
        setTaskStatus(`По «${item.productName}» факт не может быть меньше ${item.requiredQuantity}`)
        return
      }
    }

    const actualQuantity = completedItems.reduce((sum, item) => sum + item.actualQuantity, 0)

    const response = await fetch(`/api/production/tasks/${id}/complete`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ actualQuantity, items: completedItems }),
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

    const response = await fetch(`/api/production/tasks/${id}/archive`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      const message = await response.text()
      setTaskStatus(message || 'Не удалось архивировать задачу')
      return
    }

    setTaskStatus('Задача отправлена в архив')
    await loadProductionTasks()
  }

  async function restoreProductionTask(id: string) {
    const response = await fetch(`/api/production/tasks/${id}/restore`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

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

    const response = await fetch(`/api/production/tasks/${id}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

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
      },
    ])
    setSupplyProductId('')
    setSupplyQuantity('')
    setSupplyStatus('Товар добавлен в поставку')
  }

  function addReserveSupplyProduct() {
    const quantity = Number(reserveQuantity)
    const selectedNovinka = supplyNovinkaCatalogItems.find((item) => item.offerId === selectedNovinkaOfferId)

    if (!selectedNovinka || !Number.isFinite(quantity) || quantity <= 0) {
      setSupplyStatus('Выберите новинку из списка и укажите количество')
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
      },
    ])
    setSelectedNovinkaOfferId('')
    setReserveQuantity('')
    setSupplyStatus('Новинка добавлена в поставку')
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

  async function updateSupplyDates(id: string, sentAt?: string, acceptedAt?: string) {
    const response = await fetch(`/api/supplies/${id}/dates`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sentAt: sentAt ?? null,
        acceptedAt: acceptedAt ?? null,
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

  async function updateSupplyStatus(id: string, status: SupplyStatus) {
    if (
      status === 'Sent' &&
      !window.confirm('Подтвердите отправку поставки. После этого обычный пользователь уже не сможет ее редактировать.')
    ) {
      return
    }

    const response = await fetch(`/api/supplies/${id}/status`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status }),
    })

    if (!response.ok) {
      const message = await response.text()
      setSupplyStatus(message || 'Не удалось сохранить статус поставки')
      return
    }

    setSupplyStatus('Статус поставки сохранен')
    await loadSupplies()
    if (user?.role === 'Admin') {
      await loadSupplyAnalytics()
    }
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
        }),
        quantity: item.quantity,
        isReserve: item.isReserve,
      })),
    )
    setEditSupplyProductId('')
    setEditSupplyQuantity('')
    setSelectedNovinkaOfferId('')
    setEditReserveQuantity('')
  }

  function cancelEditSupply() {
    setEditingSupplyId(null)
    setEditSupplyItems([])
    setEditSupplyProductId('')
    setEditSupplyQuantity('')
    setSelectedNovinkaOfferId('')
    setEditReserveQuantity('')
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
      },
    ])
    setEditSupplyProductId('')
    setEditSupplyQuantity('')
  }

  function addEditReserveSupplyProduct() {
    const quantity = Number(editReserveQuantity)
    const selectedNovinka = supplyNovinkaCatalogItems.find((item) => item.offerId === selectedNovinkaOfferId)

    if (!selectedNovinka || !Number.isFinite(quantity) || quantity <= 0) {
      setSupplyStatus('Выберите новинку из списка и укажите количество')
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
      },
    ])
    setSelectedNovinkaOfferId('')
    setEditReserveQuantity('')
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
                        onRefresh={() => void loadHomeKzAnalytics(marketplace)}
                      />
                    ))}
                  </div>
                )}

                {hasVisibleKzHomeBlock('products') && (
                  <div className="home-blocks home-blocks-kz-row">
                    {getHomeBlockKzMarketplaces('products').map((marketplace) => {
                      const label = getKzMarketplaceLabel(marketplace)
                      const stats = computeCatalogProductStats(kzProducts[marketplace])

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
                          onRefresh={() => void loadKzProducts(marketplace)}
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
                      Новинка
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
                      ozonProducts={productionLookupProducts}
                      selectedNovinkaOfferId={editorNovinkaOfferId}
                      selectedOzonProductId={editorOzonProductId}
                      onNovinkaOfferIdChange={setEditorNovinkaOfferId}
                      onOzonProductIdChange={setEditorOzonProductId}
                      selectedNovinka={editorSelectedNovinka}
                      selectedOzon={editorSelectedOzon}
                      status={productEditorStatus}
                      saving={productEditorSaving}
                      onConvert={() => void convertNovinkaToOzon()}
                      onLoadOzonProducts={() => void loadOzonProducts()}
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
                        ? `Новинки ${getNovinkaMarketplaceLabel(activeNovinkaCatalogMarketplace)} с файлами · ${filteredProductionCatalog.length}`
                        : shopRegion === 'rf'
                          ? `Все товары Ozon · ${filteredProductionCatalog.length}`
                          : `Все товары ${getKzMarketplaceLabel(productionCatalogTab as KzMarketplace)} · ${filteredProductionCatalog.length}`}
                    </p>
                  </div>

                  <div className="data-table">
                    <div className="table-row production-product-row table-head">
                      <span>Товар</span>
                      <span>{isMarketplaceProductionCatalogTab ? 'Артикул' : 'Ссылка'}</span>
                      <span>Файлы</span>
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
                                  Файлы ({itemFiles.length})
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
                              ? `Пока нет новинок ${getNovinkaMarketplaceLabel(activeNovinkaCatalogMarketplace)} с файлами для производства.`
                              : 'Пока нет новинок с файлами для производства.'}
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
                          Новинка
                        </button>
                      )}
                      <button type="button" onClick={openCreateTaskModal}>
                        Создать задачу
                      </button>
                    </div>
                  )}

                  {showCreateTaskModal && (canCreateProductionTasks() || (editingTaskId && canEditProductionTasks())) && (
                    <div className="modal-backdrop" role="presentation">
                      <div className="modal-card modal-card-wide" role="dialog" aria-modal="true">
                        <div className="modal-title-row">
                          <h3>{editingTaskId ? 'Редактировать задачу' : 'Создать задачу'}</h3>
                          <button type="button" onClick={closeTaskFormModal}>
                            Закрыть
                          </button>
                        </div>

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
                                    ? 'Товар из Ozon'
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
                                      </div>
                                    ) : (
                                      <div className="task-form-modal-preview task-form-modal-preview-empty">
                                        <span>Выберите товар для превью</span>
                                      </div>
                                    )
                                  })()}
                                  <div className="task-form-modal-actions">
                                    <input
                                      className="task-quantity-input task-form-modal-qty"
                                      type="number"
                                      min="1"
                                      placeholder="Кол-во"
                                      value={taskQuantity}
                                      onChange={(event) => setTaskQuantity(event.target.value)}
                                    />
                                    <button type="button" className="task-form-modal-btn" onClick={addDraftTaskItem}>
                                      Добавить
                                    </button>
                                  </div>
                                </div>
                              </div>

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
                                    ) : (
                                      <div className="task-form-modal-preview task-form-modal-preview-empty">
                                        <span>Выберите новинку для превью</span>
                                      </div>
                                    )
                                  })()}
                                  <div className="task-form-modal-actions">
                                    <input
                                      className="task-quantity-input task-form-modal-qty"
                                      type="number"
                                      min="1"
                                      placeholder="Кол-во"
                                      value={taskNovinkaQuantity}
                                      onChange={(event) => setTaskNovinkaQuantity(event.target.value)}
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

                            return (
                            <div className="table-row task-draft-row" key={item.tempId}>
                              <span className="product-mini task-draft-product-mini">
                                {item.isNovinka && item.productLink ? (
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
                                      <small className="task-product-supply-hint-inline">Новинка · файлы на товаре</small>
                                      {(() => {
                                        const catalogItem: ProductionCatalogItem = {
                                          offerId: item.offerId,
                                          ozonProductId: item.ozonProductId || undefined,
                                          productName: item.productName,
                                          productLink: item.productLink ?? '',
                                          fileCount: 0,
                                        }
                                        const draftPaths = getProductionPathsForCatalogItem(catalogItem, productionFilePaths)
                                        return (
                                          <div className="task-draft-catalog-assets">
                                            {draftPaths.length > 0 && (
                                              <ProductionPathsPanel paths={draftPaths} showCopy />
                                            )}
                                          </div>
                                        )
                                      })()}
                                    </>
                                  )}
                                  {draftSupplyHint && (
                                    <small className="task-product-supply-hint-inline">{draftSupplyHint}</small>
                                  )}
                                </span>
                              </span>
                              <OfferIdCell offerId={item.offerId} />
                              <span>
                                <input
                                  className="task-quantity-input"
                                  type="number"
                                  min="1"
                                  value={item.requiredQuantity}
                                  onChange={(event) =>
                                    setDraftTaskItems((current) =>
                                      current.map((entry) =>
                                        entry.tempId === item.tempId
                                          ? {
                                              ...entry,
                                              requiredQuantity: Number(event.target.value) || 0,
                                            }
                                          : entry,
                                      ),
                                    )
                                  }
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
                              Укажите наименование и ссылку на товар. Превью и файлы производства появятся после
                              загрузки макетов при выполнении задачи.
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
                    isAdmin={user?.role === 'Admin'}
                    canCancelTasks={canCancelProductionTasks()}
                    onStart={startProductionTask}
                    onCancelRequest={setCancelTaskId}
                    onComplete={completeProductionTask}
                    onOpenFiles={openProductionFilesModal}
                    onUploadTaskItemFile={uploadProductionFileForTaskItem}
                    onDeleteFile={canDeleteProductionFiles() ? deleteProductionFile : undefined}
                    onEdit={canEditProductionTasks() ? openEditTaskModal : undefined}
                  />
                </>
              )}

              {productionSubTab === 'inProgress' && (
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
                  isAdmin={user?.role === 'Admin'}
                  canCancelTasks={canCancelProductionTasks()}
                  onStart={startProductionTask}
                  onCancelRequest={setCancelTaskId}
                  onComplete={completeProductionTask}
                  onOpenFiles={openProductionFilesModal}
                  onUploadTaskItemFile={uploadProductionFileForTaskItem}
                    onDeleteFile={canDeleteProductionFiles() ? deleteProductionFile : undefined}
                  />
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
                  isAdmin={user?.role === 'Admin'}
                  canCancelTasks={canCancelProductionTasks()}
                  onStart={startProductionTask}
                  onCancelRequest={setCancelTaskId}
                  onComplete={completeProductionTask}
                  onOpenFiles={openProductionFilesModal}
                  onUploadTaskItemFile={uploadProductionFileForTaskItem}
                    onDeleteFile={canDeleteProductionFiles() ? deleteProductionFile : undefined}
                  onArchive={canArchiveProductionTasks() ? archiveProductionTask : undefined}
                  onRestore={user?.role === 'Admin' ? restoreProductionTask : undefined}
                  cancelled
                />
              )}

              {productionSubTab === 'completed' && (
                <ProductionTaskArchiveTable
                  tasks={completedProductionTasks}
                  tableContext={roleTaskTableContext}
                  products={productionLookupProducts}
                  productionFiles={productionFiles}
                  productionFilePaths={productionFilePaths}
                  token={token}
                  onOpenFiles={openProductionFilesModal}
                  onDeleteFile={canDeleteProductionFiles() ? deleteProductionFile : undefined}
                  onArchive={canArchiveProductionTasks() ? archiveProductionTask : undefined}
                  emptyText="Выполненных задач пока нет."
                />
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
                    onDeleteFile={canDeleteProductionFiles() ? deleteProductionFile : undefined}
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

              <div className="subtabs-placeholder products-toolbar">
                {user?.role === 'Admin' && (
                  <button
                    type="button"
                    onClick={() => (shopRegion === 'rf' ? void loadOzonProducts() : void loadKzProducts())}
                  >
                    {shopRegion === 'rf'
                      ? 'Обновить товары Ozon'
                      : `Обновить товары ${getKzMarketplaceLabel(kzMarketplace)}`}
                  </button>
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
                      ? ` из ${catalogProductsSource.length}`
                      : ''}
                  </span>
                </div>
              )}

              <div className="data-table">
                <div className="table-row ozon-product-row table-head">
                  <span>Товар</span>
                  <span>Артикул</span>
                  <span>Статус</span>
                  <span>Фото</span>
                  <span>Цена</span>
                  <span>Ссылка</span>
                </div>
                {filteredCatalogProducts.map((item) => (
                  <div className="table-row ozon-product-row" key={item.productId}>
                    <span>
                      <strong>{item.name}</strong>
                      <small>{item.productId}</small>
                    </span>
                    <OfferIdCell offerId={item.offerId} />
                    <span>{translateProductStatus(item.status)}</span>
                    <span>
                      {item.imageUrl ? (
                        <ProductImageHoverPreview imageUrl={item.imageUrl} name={item.name}>
                          <ProductThumb imageUrl={item.imageUrl} name={item.name} />
                        </ProductImageHoverPreview>
                      ) : (
                        '-'
                      )}
                    </span>
                    <span>{formatMoney(item.price, item.currencyCode)}</span>
                    <span>
                      {item.productUrl ? (
                        <a href={item.productUrl} target="_blank" rel="noreferrer">
                          Открыть
                        </a>
                      ) : (
                        item.status
                      )}
                    </span>
                  </div>
                ))}
              </div>
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
              </div>
              <div className="subtabs-placeholder analytics-toolbar">
                {(analyticsSubTab === 'summary' || analyticsSubTab === 'noSales') && shopRegion === 'rf' && (
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
                    {analyticsSubTab === 'production' ? 'Обновить отчёт' : 'Обновить аналитику'}
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
              {analyticsSubTab === 'summary' && shopRegion === 'kz' && (
                <KzCatalogAnalyticsPanel
                  products={kzProducts[kzMarketplace]}
                  marketplace={kzMarketplace}
                />
              )}
              {analyticsSubTab === 'summary' && shopRegion === 'rf' && (
                <>
                  <AnalyticsPipelineBoard snapshot={analyticsSnapshot} analytics={analytics} />
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
              {analyticsSubTab === 'topProducts' && shopRegion === 'kz' && (
                <div className="empty-state">
                  <strong>Топ товаров {getKzMarketplaceLabel(kzMarketplace)}</strong>
                  <span>Данные Ozon в разделе KZ не отображаются.</span>
                </div>
              )}
              {analyticsSubTab === 'topProducts' && shopRegion === 'rf' && (
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
              {analyticsSubTab === 'noSales' && shopRegion === 'kz' && (
                <>
                  <div className="ozon-status">
                    <strong>Каталог {getKzMarketplaceLabel(kzMarketplace)}</strong>
                    <span>
                      Данные Ozon в KZ не используются · найдено: {filteredKzCatalogAnalyticsProducts.length}
                      {unsoldProductStatusFilter !== 'all'
                        ? ` из ${kzCatalogAnalyticsProducts.length}`
                        : ''}
                    </span>
                  </div>
                  <div className="analytics-table-toolbar">
                    <input
                      className="toolbar-search"
                      placeholder="Поиск по товару, артикулу или SKU"
                      value={analyticsRowSearch}
                      onChange={(event) => setAnalyticsRowSearch(event.target.value)}
                    />
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
                          <small>{kzUnsoldProductStatusCounts[value] ?? 0}</small>
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="data-table">
                    <div className="table-row unsold-products-row table-head">
                      <span>Товар</span>
                      <span>Артикул</span>
                      <span>SKU</span>
                      <span>Статус</span>
                      <span>Цена</span>
                    </div>
                    {filteredKzCatalogAnalyticsProducts.map((row) => (
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
                        <span>{translateProductStatus(row.status)}</span>
                        <span>{formatMoney(row.price, row.currencyCode)}</span>
                      </div>
                    ))}
                    {filteredKzCatalogAnalyticsProducts.length === 0 && (
                      <div className="empty-state">
                        <strong>
                          {kzCatalogAnalyticsProducts.length === 0
                            ? `Товары ${getKzMarketplaceLabel(kzMarketplace)} ещё не загружены.`
                            : 'Нет товаров с выбранным статусом.'}
                        </strong>
                      </div>
                    )}
                  </div>
                </>
              )}
              {analyticsSubTab === 'noSales' && shopRegion === 'rf' && (
                <>
                  <div className="ozon-status">
                    <strong>Товары без единой продажи</strong>
                    <span>
                      Сравнение каталога Ozon с заказами за период{' '}
                      {analyticsDateFrom && analyticsDateTo
                        ? `${analyticsDateFrom} — ${analyticsDateTo}`
                        : 'не выбран'}
                      {' · '}
                      найдено: {filteredUnsoldAnalyticsProducts.length}
                      {unsoldProductStatusFilter !== 'all'
                        ? ` из ${unsoldAnalyticsProducts.length}`
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
                      <span>В продаже с</span>
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
                        <span>{formatDaysWithoutSales(row.daysWithoutSales)}</span>
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
                          {sectionRows.map((row) => (
                            <article className="production-analytics-user-card" key={`${section}-${row.userName}`}>
                              <div className="production-analytics-user-card-main">
                                <UserAvatarPreview
                                  avatarUrl={row.avatarUrl}
                                  displayName={row.userName}
                                  className="production-analytics-avatar"
                                />
                                <div className="production-analytics-user-card-text">
                                  <strong>{row.userName}</strong>
                                  <span>{row.taskCount} задач · {row.itemCount} позиций</span>
                                </div>
                              </div>
                              <div className="production-analytics-user-card-actions">
                                <button
                                  type="button"
                                  className="text-action-button"
                                  onClick={() => {
                                    if (row.userId) {
                                      setProductionAnalyticsUserId(row.userId)
                                    }
                                    setProductionAnalyticsDetailUserName(row.userName)
                                  }}
                                >
                                  Подробнее
                                </button>
                                {row.userId && (
                                  <button
                                    type="button"
                                    className="text-action-button"
                                    onClick={() => void exportProductionAnalyticsExcel(row.userId)}
                                  >
                                    Excel
                                  </button>
                                )}
                              </div>
                            </article>
                          ))}
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
                      return items.map((item, itemIndex) => (
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
                              {itemIndex === 0 && (
                                <button
                                  type="button"
                                  className="text-action-button"
                                  onClick={() => setProductionAnalyticsEditingTask(task)}
                                >
                                  Изменить
                                </button>
                              )}
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
                  {productionAnalyticsDetailUserName && (
                    <ProductionAnalyticsUserDetailModal
                      userName={productionAnalyticsDetailUserName}
                      summaryRow={
                        visibleProductionAnalyticsReport?.summary.find(
                          (row) => row.userName === productionAnalyticsDetailUserName,
                        ) ?? null
                      }
                      tasks={(visibleProductionAnalyticsReport?.tasks ?? []).filter(
                        (task) => (task.assignedUserName || '—') === productionAnalyticsDetailUserName,
                      )}
                      isAdmin={user?.role === 'Admin'}
                      onClose={() => setProductionAnalyticsDetailUserName(null)}
                      onExportExcel={(userId) => void exportProductionAnalyticsExcel(userId)}
                      onEditTask={(task) => setProductionAnalyticsEditingTask(task)}
                    />
                  )}
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
                  Создать поставку
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
              </div>

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

              {supplySubTab === 'create' && (
                <>
                  <div className="supply-create-bar">
                    <button type="button" onClick={() => setShowCreateSupplyModal(true)}>
                      Создать поставку
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
                      novinkaProducts={supplyNovinkaCatalogItems}
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
                      onAddProduct={addSupplyProduct}
                      onAddReserve={addReserveSupplyProduct}
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
                  onUpdateDates={updateSupplyDates}
                  onReplaceReserve={replaceReserveItem}
                  userRole={user?.role}
                  archiveMode
                />
              )}

              {supplySubTab === 'analytics' && (
                <>
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
                    <button type="button" onClick={loadSupplyAnalytics}>
                      Обновить
                    </button>
                    <button type="button" onClick={exportSupplyAnalytics}>
                      Скачать CSV
                    </button>
                  </div>

                  <SupplyAnalyticsTable rows={filteredSupplyAnalytics} />
                </>
              )}

              {editingSupplyId && (
                <SupplyItemsModal
                  title="Редактировать поставку"
                  listIdPrefix={`edit-supply-${editingSupplyId}`}
                  token={token}
                  ozonProducts={ozonProducts}
                  novinkaProducts={supplyNovinkaCatalogItems}
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
                  onAddProduct={addEditSupplyProduct}
                  onAddReserve={addEditReserveSupplyProduct}
                  onSave={() => saveSupplyEdit(editingSupplyId)}
                  onClose={cancelEditSupply}
                  allowReserveNameEdit
                  itemsTableTitle="Товар в поставке"
                />
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
            <section className="admin-panel">
              <div className="section-title">
                <h2>Пользователи</h2>
                <p>
                  {canEditUsers()
                    ? 'Создание и редактирование учётных записей'
                    : canCreateUsers()
                      ? 'Добавление учётных записей'
                      : 'Просмотр учётных записей'}
                </p>
              </div>

              {canCreateUsers() && (
              <form className="user-form" onSubmit={createUser}>
                <label>
                  <span>Логин</span>
                  <input
                    placeholder="Логин"
                    value={newUser.userName}
                    onChange={(event) => setNewUser({ ...newUser, userName: event.target.value })}
                    required
                  />
                </label>
                <label>
                  <span>Имя</span>
                  <input
                    placeholder="Имя"
                    value={newUser.displayName}
                    onChange={(event) => setNewUser({ ...newUser, displayName: event.target.value })}
                    required
                  />
                </label>
                <label>
                  <span>Должность</span>
                  <input
                    placeholder="Должность"
                    value={newUser.position}
                    onChange={(event) => setNewUser({ ...newUser, position: event.target.value })}
                  />
                </label>
                <label>
                  <span>Пароль</span>
                  <input
                    placeholder="Пароль"
                    type="password"
                    value={newUser.password}
                    onChange={(event) => setNewUser({ ...newUser, password: event.target.value })}
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
                        allowedFeatures: role === 'Admin'
                          ? current.allowedFeatures
                          : profile?.allowedFeatures ?? defaultUserFeatures,
                        homeBlocks: getRoleProfileHomeBlocks(role, roleProfiles),
                      }))
                    }}
                  >
                    {appRoles
                      .filter((role) => canEditUsers() || role.value !== 'Admin')
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
                  return (
                  <li key={item.id} className="user-list-item">
                    <div className="user-list-row">
                    <button type="button" className="user-card-open" onClick={() => openUserProfile(item)}>
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
                          <small>Был: {formatDateTime(item.lastSeenAt)}</small>
                        )}
                      </span>
                    </div>
                    {(() => {
                      const showPasswordControls =
                        canChangeOtherPasswords && item.id !== user?.id && canEditUsers()
                      const showDelete = item.id !== SYSTEM_USER_ID && canEditUsers()
                      return (
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
                        onClick={() => changeUserPassword(item.id)}
                      >
                        Сменить пароль
                      </button>
                      <button
                        type="button"
                        className={`user-action-btn danger ${showDelete ? '' : 'is-slot-hidden'}`}
                        tabIndex={showDelete ? 0 : -1}
                        aria-hidden={!showDelete}
                        disabled={!showDelete}
                        onClick={() => deleteUser(item.id)}
                      >
                        Удалить
                      </button>
                    </div>
                      )
                    })()}
                    </div>
                    {canEditUsers() && (
                    <details className="user-settings-panel">
                      <summary>Настройки пользователя</summary>
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
                        <button type="button" className="user-action-btn user-settings-save" onClick={() => void saveUserSettings(item.id)}>
                          {savedUserSettingsIds[item.id] ? 'Сохранено' : 'Сохранить настройки'}
                        </button>
                      </div>
                    </details>
                    )}
                  </li>
                  )
                })}
              </ul>
            </section>
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

              {canViewIntegrationsOzon() && shopRegion === 'kz' &&
                (['kaspi', 'satu', 'halyk'] as const).map((marketplace) => (
                  <KzIntegrationCard
                    key={marketplace}
                    marketplace={marketplace}
                    settings={kzIntegrationSettings[marketplace]}
                    merchantId={kzIntegrationForms[marketplace].merchantId}
                    apiKey={kzIntegrationForms[marketplace].apiKey}
                    status={kzIntegrationStatus[marketplace]}
                    saving={kzIntegrationSaving[marketplace]}
                    canEdit={canEditIntegrationsOzon()}
                    onMerchantIdChange={(value) =>
                      setKzIntegrationForms((current) => ({
                        ...current,
                        [marketplace]: { ...current[marketplace], merchantId: value },
                      }))
                    }
                    onApiKeyChange={(value) =>
                      setKzIntegrationForms((current) => ({
                        ...current,
                        [marketplace]: { ...current[marketplace], apiKey: value },
                      }))
                    }
                    onSave={() => void saveKzIntegration(marketplace)}
                    onTest={() => void testKzIntegration(marketplace)}
                  />
                ))}

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
                      <p>Выберите пользователя и отметьте, какие события ему отправлять в Telegram</p>
                    </div>
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
                              {events.map((eventItem) => (
                                <label key={eventItem.id}>
                                  <input
                                    type="checkbox"
                                    checked={(userTelegramEvents[integrationAdminUserId] ?? []).includes(eventItem.id)}
                                    disabled={!canEditIntegrationsNotifications()}
                                    onChange={(changeEvent) =>
                                      setUserTelegramEvents((current) => {
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
                              ))}
                            </div>
                          </fieldset>
                        ))}
                      </div>
                      {canEditIntegrationsNotifications() && (
                      <div className="integration-actions">
                        <button type="button" className="header-action" onClick={() => void saveUserTelegramPreferences(integrationAdminUserId)}>
                          Сохранить оповещения
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
                      <p>{reportsStatus || 'Ежедневные отчёты настраиваются для каждого пользователя отдельно'}</p>
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
                    const selectedUser = users.find((item) => item.id === integrationAdminUserId)
                    return (
                      <div className="integration-report-form">
                        <label className="integration-toggle">
                          <input
                            type="checkbox"
                            checked={report?.enabled ?? false}
                            disabled={!canEditIntegrationsReports()}
                            onChange={(event) =>
                              setUserReportData((current) => ({
                                ...current,
                                [integrationAdminUserId]: {
                                  ...(report ?? {
                                    enabled: false,
                                    reportTime: '19:00',
                                    timezone: 'Asia/Almaty',
                                    enabledSections: [],
                                    availableSections: reportSections.map((section) => section.id),
                                    lastSentOn: null,
                                    telegramConnected: selectedUser?.telegramConnected ?? false,
                                  }),
                                  enabled: event.target.checked,
                                },
                              }))
                            }
                          />
                          Отправлять ежедневный отчёт
                        </label>

                        <div className="integration-form-grid">
                          <label>
                            <span>Время отправки</span>
                            <input
                              type="time"
                              value={report?.reportTime ?? '19:00'}
                              disabled={!canEditIntegrationsReports()}
                              onChange={(event) =>
                                setUserReportData((current) => ({
                                  ...current,
                                  [integrationAdminUserId]: {
                                    ...(report ?? {
                                      enabled: false,
                                      reportTime: '19:00',
                                      timezone: 'Asia/Almaty',
                                      enabledSections: [],
                                      availableSections: reportSections.map((section) => section.id),
                                      lastSentOn: null,
                                      telegramConnected: selectedUser?.telegramConnected ?? false,
                                    }),
                                    reportTime: event.target.value,
                                  },
                                }))
                              }
                            />
                          </label>
                          <label>
                            <span>Часовой пояс</span>
                            <select
                              value={normalizeReportTimezone(report?.timezone)}
                              disabled={!canEditIntegrationsReports()}
                              onChange={(event) =>
                                setUserReportData((current) => ({
                                  ...current,
                                  [integrationAdminUserId]: {
                                    ...(report ?? {
                                      enabled: false,
                                      reportTime: '19:00',
                                      timezone: 'Asia/Almaty',
                                      enabledSections: [],
                                      availableSections: reportSections.map((section) => section.id),
                                      lastSentOn: null,
                                      telegramConnected: selectedUser?.telegramConnected ?? false,
                                    }),
                                    timezone: event.target.value,
                                  },
                                }))
                              }
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
                          {groupItemsByField(reportSections, (section) => section.group).map(([group, sections]) => (
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

                        {report?.lastSentOn && <p className="integration-hint">Последний отчёт: {report.lastSentOn}</p>}
                        {!selectedUser?.telegramConnected && !report?.telegramConnected && (
                          <p className="integration-hint">Для отчёта пользователь должен подключить Telegram.</p>
                        )}

                        {canEditIntegrationsReports() && (
                        <div className="integration-actions">
                          <button type="button" className="header-action" onClick={() => void saveUserReport(integrationAdminUserId)}>
                            Сохранить отчёт
                          </button>
                          <button type="button" className="header-action secondary" onClick={() => void testUserReport(integrationAdminUserId)}>
                            Тестовый отчёт
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
                  <span>Бэкапы</span>
                  <strong>{backupFiles.length ? `${backupFiles.length} файлов` : 'Нет файлов'}</strong>
                  <small>{backupStatus || 'Файлы складываются в папку backups рядом с проектом.'}</small>
                  <button type="button" className="settings-card-action" onClick={loadBackups}>
                    Обновить список
                  </button>
                </div>
                <div>
                  <span>Просмотр БД</span>
                  <strong>Adminer</strong>
                  <a href="http://localhost:8082" target="_blank" rel="noreferrer">
                    Открыть Adminer
                  </a>
                </div>
                <div>
                  <span>Сервер</span>
                  <strong>{systemHealth ? 'Работает' : 'Проверка...'}</strong>
                  <small>{systemHealth ? 'Сервер приложения доступен.' : 'Статус загружается'}</small>
                </div>
              </div>

              <details className="role-profiles-panel">
                <summary className="role-profiles-head">
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
                <div className="role-profiles-list">
                  {roleProfiles.map((profile) => {
                    const edit = roleProfileEdits[profile.role] ?? profile
                    const editFeatures = edit.allowedFeatures ?? []
                    return (
                      <details className="role-profile-card" key={profile.role}>
                        <summary className="role-profile-summary">
                          <strong>{getRoleLabel(profile.role)}</strong>
                          <small>{edit.displayName || profile.displayName}</small>
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

              <details className="backup-panel">
                <summary className="backup-panel-head">
                  <div>
                    <h3>Бэкапы базы данных</h3>
                    <p>{backupStatus || 'Последние сохраненные копии PostgreSQL'}</p>
                  </div>
                </summary>
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
              </details>

              <details className="audit-panel">
                <summary className="backup-panel-head">
                  <div>
                    <h3>Журнал действий</h3>
                    <p>{auditStatus || 'Последние действия пользователей и системы'}</p>
                  </div>
                </summary>
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
              </details>
            </section>
          )}
        </section>
      </div>
    </main>
  )
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
                <span>Заказ</span>
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

function ProductSearchInput({
  listId: _listId,
  products,
  selectedProductId,
  onProductIdChange,
  placeholder,
  required = false,
  largePreview = false,
  hideInlinePreview = false,
  showClearButton = false,
}: {
  listId: string
  products: OzonProduct[]
  selectedProductId: string
  onProductIdChange: (productId: string) => void
  placeholder: string
  required?: boolean
  largePreview?: boolean
  hideInlinePreview?: boolean
  showClearButton?: boolean
}) {
  const safeProducts = products ?? []
  const selectedProduct = safeProducts.find((product) => String(product.productId) === selectedProductId)
  const selectedLabel = selectedProduct ? formatProductSelectedLabel(selectedProduct) : ''
  const [query, setQuery] = useState(selectedLabel)
  const [isOpen, setIsOpen] = useState(false)
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({})
  const controlRef = useRef<HTMLDivElement>(null)
  const normalizedQuery = query.trim().toLowerCase()
  const filteredProducts = normalizedQuery
    ? safeProducts
        .filter((product) =>
          [
            product.name,
            product.offerId,
            product.sku,
            product.productId,
            product.status,
          ]
            .filter((value) => value !== undefined && value !== null)
            .some((value) => String(value).toLowerCase().includes(normalizedQuery)),
        )
        .slice(0, 80)
    : safeProducts.slice(0, 80)

  useEffect(() => {
    setQuery(selectedLabel)
  }, [selectedLabel])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    function updateMenuPosition() {
      const input = controlRef.current?.querySelector('.product-search-input')
      if (!(input instanceof HTMLInputElement)) {
        return
      }

      const rect = input.getBoundingClientRect()
      setMenuStyle({
        position: 'fixed',
        top: `${rect.bottom + 6}px`,
        left: `${rect.left}px`,
        width: `${Math.min(rect.width, 680)}px`,
        zIndex: 2000,
      })
    }

    updateMenuPosition()
    window.addEventListener('resize', updateMenuPosition)
    window.addEventListener('scroll', updateMenuPosition, true)
    return () => {
      window.removeEventListener('resize', updateMenuPosition)
      window.removeEventListener('scroll', updateMenuPosition, true)
    }
  }, [isOpen, query, products.length])

  function handleChange(value: string) {
    setQuery(value)
    setIsOpen(true)

    const selected = products.find((product) => {
      const productId = String(product.productId)
      return productId === value || formatProductOption(product) === value || formatProductSelectedLabel(product) === value
    })

    onProductIdChange(selected ? String(selected.productId) : '')
  }

  function selectProduct(product: OzonProduct) {
    onProductIdChange(String(product.productId))
    setQuery(formatProductSelectedLabel(product))
    setIsOpen(false)
  }

  function clearSelection() {
    onProductIdChange('')
    setQuery('')
    setIsOpen(false)
  }

  return (
    <div className="product-search-wrap">
      <div
        className={`product-search-control-row ${showClearButton && selectedProduct ? 'has-outside-clear' : ''}`}
      >
        <div
          ref={controlRef}
          className={`product-search-control ${selectedProduct && !showClearButton ? 'has-inline-thumb' : ''}`}
        >
          <input
            className="product-search-input"
            placeholder={placeholder}
            value={query}
            onChange={(event) => handleChange(event.target.value)}
            onFocus={() => setIsOpen(true)}
            onBlur={() => window.setTimeout(() => setIsOpen(false), 120)}
            required={required}
          />
          {selectedProduct && !showClearButton && (
            <ProductThumb imageUrl={selectedProduct.imageUrl} name={selectedProduct.name} />
          )}
          {isOpen && filteredProducts.length > 0 && (
            <div className="product-search-menu product-search-menu-fixed" id={_listId} style={menuStyle}>
              {filteredProducts.map((product) => (
                <button
                  type="button"
                  className="product-search-option"
                  key={product.productId}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectProduct(product)}
                >
                  <ProductThumb imageUrl={product.imageUrl} name={product.name} />
                  <span>
                    <OfferIdCell offerId={product.offerId} />
                    <small>{product.name}</small>
                  </span>
                </button>
              ))}
            </div>
          )}
          {isOpen && filteredProducts.length === 0 && (
            <div className="product-search-menu product-search-menu-fixed product-search-menu-empty" style={menuStyle}>
              <span>
                {products.length === 0
                  ? 'Список товаров пуст. Подождите загрузку или откройте вкладку «Товары».'
                  : 'По вашему запросу ничего не найдено.'}
              </span>
            </div>
          )}
        </div>
        {showClearButton && selectedProduct && (
          <button
            type="button"
            className="product-search-clear-outside"
            aria-label="Очистить выбор"
            onMouseDown={(event) => event.preventDefault()}
            onClick={clearSelection}
          >
            ×
          </button>
        )}
      </div>
      {selectedProduct && !hideInlinePreview && (
        <div className={`selected-product-card ${largePreview ? 'selected-product-card-large' : ''}`}>
          <ProductThumb imageUrl={selectedProduct.imageUrl} name={selectedProduct.name} large={largePreview} />
          <span>
            <strong>{selectedProduct.name}</strong>
            <small>
              <OfferIdCell offerId={selectedProduct.offerId} inline />
              {selectedProduct.sku ? ` | SKU ${selectedProduct.sku}` : ''}
            </small>
          </span>
        </div>
      )}
    </div>
  )
}

function formatProductOption(product: OzonProduct) {
  const sku = product.sku ? ` | SKU ${product.sku}` : ''
  return `${product.offerId} | ${product.name}${sku} | ID ${product.productId}`
}

function formatProductSelectedLabel(product: OzonProduct) {
  const name = product.name.length > 64 ? `${product.name.slice(0, 64)}...` : product.name
  return `${product.offerId} | ${name}`
}

function ProductTypeEditorPanel({
  token,
  novinkaProducts,
  ozonProducts,
  selectedNovinkaOfferId,
  selectedOzonProductId,
  onNovinkaOfferIdChange,
  onOzonProductIdChange,
  selectedNovinka,
  selectedOzon,
  status,
  saving,
  onConvert,
  onLoadOzonProducts,
}: {
  token: string
  novinkaProducts: ProductionCatalogItem[]
  ozonProducts: OzonProduct[]
  selectedNovinkaOfferId: string
  selectedOzonProductId: string
  onNovinkaOfferIdChange: (offerId: string) => void
  onOzonProductIdChange: (productId: string) => void
  selectedNovinka?: ProductionCatalogItem
  selectedOzon?: OzonProduct
  status: string
  saving: boolean
  onConvert: () => void
  onLoadOzonProducts: () => void
}) {
  return (
    <>
      <div className="section-title soft-title">
        <h2>Редактор товаров</h2>
        <p>Измените тип «Новинка» на «Ozon». Файлы производства останутся на товаре.</p>
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
          <strong>Товар Ozon</strong>
          <span className="product-type-editor-hint">Выберите соответствующий товар из каталога Ozon</span>
          <ProductSearchInput
            listId="product-editor-ozon-list"
            products={ozonProducts}
            selectedProductId={selectedOzonProductId}
            onProductIdChange={onOzonProductIdChange}
            placeholder="Начните писать название или артикул"
            hideInlinePreview
            showClearButton
          />
          <div className="product-type-editor-preview">
            {selectedOzon ? (
              <TaskProductPreview product={selectedOzon} />
            ) : (
              <div className="task-form-modal-preview task-form-modal-preview-empty">
                <span>Выберите товар Ozon для превью</span>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="supply-create-bar product-type-editor-footer">
        <button
          type="button"
          disabled={!selectedNovinka || !selectedOzon || saving}
          onClick={onConvert}
        >
          {saving ? 'Сохранение...' : 'Изменить тип на Ozon'}
        </button>
        <button type="button" className="product-type-editor-secondary" onClick={onLoadOzonProducts}>
          Обновить список Ozon
        </button>
        {status && <p className="modal-status">{status}</p>}
      </div>
    </>
  )
}

function formatNovinkaSelectedLabel(item: ProductionCatalogItem) {
  const name = item.productName.length > 64 ? `${item.productName.slice(0, 64)}...` : item.productName
  return `${item.offerId} | ${name}`
}

function NovinkaSearchInput({
  listId: _listId,
  products,
  selectedOfferId,
  onOfferIdChange,
  placeholder,
  showClearButton = false,
}: {
  listId: string
  products: ProductionCatalogItem[]
  selectedOfferId: string
  onOfferIdChange: (offerId: string) => void
  placeholder: string
  showClearButton?: boolean
}) {
  const selectedProduct = products.find((item) => item.offerId === selectedOfferId)
  const selectedLabel = selectedProduct ? formatNovinkaSelectedLabel(selectedProduct) : ''
  const [query, setQuery] = useState(selectedLabel)
  const [isOpen, setIsOpen] = useState(false)
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({})
  const controlRef = useRef<HTMLDivElement>(null)
  const normalizedQuery = query.trim().toLowerCase()
  const filteredProducts = normalizedQuery
    ? products
        .filter((item) =>
          [item.productName, item.offerId, item.productLink]
            .filter(Boolean)
            .some((value) => value.toLowerCase().includes(normalizedQuery)),
        )
        .slice(0, 80)
    : products.slice(0, 80)

  useEffect(() => {
    setQuery(selectedLabel)
  }, [selectedLabel])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    function updateMenuPosition() {
      const input = controlRef.current?.querySelector('.product-search-input')
      if (!(input instanceof HTMLInputElement)) {
        return
      }

      const rect = input.getBoundingClientRect()
      setMenuStyle({
        position: 'fixed',
        top: `${rect.bottom + 6}px`,
        left: `${rect.left}px`,
        width: `${Math.min(rect.width, 680)}px`,
        zIndex: 2000,
      })
    }

    updateMenuPosition()
    window.addEventListener('resize', updateMenuPosition)
    window.addEventListener('scroll', updateMenuPosition, true)
    return () => {
      window.removeEventListener('resize', updateMenuPosition)
      window.removeEventListener('scroll', updateMenuPosition, true)
    }
  }, [isOpen, query, products.length])

  function selectProduct(item: ProductionCatalogItem) {
    onOfferIdChange(item.offerId)
    setQuery(formatNovinkaSelectedLabel(item))
    setIsOpen(false)
  }

  function clearSelection() {
    onOfferIdChange('')
    setQuery('')
    setIsOpen(false)
  }

  return (
    <div className="product-search-wrap">
      <div
        className={`product-search-control-row ${showClearButton && selectedProduct ? 'has-outside-clear' : ''}`}
      >
        <div ref={controlRef} className="product-search-control">
          <input
            className="product-search-input"
            placeholder={placeholder}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setIsOpen(true)
              if (!event.target.value.trim()) {
                onOfferIdChange('')
              }
            }}
            onFocus={() => setIsOpen(true)}
            onBlur={() => window.setTimeout(() => setIsOpen(false), 120)}
          />
          {isOpen && filteredProducts.length > 0 && (
            <div className="product-search-menu product-search-menu-fixed" id={_listId} style={menuStyle}>
              {filteredProducts.map((item) => (
                <button
                  type="button"
                  className="product-search-option"
                  key={item.offerId}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectProduct(item)}
                >
                  <ProductThumb name={item.productName} />
                  <span>
                    <OfferIdCell offerId={item.offerId} />
                    <small>{item.productName}</small>
                  </span>
                </button>
              ))}
            </div>
          )}
          {isOpen && filteredProducts.length === 0 && (
            <div className="product-search-menu product-search-menu-fixed product-search-menu-empty" style={menuStyle}>
              <span>
                {products.length === 0
                  ? 'Список новинок пуст. Добавьте новый товар в поставку или завершите задачи по новинкам с файлами.'
                  : 'По вашему запросу ничего не найдено.'}
              </span>
            </div>
          )}
        </div>
        {showClearButton && selectedProduct && (
          <button
            type="button"
            className="product-search-clear-outside"
            aria-label="Очистить выбор"
            onMouseDown={(event) => event.preventDefault()}
            onClick={clearSelection}
          >
            ×
          </button>
        )}
      </div>
    </div>
  )
}

function NovinkaProductPreview({
  item,
  token,
  files = [],
  paths = [],
}: {
  item: ProductionCatalogItem
  token: string
  files?: ProductionFile[]
  paths?: ProductionFilePath[]
}) {
  const imageFile = files.find((file) => file.contentType.startsWith('image/'))

  return (
    <div className="task-form-modal-preview selected-product-card selected-product-card-large">
      {imageFile ? (
        <ProductionFileThumb file={imageFile} token={token} name={item.productName} />
      ) : (
        <LinkHoverPreview url={item.productLink} name={item.productName} token={token} />
      )}
      <span>
        <strong>{item.productName}</strong>
        <OfferIdCell offerId={item.offerId} />
        {item.productLink && <NovinkaExternalLinkButton url={item.productLink} />}
        {files.length > 0 && (
          <small className="novinka-preview-meta">Файлы производства: {files.length}</small>
        )}
        {paths.length > 0 && (
          <div className="novinka-preview-paths">
            <small className="novinka-preview-meta">Пути к файлу</small>
            <ProductionPathsPanel paths={paths} showCopy />
          </div>
        )}
      </span>
    </div>
  )
}

function NovinkaExternalLinkButton({ url }: { url: string }) {
  const normalizedUrl = url.trim()
  if (!normalizedUrl) {
    return null
  }

  return (
    <button
      type="button"
      className="task-form-modal-btn novinka-external-link-btn"
      onClick={() => window.open(normalizedUrl, '_blank', 'noopener,noreferrer')}
    >
      Ссылка
    </button>
  )
}

function UserAvatarPreview({
  avatarUrl,
  displayName,
  nested = false,
  className = 'chat-avatar',
}: {
  avatarUrl?: string
  displayName: string
  nested?: boolean
  className?: string
}) {
  const content = avatarUrl ? (
    <img src={avatarUrl} alt={displayName} />
  ) : (
    <span>Фото</span>
  )

  const avatar = nested ? (
    content
  ) : (
    <span className={className}>{content}</span>
  )

  if (!avatarUrl) {
    return avatar
  }

  return (
    <ProductImageHoverPreview imageUrl={avatarUrl} name={displayName}>
      {avatar}
    </ProductImageHoverPreview>
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

type LinkPreviewData = {
  imageUrl?: string
  title?: string
}

const linkPreviewCache = new Map<string, LinkPreviewData>()

function parseLinkPreviewResponse(data: Record<string, unknown>): LinkPreviewData {
  return {
    imageUrl: (data.imageUrl ?? data.ImageUrl) as string | undefined,
    title: (data.title ?? data.Title) as string | undefined,
  }
}

async function fetchLinkPreview(url: string, token: string): Promise<LinkPreviewData> {
  const normalizedUrl = url.trim()
  if (!normalizedUrl || !token) {
    return {}
  }

  const cached = linkPreviewCache.get(normalizedUrl)
  if (cached) {
    return cached
  }

  const response = await fetch(`/api/link-preview?url=${encodeURIComponent(normalizedUrl)}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  if (!response.ok) {
    return {}
  }

  const data = parseLinkPreviewResponse((await response.json()) as Record<string, unknown>)
  linkPreviewCache.set(normalizedUrl, data)
  return data
}

function usePreviewImageSrc(imageUrl: string | undefined, token: string) {
  const [displaySrc, setDisplaySrc] = useState<string | undefined>()

  useEffect(() => {
    if (!imageUrl?.trim() || !token) {
      setDisplaySrc(undefined)
      return
    }

    let objectUrl: string | undefined
    let cancelled = false

    void fetch(`/api/link-preview/image?url=${encodeURIComponent(imageUrl.trim())}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
      .then((response) => (response.ok ? response.blob() : null))
      .then((blob) => {
        if (cancelled || !blob) {
          return
        }

        objectUrl = URL.createObjectURL(blob)
        setDisplaySrc(objectUrl)
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [imageUrl, token])

  return displaySrc
}

function LinkHoverPreview({
  url,
  name,
  token,
}: {
  url: string
  name: string
  token: string
}) {
  const normalizedUrl = url.trim()
  const [preview, setPreview] = useState<LinkPreviewData | null>(
    () => linkPreviewCache.get(normalizedUrl) ?? null,
  )
  const [visible, setVisible] = useState(false)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const displaySrc = usePreviewImageSrc(preview?.imageUrl, token)

  useEffect(() => {
    if (!normalizedUrl || !token) {
      return
    }

    const cached = linkPreviewCache.get(normalizedUrl)
    if (cached) {
      setPreview(cached)
      return
    }

    let cancelled = false
    void fetchLinkPreview(normalizedUrl, token).then((data) => {
      if (cancelled) {
        return
      }

      setPreview(data)
    })

    return () => {
      cancelled = true
    }
  }, [normalizedUrl, token])

  function updatePosition(clientX: number, clientY: number) {
    const popupWidth = 296
    const popupHeight = 296
    const offset = 16
    const maxLeft = window.innerWidth - popupWidth - 12
    const maxTop = window.innerHeight - popupHeight - 12

    setPosition({
      x: Math.max(12, Math.min(clientX + offset, maxLeft)),
      y: Math.max(12, Math.min(clientY + offset, maxTop)),
    })
  }

  const label = preview?.title || name || 'Ссылка'

  return (
    <>
      <span
        className="product-image-hover-trigger"
        onMouseEnter={(event) => {
          setVisible(true)
          updatePosition(event.clientX, event.clientY)
        }}
        onMouseLeave={() => setVisible(false)}
        onMouseMove={(event) => updatePosition(event.clientX, event.clientY)}
      >
        <ProductThumb imageUrl={displaySrc ?? preview?.imageUrl} name={label} />
      </span>
      {visible && (
        <div className="product-image-hover-popup link-hover-popup" style={{ left: position.x, top: position.y }}>
          {displaySrc || preview?.imageUrl ? (
            <img src={displaySrc ?? preview?.imageUrl} alt={label} referrerPolicy="no-referrer" />
          ) : (
            <div className="link-hover-popup-fallback">
              <strong>{label}</strong>
              <small>{normalizedUrl}</small>
            </div>
          )}
        </div>
      )}
    </>
  )
}

function ProductThumb({ imageUrl, name, large = false }: { imageUrl?: string; name: string; large?: boolean }) {
  return (
    <span className={`product-thumb ${large ? 'product-thumb-large' : ''}`}>
      {imageUrl ? <img src={imageUrl} alt={name} loading="lazy" /> : <span>Фото</span>}
    </span>
  )
}

function ProductImageHoverPreview({
  imageUrl,
  name,
  children,
}: {
  imageUrl?: string
  name: string
  children: ReactNode
}) {
  const [visible, setVisible] = useState(false)
  const [position, setPosition] = useState({ x: 0, y: 0 })

  if (!imageUrl) {
    return <>{children}</>
  }

  function updatePosition(clientX: number, clientY: number) {
    const popupWidth = 296
    const popupHeight = 296
    const offset = 16
    const maxLeft = window.innerWidth - popupWidth - 12
    const maxTop = window.innerHeight - popupHeight - 12

    setPosition({
      x: Math.max(12, Math.min(clientX + offset, maxLeft)),
      y: Math.max(12, Math.min(clientY + offset, maxTop)),
    })
  }

  return (
    <>
      <span
        className="product-image-hover-trigger"
        onMouseEnter={(event) => {
          setVisible(true)
          updatePosition(event.clientX, event.clientY)
        }}
        onMouseLeave={() => setVisible(false)}
        onMouseMove={(event) => updatePosition(event.clientX, event.clientY)}
      >
        {children}
      </span>
      {visible && (
        <div className="product-image-hover-popup" style={{ left: position.x, top: position.y }}>
          <img src={imageUrl} alt={name} />
        </div>
      )}
    </>
  )
}

function TaskProductPreview({ product }: { product: OzonProduct }) {
  return (
    <div className="task-form-modal-preview selected-product-card selected-product-card-large">
      <ProductImageHoverPreview imageUrl={product.imageUrl} name={product.name}>
        <ProductThumb imageUrl={product.imageUrl} name={product.name} large />
      </ProductImageHoverPreview>
      <span>
        <strong>{product.name}</strong>
        <small>
          <OfferIdCell offerId={product.offerId} inline />
          {product.sku ? ` | SKU ${product.sku}` : ''}
        </small>
        {product.productUrl && (
          <a className="task-product-ozon-link" href={product.productUrl} target="_blank" rel="noreferrer">
            Открыть на Ozon
          </a>
        )}
      </span>
    </div>
  )
}

function getProductionTaskTableMode(
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

function getProductionTaskTableLabels(tableMode: ReturnType<typeof getProductionTaskTableMode>) {
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

function renderNovinkaItemLink(item: ProductionTaskItem) {
  const productLink = stripNovinkaMarketplaceNote(item.productLink)

  if (!productLink) {
    return '—'
  }

  return <NovinkaExternalLinkButton url={productLink} />
}

function useProductionFilePreviewUrl(fileId: string, token: string, enabled: boolean) {
  const [previewUrl, setPreviewUrl] = useState<string>()

  useEffect(() => {
    if (!enabled || !token) {
      setPreviewUrl(undefined)
      return
    }

    let objectUrl: string | undefined
    let cancelled = false

    void fetch(`/api/production/files/${fileId}/download`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
      .then((response) => (response.ok ? response.blob() : null))
      .then((blob) => {
        if (cancelled || !blob) {
          return
        }

        objectUrl = URL.createObjectURL(blob)
        setPreviewUrl(objectUrl)
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [enabled, fileId, token])

  return previewUrl
}

function ProductionFilePreviewCell({
  file,
  token,
  onDelete,
  compact = false,
}: {
  file: ProductionFile
  token: string
  onDelete?: (id: string) => void
  compact?: boolean
}) {
  const isImage = file.contentType.startsWith('image/')
  const previewUrl = useProductionFilePreviewUrl(file.id, token, isImage)

  if (compact) {
    return (
      <span className="production-file-preview-cell production-file-preview-compact">
        {isImage ? (
          <ProductImageHoverPreview imageUrl={previewUrl} name={file.fileName}>
            <ProductThumb imageUrl={previewUrl} name={file.fileName} />
          </ProductImageHoverPreview>
        ) : (
          <span className="production-file-preview-fallback">Файл</span>
        )}
        <span className="production-file-name" title={file.fileName}>
          {file.fileName}
        </span>
        {onDelete && (
          <button
            type="button"
            className="production-file-delete-icon danger"
            title="Удалить"
            aria-label="Удалить файл"
            onClick={() => onDelete(file.id)}
          >
            ×
          </button>
        )}
      </span>
    )
  }

  if (!isImage) {
    return (
      <span className="production-file-preview-cell">
        <span>{file.fileName}</span>
        {onDelete && (
          <button type="button" className="danger production-file-delete-btn" onClick={() => onDelete(file.id)}>
            Удалить
          </button>
        )}
      </span>
    )
  }

  return (
    <span className="production-file-preview-cell product-mini">
      <ProductImageHoverPreview imageUrl={previewUrl} name={file.fileName}>
        <ProductThumb imageUrl={previewUrl} name={file.fileName} />
      </ProductImageHoverPreview>
      <span>{file.fileName}</span>
      {onDelete && (
        <button type="button" className="danger production-file-delete-btn" onClick={() => onDelete(file.id)}>
          Удалить
        </button>
      )}
    </span>
  )
}

function TaskItemFilesPanel({
  item,
  itemFiles,
  token,
  onDeleteFile,
  onOpenFiles,
  onUploadTaskItemFile,
  canUpload,
}: {
  item: ProductionTaskItem
  itemFiles: ProductionFile[]
  token: string
  onDeleteFile?: (id: string) => void
  onOpenFiles?: (productName: string, files: ProductionFile[]) => void
  onUploadTaskItemFile?: (item: ProductionTaskItem, file: File) => void
  canUpload: boolean
}) {
  const uploadInputId = `task-item-upload-${item.id}`

  return (
    <span className="task-item-files">
      {itemFiles.length > 0 ? (
        <div className="task-item-file-list">
          {itemFiles.map((file) => (
            <ProductionFilePreviewCell
              key={file.id}
              file={file}
              token={token}
              compact
              onDelete={onDeleteFile}
            />
          ))}
        </div>
      ) : (
        !canUpload && '—'
      )}
      {(itemFiles.length > 0 || canUpload) && (
        <div className="task-item-files-actions">
          {itemFiles.length > 0 && onOpenFiles && (
            <button
              type="button"
              className="production-files-trigger"
              onClick={() => onOpenFiles(item.productName, itemFiles)}
            >
              Все ({itemFiles.length})
            </button>
          )}
          {canUpload && onUploadTaskItemFile && (
            <>
              <input
                id={uploadInputId}
                type="file"
                className="task-item-file-input"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) {
                    void onUploadTaskItemFile(item, file)
                  }
                  event.target.value = ''
                }}
              />
              <button
                type="button"
                className="task-item-upload-btn"
                onClick={() => document.getElementById(uploadInputId)?.click()}
              >
                {itemFiles.length > 0 ? 'Добавить' : 'Загрузить файл'}
              </button>
            </>
          )}
        </div>
      )}
    </span>
  )
}

function ProductionFilesModal({
  productName,
  files,
  token,
  onClose,
  onDownload,
  onDelete,
}: {
  productName: string
  files: ProductionFile[]
  token: string
  onClose: () => void
  onDownload: (id: string) => void
  onDelete?: (id: string) => void
}) {
  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal-card modal-card-wide production-files-modal"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-title-row">
          <h3>Файлы производства</h3>
          <button type="button" onClick={onClose}>
            Закрыть
          </button>
        </div>
        <p className="production-files-modal-product">{productName}</p>
        <div className="data-table modal-table">
          <div className="table-row file-row table-head">
            <span>Файл</span>
            <span>Дата</span>
            <span>Действия</span>
          </div>
          {files.map((file) => (
            <div className="table-row file-row" key={file.id}>
              <span>
                <ProductionFilePreviewCell file={file} token={token} />
              </span>
              <span>{new Date(file.createdAt).toLocaleDateString('ru-RU')}</span>
              <span className="file-actions">
                <button type="button" onClick={() => onDownload(file.id)}>
                  Скачать
                </button>
                {onDelete && (
                  <button type="button" className="danger" onClick={() => onDelete(file.id)}>
                    Удалить
                  </button>
                )}
              </span>
            </div>
          ))}
          {files.length === 0 && (
            <div className="empty-state">
              <strong>Для этого товара еще нет файлов производства.</strong>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ProductionTaskTable({
  tasks,
  tableContext = 'ozon',
  products,
  productionFiles,
  productionFilePaths = [],
  token,
  actualQuantities,
  setActualQuantities,
  currentUserId,
  isAdmin,
  canCancelTasks = false,
  onStart,
  onCancelRequest,
  onComplete,
  onOpenFiles,
  onUploadTaskItemFile,
  onDeleteFile,
  onDelete,
  onArchive,
  onRestore,
  onEdit,
  completed = false,
  cancelled = false,
}: {
  tasks: ProductionTask[]
  products: OzonProduct[]
  productionFiles: ProductionFile[]
  productionFilePaths?: ProductionFilePath[]
  token: string
  actualQuantities: Record<string, string>
  setActualQuantities: Dispatch<SetStateAction<Record<string, string>>>
  currentUserId?: string
  isAdmin?: boolean
  canCancelTasks?: boolean
  onStart: (id: string) => void
  onCancelRequest: (id: string) => void
  onComplete: (id: string) => void
  onOpenFiles: (productName: string, files: ProductionFile[]) => void
  onUploadTaskItemFile?: (item: ProductionTaskItem, file: File) => void
  onDeleteFile?: (id: string) => void
  onDelete?: (id: string) => void
  onArchive?: (id: string) => void
  onRestore?: (id: string) => void
  onEdit?: (task: ProductionTask) => void
  completed?: boolean
  cancelled?: boolean
  tableContext?: 'ozon' | 'novinka' | 'mixed'
}) {
  const tableMode = getProductionTaskTableMode(tasks, tableContext)
  const { showQuantityColumns, showTypeColumn, skuHeaderLabel, neededHeaderLabel } =
    getProductionTaskTableLabels(tableMode)

  return (
    <div className={`data-table production-task-table production-task-table-${tableMode}`}>
      <div className="table-row task-row table-head">
        <span className="task-col-product">Товар</span>
        <span className="task-col-sku">{skuHeaderLabel}</span>
        {showTypeColumn && <span className="task-col-type">Тип</span>}
        {showQuantityColumns && (
          <>
            <span className="task-col-needed">{neededHeaderLabel}</span>
            <span className="task-col-fact">Факт</span>
          </>
        )}
        <span className="task-col-status">Статус</span>
        <span className="task-col-creator">Создатель</span>
        <span className="task-col-assignee">Исполнитель</span>
        <span></span>
      </div>
      {tasks.map((task) => {
        const taskItems = getProductionTaskItems(task)
        const novinka = isNovinkaTask(task)
        const isStaleNew =
          task.status === 'New' &&
          Date.now() - new Date(task.createdAt).getTime() > 4 * 60 * 60 * 1000
        const isCreator = Boolean(currentUserId && task.createdByUserId === currentUserId)
        const hasMinimumViolations =
          !novinka &&
          task.status === 'InProgress' &&
          !completed &&
          !cancelled &&
          taskItems.some((item) => {
            if (!item.enforceMinimumQuantity) {
              return false
            }
            const actualValue = actualQuantities[item.id] ?? ''
            const actualNumber = Number(actualValue)
            return actualValue !== '' && Number.isFinite(actualNumber) && actualNumber < item.requiredQuantity
          })
        const hasMissingNovinkaFiles =
          novinka &&
          task.status === 'InProgress' &&
          !completed &&
          !cancelled &&
          taskItems.some((item) => getProductionFilesForTaskItem(item, productionFiles).length === 0)
        const hasMissingNovinkaPaths =
          novinka &&
          task.status === 'InProgress' &&
          !completed &&
          !cancelled &&
          taskItems.some((item) => getProductionPathsForTaskItem(item, productionFilePaths).length === 0)
        const hasMissingNovinkaRequirements = hasMissingNovinkaFiles || hasMissingNovinkaPaths

        return (
        <details
          className={`task-details-row ${task.isUrgent ? 'task-urgent' : ''} ${isStaleNew ? 'task-stale-new' : ''} ${novinka && task.status === 'InProgress' ? 'task-novinka' : ''} ${novinka ? 'task-details-novinka' : ''}`}
          key={task.id}
        >
          <summary className={`table-row task-row ${novinka ? 'task-row-novinka' : ''}`}>
          <span className="task-col-product">
            <strong>{getProductionTaskSummary(task)}</strong>
            <small>
              {task.isUrgent ? 'Срочно · ' : ''}
              {novinka ? `${getProductionTaskTypeLabel(task, productionFiles)} · ` : ''}
              {task.status === 'Cancelled' && task.cancelledAt
                ? `Отменена: ${formatDateTime(task.cancelledAt)}${task.cancelledByDisplayName ? ` · ${task.cancelledByDisplayName}` : ''}`
                : `Создана: ${formatDateTime(task.createdAt)}`}
            </small>
          </span>
          <span
            className="task-col-sku offer-id-cell"
            title={
              novinka
                ? undefined
                : taskItems.map((item) => item.offerId || '-').join(', ')
            }
          >
            {novinka
              ? taskItems.length === 1
                ? renderNovinkaItemLink(taskItems[0])
                : taskItems.map((item) => (
                    <span key={item.id}>{renderNovinkaItemLink(item)}</span>
                  ))
              : taskItems.length === 1
                ? taskItems[0].offerId || '-'
                : taskItems.map((item) => item.offerId || '-').join(', ')}
          </span>
          {showTypeColumn && (
            <span className="task-col-type">
              <span className={`task-type-badge ${novinka ? 'task-type-badge-novinka' : 'task-type-badge-ozon'}`}>
                {getProductionTaskTypeLabel(task, productionFiles)}
              </span>
            </span>
          )}
          {showQuantityColumns && (
            <>
              <span className="task-col-needed">{novinka ? '—' : getProductionTaskRequiredTotal(task)}</span>
              <span className="task-col-fact">
                {novinka ? (
                  <small>—</small>
                ) : completed ? (
                  getProductionTaskActualTotal(task)
                ) : task.status === 'InProgress' ? (
                  <small>По товарам</small>
                ) : (
                  <small>—</small>
                )}
              </span>
            </>
          )}
          <span className="task-col-status">{translateProductionTaskStatus(task.status, task.isUrgent)}</span>
          <span className="task-col-creator">{task.createdByDisplayName || '-'}</span>
          <span className="task-col-assignee">{task.assignedUserName || '-'}</span>
          <span className="task-actions">
            {!completed && !cancelled && task.status === 'New' && onEdit && (
              <button type="button" onClick={(event) => {
                event.preventDefault()
                onEdit(task)
              }}>
                Редактировать
              </button>
            )}
            {!completed && !cancelled && task.status === 'New' && (
              <button type="button" onClick={(event) => {
                event.preventDefault()
                onStart(task.id)
              }}>
                В работу
              </button>
            )}
            {!completed && !cancelled && canCancelTasks && (task.status === 'New' || task.status === 'InProgress') && (
              <button type="button" className="danger" onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                onCancelRequest(task.id)
              }}>
                Отменить
              </button>
            )}
            {!completed && !cancelled && task.status === 'InProgress' && (
              <button
                type="button"
                className={hasMinimumViolations || hasMissingNovinkaRequirements ? 'task-complete-blocked' : ''}
                title={
                  hasMissingNovinkaFiles
                    ? 'Добавьте файлы производства по каждому товару'
                    : hasMissingNovinkaPaths
                      ? 'Укажите путь к файлу по каждому товару'
                    : hasMinimumViolations
                      ? 'Исправьте количество: факт не может быть меньше плана'
                      : undefined
                }
                onClick={(event) => {
                event.preventDefault()
                onComplete(task.id)
              }}>
                Завершить
              </button>
            )}
            {cancelled && isAdmin && onRestore && (
              <button type="button" onClick={(event) => {
                event.preventDefault()
                onRestore(task.id)
              }}>
                В новые
              </button>
            )}
            {cancelled && onArchive && (
              <button type="button" onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                onArchive(task.id)
              }}>
                В архив
              </button>
            )}
            {completed && onDelete && (
              <button type="button" className="danger" onClick={(event) => {
                event.preventDefault()
                onDelete(task.id)
              }}>
                Удалить
              </button>
            )}
          </span>
          </summary>
          {cancelled && (task.cancellationComment || task.cancelledByDisplayName) && (
            <div className={`task-cancel-comment ${isCreator ? 'task-cancel-comment-creator' : ''}`}>
              {task.cancelledByDisplayName && (
                <p className="task-cancelled-by">
                  <strong>Отменил:</strong> {task.cancelledByDisplayName}
                </p>
              )}
              {task.cancellationComment && (
                <>
                  <strong>{isCreator ? 'Ваша задача отменена. Причина:' : 'Причина отмены:'}</strong>
                  <p>{task.cancellationComment}</p>
                </>
              )}
            </div>
          )}
          <div className={`task-items-table ${novinka ? 'task-items-table-novinka' : ''}`}>
            <div className="table-row task-item-table-row table-head">
              <span>Товар</span>
              {!novinka && <span>Артикул</span>}
              {novinka ? (
                <>
                  <span>Ссылка</span>
                  <span>Файлы</span>
                  <span>Путь к файлу</span>
                </>
              ) : (
                <>
                  <span>План</span>
                  <span>Факт</span>
                  <span>Файлы</span>
                </>
              )}
            </div>
            {taskItems.map((item) => {
              const actualValue = actualQuantities[item.id] ?? ''
              const actualNumber = Number(actualValue)
              const itemFiles = getProductionFilesForTaskItem(item, productionFiles)
              const itemPaths = getProductionPathsForTaskItem(item, productionFilePaths)
              const isBelowMinimum =
                !novinka &&
                !completed &&
                !cancelled &&
                task.status === 'InProgress' &&
                item.enforceMinimumQuantity &&
                actualValue !== '' &&
                Number.isFinite(actualNumber) &&
                actualNumber < item.requiredQuantity

              return (
              <div className={`table-row task-item-table-row ${isBelowMinimum ? 'task-item-below-minimum' : ''}`} key={item.id}>
                <span className="product-mini task-product-mini">
                  <TaskItemThumb
                    item={item}
                    products={products}
                    productionFiles={productionFiles}
                    token={token}
                  />
                  <span>
                    <strong>{item.productName}</strong>
                    {item.enforceMinimumQuantity && !novinka && !completed && !cancelled && (
                      <small className="task-minimum-badge">Факт не меньше {item.requiredQuantity}</small>
                    )}
                  </span>
                </span>
                {!novinka && <OfferIdCell offerId={item.offerId} />}
                {novinka ? (
                  <>
                    <span>{renderNovinkaItemLink(item)}</span>
                    <TaskItemFilesPanel
                      item={item}
                      itemFiles={itemFiles}
                      token={token}
                      onDeleteFile={onDeleteFile}
                      onOpenFiles={onOpenFiles}
                      onUploadTaskItemFile={onUploadTaskItemFile}
                      canUpload={!completed && !cancelled && task.status === 'InProgress'}
                    />
                    <TaskItemPathCell paths={itemPaths} />
                  </>
                ) : (
                  <>
                    <span>{item.requiredQuantity}</span>
                    <span>
                      {completed ? (
                        item.actualQuantity ?? 0
                      ) : task.status === 'InProgress' ? (
                        <span className="task-actual-input-wrap">
                          <input
                            className={isBelowMinimum ? 'task-quantity-invalid' : ''}
                            type="number"
                            min={item.enforceMinimumQuantity ? item.requiredQuantity : 0}
                            placeholder={item.enforceMinimumQuantity ? `от ${item.requiredQuantity}` : 'Факт'}
                            value={actualValue}
                            onChange={(event) =>
                              setActualQuantities((current) => ({
                                ...current,
                                [item.id]: event.target.value,
                              }))
                            }
                          />
                          {isBelowMinimum && (
                            <small className="task-minimum-error">
                              Нельзя меньше {item.requiredQuantity}
                            </small>
                          )}
                          {item.enforceMinimumQuantity && actualValue === '' && (
                            <small className="task-minimum-hint">Минимум: {item.requiredQuantity}</small>
                          )}
                        </span>
                      ) : (
                        '—'
                      )}
                    </span>
                    <TaskItemFilesAndPathsCell
                      item={item}
                      itemFiles={itemFiles}
                      itemPaths={itemPaths}
                      onOpenFiles={onOpenFiles}
                    />
                  </>
                )}
              </div>
              )
            })}
          </div>
        </details>
        )
      })}
    </div>
  )
}

function getProductionTaskItems(task: ProductionTask) {
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

function isNovinkaTask(task: ProductionTask) {
  if (task.taskType === 'Novinka') {
    return true
  }

  if (task.taskType === 'Ozon') {
    return false
  }

  return getProductionTaskItems(task).some(
    (item) =>
      item.ozonProductId <= 0 &&
      (item.offerId.startsWith('NV-') || Boolean(item.productLink?.trim())),
  )
}

function resolveNovinkaMarketplaceForTask(
  task: ProductionTask,
  productionFiles: ProductionFile[] = [],
): NovinkaMarketplace | null {
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

function matchesKzProductionMarketplace(
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

function getProductionTaskTypeLabel(task: ProductionTask, productionFiles: ProductionFile[] = []) {
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

function toDatetimeLocalValue(value?: string) {
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

function fromDatetimeLocalValue(value: string) {
  if (!value.trim()) {
    return undefined
  }

  return new Date(value).toISOString()
}

function ProductionAnalyticsRecordEditModal({
  task,
  assignees,
  onClose,
  onSave,
}: {
  task: ProductionTask
  assignees: ProductionAnalyticsAssignee[]
  onClose: () => void
  onSave: (task: ProductionTask) => Promise<boolean>
}) {
  const [draft, setDraft] = useState<ProductionTask>(() => ({
    ...task,
    items: getProductionTaskItems(task).map((item) => ({ ...item })),
  }))
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    try {
      await onSave(draft)
    } finally {
      setSaving(false)
    }
  }

  function updateItem(index: number, patch: Partial<ProductionTaskItem>) {
    setDraft((current) => ({
      ...current,
      items: getProductionTaskItems(current).map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    }))
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card production-analytics-edit-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-title-row">
          <h3>Редактирование записи аналитики</h3>
          <button type="button" className="text-action-button" onClick={onClose}>
            Закрыть
          </button>
        </div>
        <div className="production-analytics-edit-form">
          <label>
            Завершена
            <input
              type="datetime-local"
              value={toDatetimeLocalValue(draft.completedAt)}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  completedAt: fromDatetimeLocalValue(event.target.value),
                }))
              }
            />
          </label>
          <label>
            Исполнитель
            <input
              list="production-analytics-assignee-options"
              value={draft.assignedUserName ?? ''}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  assignedUserName: event.target.value,
                }))
              }
            />
            <datalist id="production-analytics-assignee-options">
              {assignees.map((assignee) => (
                <option key={assignee.id} value={assignee.displayName} />
              ))}
            </datalist>
          </label>
          <label>
            Тип
            <select
              value={draft.taskType ?? 'Ozon'}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  taskType: event.target.value as ProductionTask['taskType'],
                }))
              }
            >
              <option value="Ozon">Ozon</option>
              <option value="Novinka">Новинка</option>
            </select>
          </label>
          <label className="production-analytics-edit-checkbox">
            <input
              type="checkbox"
              checked={draft.isUrgent}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  isUrgent: event.target.checked,
                }))
              }
            />
            Срочная задача
          </label>
          <label>
            Ozon Product ID
            <input
              type="number"
              value={draft.ozonProductId}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  ozonProductId: Number(event.target.value) || 0,
                }))
              }
            />
          </label>
          <label>
            Артикул
            <input
              value={draft.offerId}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  offerId: event.target.value,
                }))
              }
            />
          </label>
          <label>
            Название товара
            <input
              value={draft.productName}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  productName: event.target.value,
                }))
              }
            />
          </label>
          <label>
            План (общий)
            <input
              type="number"
              min={0}
              value={draft.requiredQuantity}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  requiredQuantity: Number(event.target.value) || 0,
                }))
              }
            />
          </label>
          <label>
            Факт (общий)
            <input
              type="number"
              min={0}
              value={draft.actualQuantity ?? 0}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  actualQuantity: Number(event.target.value) || 0,
                }))
              }
            />
          </label>
          <label>
            Создал
            <input
              value={draft.createdByDisplayName ?? ''}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  createdByDisplayName: event.target.value,
                }))
              }
            />
          </label>
          <label>
            Создана
            <input
              type="datetime-local"
              value={toDatetimeLocalValue(draft.createdAt)}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  createdAt: fromDatetimeLocalValue(event.target.value) ?? current.createdAt,
                }))
              }
            />
          </label>
          <label>
            Начата
            <input
              type="datetime-local"
              value={toDatetimeLocalValue(draft.startedAt)}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  startedAt: fromDatetimeLocalValue(event.target.value),
                }))
              }
            />
          </label>
        </div>
        <section className="production-analytics-edit-items">
          <h4>Позиции</h4>
          {getProductionTaskItems(draft).map((item, index) => (
            <div className="production-analytics-edit-item" key={item.id ?? `${item.offerId}-${index}`}>
              <label>
                Товар
                <input
                  value={item.productName}
                  onChange={(event) => updateItem(index, { productName: event.target.value })}
                />
              </label>
              <label>
                Артикул
                <input
                  value={item.offerId}
                  onChange={(event) => updateItem(index, { offerId: event.target.value })}
                />
              </label>
              <label>
                Ссылка
                <input
                  value={item.productLink ?? ''}
                  onChange={(event) => updateItem(index, { productLink: event.target.value })}
                />
              </label>
              <label>
                План
                <input
                  type="number"
                  min={0}
                  value={item.requiredQuantity}
                  onChange={(event) =>
                    updateItem(index, { requiredQuantity: Number(event.target.value) || 0 })
                  }
                />
              </label>
              <label>
                Факт
                <input
                  type="number"
                  min={0}
                  value={item.actualQuantity ?? 0}
                  onChange={(event) =>
                    updateItem(index, { actualQuantity: Number(event.target.value) || 0 })
                  }
                />
              </label>
              <label>
                Путь к файлу
                <input
                  value={item.filePath ?? ''}
                  onChange={(event) => updateItem(index, { filePath: event.target.value })}
                />
              </label>
            </div>
          ))}
        </section>
        <div className="production-analytics-edit-actions">
          <button type="button" className="primary-button" disabled={saving} onClick={() => void handleSave()}>
            {saving ? 'Сохранение...' : 'Сохранить'}
          </button>
          <button type="button" className="text-action-button" onClick={onClose}>
            Отмена
          </button>
        </div>
      </div>
    </div>
  )
}

function ProductionAnalyticsUserDetailModal({
  userName,
  summaryRow,
  tasks,
  isAdmin,
  onClose,
  onExportExcel,
  onEditTask,
}: {
  userName: string
  summaryRow: ProductionAnalyticsSummaryRow | null
  tasks: ProductionTask[]
  isAdmin?: boolean
  onClose: () => void
  onExportExcel: (userId: string) => void
  onEditTask?: (task: ProductionTask) => void
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card production-analytics-detail-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-title-row production-analytics-detail-title">
          <div className="production-analytics-detail-head">
            <UserAvatarPreview
              avatarUrl={summaryRow?.avatarUrl}
              displayName={userName}
              className="production-analytics-avatar production-analytics-avatar-large"
            />
            <div>
              <h3>{userName}</h3>
              <p>
                {summaryRow?.role ? getRoleLabel(summaryRow.role) : 'Исполнитель'} · {tasks.length}{' '}
                {tasks.length === 1 ? 'задача' : tasks.length < 5 ? 'задачи' : 'задач'}
              </p>
            </div>
          </div>
          <div className="production-analytics-detail-actions">
            {summaryRow?.userId && (
              <button type="button" className="text-action-button" onClick={() => onExportExcel(summaryRow.userId!)}>
                Excel
              </button>
            )}
            <button type="button" className="text-action-button" onClick={onClose}>
              Закрыть
            </button>
          </div>
        </div>
        <div className="production-analytics-detail-body">
          {tasks.length === 0 && (
            <div className="empty-state">
              <strong>За выбранный период задач не найдено.</strong>
            </div>
          )}
          {tasks.map((task) => (
            <article className="production-analytics-detail-task" key={task.id}>
              <header className="production-analytics-detail-task-head">
                <div>
                  <strong>{task.productName}</strong>
                  <p>
                    {getProductionTaskTypeLabel(task)}
                    {task.isUrgent ? ' · срочно' : ''}
                    {task.createdByDisplayName ? ` · создал ${task.createdByDisplayName}` : ''}
                  </p>
                </div>
                <div className="production-analytics-detail-task-meta">
                  <div className="production-analytics-detail-task-dates">
                    <span>Создана: {formatDateTime(task.createdAt)}</span>
                    {task.startedAt && <span>Начата: {formatDateTime(task.startedAt)}</span>}
                    {task.completedAt && <span>Завершена: {formatDateTime(task.completedAt)}</span>}
                  </div>
                  {isAdmin && onEditTask && (
                    <button type="button" className="text-action-button" onClick={() => onEditTask(task)}>
                      Изменить
                    </button>
                  )}
                </div>
              </header>
              <div className="data-table production-analytics-detail-items">
                <div className="table-row production-analytics-detail-item-row table-head">
                  <span>Товар</span>
                  <span>Артикул</span>
                  <span>Ссылка</span>
                  <span>План</span>
                  <span>Факт</span>
                </div>
                {getProductionTaskItems(task).map((item) => (
                  <div className="table-row production-analytics-detail-item-row" key={item.id ?? item.offerId}>
                    <span>{item.productName}</span>
                    <OfferIdCell offerId={item.offerId} />
                    <span>
                      {item.productLink?.trim() ? (
                        <a href={item.productLink} target="_blank" rel="noreferrer">
                          {item.productLink}
                        </a>
                      ) : (
                        '—'
                      )}
                    </span>
                    <span>{item.requiredQuantity}</span>
                    <span>{item.actualQuantity ?? 0}</span>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  )
}

function getTaskItemImageUrl(item: ProductionTaskItem, products: OzonProduct[]) {
  return products.find((product) => product.productId === item.ozonProductId)?.imageUrl
}

function ProductionFileThumb({
  file,
  token,
  name,
}: {
  file: ProductionFile
  token?: string
  name: string
}) {
  const previewUrl = useProductionFilePreviewUrl(file.id, token ?? '', Boolean(token && file.contentType.startsWith('image/')))

  return (
    <ProductImageHoverPreview imageUrl={previewUrl} name={name}>
      <ProductThumb imageUrl={previewUrl} name={name} />
    </ProductImageHoverPreview>
  )
}

function TaskItemThumb({
  item,
  products,
  productionFiles,
  token,
}: {
  item: ProductionTaskItem
  products: OzonProduct[]
  productionFiles: ProductionFile[]
  token?: string
}) {
  const imageFile = getProductionFilesForTaskItem(item, productionFiles).find((file) =>
    file.contentType.startsWith('image/'),
  )

  if (imageFile) {
    return <ProductionFileThumb file={imageFile} token={token} name={item.productName} />
  }

  if (item.productLink?.trim() && token && (item.offerId?.startsWith('NV-') || !item.ozonProductId)) {
    return <LinkHoverPreview url={item.productLink} name={item.productName} token={token} />
  }

  const imageUrl = getTaskItemImageUrl(item, products)

  if (imageUrl) {
    return (
      <ProductImageHoverPreview imageUrl={imageUrl} name={item.productName}>
        <ProductThumb imageUrl={imageUrl} name={item.productName} />
      </ProductImageHoverPreview>
    )
  }

  return <ProductThumb name={item.productName} />
}

function getProductionTaskRequiredTotal(task: ProductionTask) {
  return getProductionTaskItems(task).reduce((sum, item) => sum + item.requiredQuantity, 0)
}

function getProductionTaskActualTotal(task: ProductionTask) {
  return getProductionTaskItems(task).reduce((sum, item) => sum + (item.actualQuantity ?? 0), 0)
}

function sortProductionTasksByUrgency(tasks: ProductionTask[]) {
  return [...tasks].sort((left, right) => {
    if (left.isUrgent !== right.isUrgent) {
      return left.isUrgent ? -1 : 1
    }

    return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
  })
}

function isNovinkaProductionFile(file: ProductionFile) {
  return (
    file.offerId.startsWith('NV-') ||
    (Boolean(file.productLink?.trim()) && !file.ozonProductId)
  )
}

function getNovinkaCatalogKey(file: ProductionFile) {
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

function filterNovinkaCatalogByMarketplace(
  items: ProductionCatalogItem[],
  marketplace: NovinkaMarketplace,
) {
  return items.filter((item) => (item.marketplace ?? 'ozon') === marketplace)
}

function resolveNovinkaMarketplaceForFileGroup(files: ProductionFile[]): NovinkaMarketplace {
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

function getSupplyReserveOfferId(item: SupplyItem) {
  const trimmed = item.offerId?.trim()
  if (trimmed) {
    return trimmed
  }

  return `NV-${item.id.replace(/-/g, '')}`
}

function buildNovinkaCatalogFromSupplyReserves(supplies: Supply[]): ProductionCatalogItem[] {
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

function mergeNovinkaCatalogItems(
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

function buildNovinkaCatalogFromFiles(files: ProductionFile[]): ProductionCatalogItem[] {
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

function getProductionFilesForCatalogItem(
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

function getProductionPathsForTaskItem(
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

function getProductionFilesForTaskItem(
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

function getProductionPathsForCatalogItem(
  item: ProductionCatalogItem,
  paths: ProductionFilePath[],
) {
  return paths.filter((path) => pathsMatchProductionItem(path, item))
}

function pathsMatchProductionItem(
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

function TaskItemPathsButtons({ paths }: { paths: ProductionFilePath[] }) {
  if (paths.length === 0) {
    return (
      <button type="button" className="production-files-trigger path-missing-button" disabled>
        нет пути
      </button>
    )
  }

  return (
    <div className="task-item-paths-buttons">
      {paths.map((entry) => (
        <PathCopyBlock key={entry.id} path={entry.path} />
      ))}
    </div>
  )
}

function TaskItemFilesAndPathsCell({
  item,
  itemFiles,
  itemPaths,
  onOpenFiles,
}: {
  item: ProductionTaskItem
  itemFiles: ProductionFile[]
  itemPaths: ProductionFilePath[]
  onOpenFiles?: (productName: string, files: ProductionFile[]) => void
}) {
  return (
    <span className="task-item-files-paths">
      {itemFiles.length > 0 && onOpenFiles ? (
        <button
          type="button"
          className="production-files-trigger"
          onClick={() => onOpenFiles(item.productName, itemFiles)}
        >
          Файлы ({itemFiles.length})
        </button>
      ) : null}
      <TaskItemPathsButtons paths={itemPaths} />
    </span>
  )
}

function PathCopyBlock({ path }: { path: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <div className="path-copy-block">
      <button
        type="button"
        className="copy-path-button"
        onClick={() => {
          void navigator.clipboard.writeText(path).then(() => {
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1500)
          })
        }}
      >
        {copied ? 'Скопировано' : 'Копировать путь'}
      </button>
      <span className="path-copy-block-text" title={path}>
        {path}
      </span>
    </div>
  )
}

function TaskItemPathCell({ paths }: { paths: ProductionFilePath[] }) {
  return (
    <span className="task-item-path-cell">
      <TaskItemPathsButtons paths={paths} />
    </span>
  )
}

function ProductionPathsPanel({
  paths,
  showCopy = true,
}: {
  paths: ProductionFilePath[]
  showCopy?: boolean
}) {
  if (paths.length === 0) {
    return <small className="task-path-empty">Путь не указан</small>
  }

  return (
    <div className="production-paths-panel">
      {paths.map((entry) =>
        showCopy ? (
          <PathCopyBlock key={entry.id} path={entry.path} />
        ) : (
          <span className="production-path-text" key={entry.id} title={entry.path}>
            {entry.path}
          </span>
        ),
      )}
    </div>
  )
}

function getProductionTaskSummary(task: ProductionTask) {
  const items = getProductionTaskItems(task)
  return items.length === 1 ? items[0].productName : `${items.length} товаров в задаче`
}

function getSupplyNotificationSummary(supply: Supply) {
  const items = supply.items ?? []
  return items.length === 1 ? items[0].productName : `${items.length} товаров в поставке`
}

function matchesProductionTask(task: ProductionTask, search: string) {
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
      item.isReserve ? 'новый' : 'постоянный',
    ]),
  ]
    .filter((value) => value !== undefined && value !== null)
    .some((value) => String(value).toLowerCase().includes(search))
}

function formatFileSize(value: number) {
  if (value < 1024) {
    return `${value} Б`
  }

  const kb = value / 1024
  if (kb < 1024) {
    return `${kb.toFixed(1)} КБ`
  }

  return `${(kb / 1024).toFixed(1)} МБ`
}

function ProductionTaskArchiveTable({
  tasks,
  tableContext = 'mixed',
  products,
  productionFiles = [],
  productionFilePaths = [],
  token = '',
  onOpenFiles,
  onDeleteFile,
  onArchive,
  onDelete,
  archiveView = false,
  emptyText = 'В архиве задач пока нет.',
}: {
  tasks: ProductionTask[]
  products: OzonProduct[]
  productionFiles?: ProductionFile[]
  productionFilePaths?: ProductionFilePath[]
  token?: string
  onOpenFiles?: (productName: string, files: ProductionFile[]) => void
  onDeleteFile?: (id: string) => void
  onArchive?: (id: string) => void
  onDelete?: (id: string) => void
  archiveView?: boolean
  emptyText?: string
  tableContext?: 'ozon' | 'novinka' | 'mixed'
}) {
  const tableMode = getProductionTaskTableMode(tasks, tableContext)
  const { showQuantityColumns, showTypeColumn, skuHeaderLabel, neededHeaderLabel } =
    getProductionTaskTableLabels(tableMode)

  return (
    <div className={`data-table production-task-table production-task-table-${tableMode}`}>
      <div className={`table-row task-archive-row table-head ${archiveView ? 'task-archive-row-extended' : ''}`}>
        <span>Что было в задаче</span>
        <span className="task-col-sku">{skuHeaderLabel}</span>
        {showTypeColumn && <span className="task-col-type">Тип</span>}
        {showQuantityColumns && (
          <>
            <span className="task-col-needed">{neededHeaderLabel}</span>
            <span className="task-col-fact">Факт</span>
          </>
        )}
        {archiveView && <span>Статус</span>}
        <span>Кто выполнял</span>
        <span>Взял в работу</span>
        <span>{archiveView ? 'Завершена / отменена' : 'Завершил'}</span>
        <span></span>
      </div>
      {tasks.map((task) => {
        const novinka = isNovinkaTask(task)
        const taskItems = getProductionTaskItems(task)

        return (
        <details className={`task-details-row ${novinka ? 'task-details-novinka' : ''}`} key={task.id}>
          <summary className={`table-row task-archive-row ${archiveView ? 'task-archive-row-extended' : ''} ${novinka ? 'task-row-novinka' : ''}`}>
          <span>
            <strong>{getProductionTaskSummary(task)}</strong>
            <small>
              Создана: {formatDateTime(task.createdAt)}
              {task.isUrgent ? ' · Срочно' : ''}
            </small>
          </span>
          <span
            className="task-col-sku offer-id-cell"
            title={
              novinka
                ? undefined
                : taskItems.map((item) => item.offerId || '-').join(', ')
            }
          >
            {novinka
              ? taskItems.length === 1
                ? renderNovinkaItemLink(taskItems[0])
                : taskItems.map((item) => (
                    <span key={item.id}>{renderNovinkaItemLink(item)}</span>
                  ))
              : taskItems.length === 1
                ? taskItems[0].offerId || '-'
                : taskItems.map((item) => item.offerId || '-').join(', ')}
          </span>
          {showTypeColumn && (
            <span className="task-col-type">
              <span
                className={`task-type-badge ${novinka ? 'task-type-badge-novinka' : 'task-type-badge-ozon'}`}
              >
                {getProductionTaskTypeLabel(task, productionFiles)}
              </span>
            </span>
          )}
          {showQuantityColumns && (
            <>
              <span className="task-col-needed">{novinka ? '—' : getProductionTaskRequiredTotal(task)}</span>
              <span className="task-col-fact">
                {novinka ? '—' : task.status === 'Cancelled' ? '—' : getProductionTaskActualTotal(task)}
              </span>
            </>
          )}
          {archiveView && <span>{translateProductionTaskStatus(task.status, task.isUrgent)}</span>}
          <span>{task.assignedUserName || '-'}</span>
          <span>{task.startedAt ? formatDateTime(task.startedAt) : '-'}</span>
          <span>
            {task.status === 'Cancelled'
              ? task.cancelledAt
                ? `Отменена: ${formatDateTime(task.cancelledAt)}${task.cancelledByDisplayName ? ` · ${task.cancelledByDisplayName}` : ''}`
                : '-'
              : task.completedAt
                ? formatDateTime(task.completedAt)
                : '-'}
          </span>
          <span className="task-actions">
            {onArchive && (
              <button type="button" onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                onArchive(task.id)
              }}>
                Архивировать
              </button>
            )}
            {onDelete && (
              <button type="button" className="danger" onClick={(event) => {
                event.preventDefault()
                onDelete(task.id)
              }}>
                Удалить из архива
              </button>
            )}
          </span>
          </summary>
          {archiveView && task.status === 'Cancelled' && task.cancellationComment && (
            <div className="task-cancel-comment">
              <strong>Причина отмены:</strong>
              <p>{task.cancellationComment}</p>
            </div>
          )}
          <div className={`task-items-table ${novinka ? 'task-items-table-novinka' : ''}`}>
            <div className="table-row task-item-table-row table-head">
              <span>Товар</span>
              {!novinka && <span>Артикул</span>}
              {novinka ? (
                <>
                  <span>Ссылка</span>
                  <span>Файлы</span>
                  <span>Путь к файлу</span>
                </>
              ) : (
                <>
                  <span>План</span>
                  <span>Факт</span>
                </>
              )}
            </div>
            {taskItems.map((item) => {
              const itemFiles = getProductionFilesForTaskItem(item, productionFiles)
              const itemPaths = getProductionPathsForTaskItem(item, productionFilePaths)

              return (
              <div className="table-row task-item-table-row" key={item.id}>
                <span className="product-mini task-product-mini">
                  <TaskItemThumb
                    item={item}
                    products={products}
                    productionFiles={productionFiles}
                    token={token}
                  />
                  <span>
                    <strong>{item.productName}</strong>
                  </span>
                </span>
                {!novinka && <OfferIdCell offerId={item.offerId} />}
                {novinka ? (
                  <>
                    <span>{renderNovinkaItemLink(item)}</span>
                    <TaskItemFilesPanel
                      item={item}
                      itemFiles={itemFiles}
                      token={token}
                      onDeleteFile={onDeleteFile}
                      onOpenFiles={onOpenFiles}
                      canUpload={false}
                    />
                    <TaskItemPathCell paths={itemPaths} />
                  </>
                ) : (
                  <>
                    <span>{item.requiredQuantity}</span>
                    <span>{item.actualQuantity ?? 0}</span>
                  </>
                )}
              </div>
              )
            })}
          </div>
        </details>
        )
      })}
      {tasks.length === 0 && (
        <div className="empty-state">
          <strong>{emptyText}</strong>
        </div>
      )}
    </div>
  )
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
  onAddProduct,
  onAddReserve,
  onSave,
  onClose,
  allowReserveNameEdit = false,
  itemsTableTitle = 'Товар в новой поставке',
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
  onAddProduct: () => void
  onAddReserve: () => void
  onSave: () => void
  onClose: () => void
  allowReserveNameEdit?: boolean
  itemsTableTitle?: string
}) {
  const selectedProduct = ozonProducts.find((item) => String(item.productId) === productId)
  const selectedNovinka = novinkaProducts.find((item) => item.offerId === selectedNovinkaOfferId)

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
            <strong>Новинка</strong>
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
                  <span>Выберите новинку для превью</span>
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
                <button type="button" onClick={onAddReserve}>
                  Добавить
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="data-table modal-table">
          <div className="table-row supply-item-row table-head">
            <span>{itemsTableTitle}</span>
            <span>Артикул</span>
            <span>Количество</span>
            <span>Тип</span>
            <span></span>
          </div>
          {items.map((item) => {
            const imageUrl = getSupplyItemImageUrl(ozonProducts, item)

            return (
              <div className="table-row supply-item-row" key={item.tempId}>
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
                <span>{item.isReserve ? (item.offerId.startsWith('NV-') ? 'Новинка' : 'Новый') : 'Постоянный'}</span>
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
  onUpdateDates: (id: string, sentAt?: string, acceptedAt?: string) => Promise<boolean>
}) {
  const [editing, setEditing] = useState(false)
  const [sentAt, setSentAt] = useState(() => toDatetimeLocalValue(supply.sentAt))
  const [acceptedAt, setAcceptedAt] = useState(() => toDatetimeLocalValue(supply.acceptedAt))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setSentAt(toDatetimeLocalValue(supply.sentAt))
    setAcceptedAt(toDatetimeLocalValue(supply.acceptedAt))
    setEditing(false)
  }, [supply.id, supply.sentAt, supply.acceptedAt])

  async function saveDates() {
    setSaving(true)
    const saved = await onUpdateDates(
      supply.id,
      fromDatetimeLocalValue(sentAt),
      fromDatetimeLocalValue(acceptedAt),
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
        {supply.acceptedAt ? formatDateTime(supply.acceptedAt) : '-'}
        <button type="button" className="link-button" onClick={() => setEditing(true)}>
          Изменить даты
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
      <button type="button" disabled={saving} onClick={() => void saveDates()}>
        {saving ? 'Сохранение...' : 'Сохранить'}
      </button>
      <button
        type="button"
        disabled={saving}
        onClick={() => {
          setSentAt(toDatetimeLocalValue(supply.sentAt))
          setAcceptedAt(toDatetimeLocalValue(supply.acceptedAt))
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
  onUpdateDates: (id: string, sentAt?: string, acceptedAt?: string) => Promise<boolean>
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
          }),
          quantity: item.quantity,
          isReserve: item.isReserve,
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
                      {supply.acceptedAt ? formatDateTime(supply.acceptedAt) : '-'}
                    </small>
                  ) : userRole === 'Admin' ? (
                    <SupplyDatesEditor supply={supply} onUpdateDates={onUpdateDates} />
                  ) : (
                    <small>
                      Отгрузка: {supply.sentAt ? formatDateTime(supply.sentAt) : '-'} | Приемка:{' '}
                      {supply.acceptedAt ? formatDateTime(supply.acceptedAt) : '-'}
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
                    <button type="button" onClick={() => onStatusChange(supply.id, 'Sent')}>
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
                      <span>{item.isReserve ? 'Новый' : 'Постоянный'}</span>
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
            <small>{row.isReserve ? 'Новый товар' : 'Постоянный товар'}</small>
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
                  {supply.acceptedAt ? formatDateTime(supply.acceptedAt) : '-'}
                </small>
              </span>
              <span className="status-pill">{formatSupplyDisplayStatus(supply)}</span>
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
                  <span>{item.isReserve ? 'Новый' : 'Постоянный'}</span>
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

function KzCatalogAnalyticsPanel({
  products,
  marketplace,
}: {
  products: OzonProduct[]
  marketplace: KzMarketplace
}) {
  const stats = useMemo(() => {
    const result = {
      total: products.length,
      selling: 0,
      ready: 0,
      archived: 0,
    }

    for (const product of products) {
      const group = getProductStatusGroup(product.status)
      if (group === 'selling') {
        result.selling++
      } else if (group === 'ready') {
        result.ready++
      } else if (group === 'archived') {
        result.archived++
      }
    }

    return result
  }, [products])

  return (
    <>
      <div className="analytics-pipeline">
        <section className="analytics-pipeline-panel analytics-pipeline-panel--summary">
          <div className="analytics-pipeline-grid analytics-pipeline-grid--summary">
            <div className="analytics-pipeline-card analytics-pipeline-cell--s1c1">
              <span>Всего позиций</span>
              <strong>{stats.total}</strong>
            </div>
            <div className="analytics-pipeline-card analytics-pipeline-cell--s1c2">
              <span>Товаров в продаже</span>
              <strong>{stats.selling}</strong>
            </div>
            <div className="analytics-pipeline-card analytics-pipeline-cell--s1c3">
              <span>Готовых к продаже</span>
              <strong>{stats.ready}</strong>
            </div>
            <div className="analytics-pipeline-card analytics-pipeline-card--text-danger analytics-pipeline-cell--s1c4">
              <span>В архиве</span>
              <strong>{stats.archived}</strong>
            </div>
          </div>
        </section>
      </div>
      <div className="empty-state">
        <strong>Аналитика продаж {getKzMarketplaceLabel(marketplace)}</strong>
        <span>
          Данные Ozon в разделе KZ не показываются. Сводка построена только по каталогу{' '}
          {getKzMarketplaceLabel(marketplace)}.
        </span>
      </div>
    </>
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

function getApiErrorMessage(errorText: string, fallback: string) {
  if (!errorText.trim()) {
    return fallback
  }

  try {
    const data = JSON.parse(errorText) as { detail?: string; title?: string; message?: string }
    return data.detail || data.message || data.title || fallback
  } catch {
    return errorText.length > 180 ? `${errorText.slice(0, 180)}...` : errorText
  }
}

function AnalyticsPipelineBoard({
  snapshot,
  analytics,
}: {
  snapshot: OzonAnalyticsSnapshot | null
  analytics: OzonAnalytics | null
}) {
  const currency = 'KZT'
  const balanceCurrency = snapshot?.accountBalanceCurrency || currency
  const totalDeductions = analytics
    ? analytics.commissionTotal +
      analytics.logisticsTotal +
      analytics.servicesTotal +
      analytics.cancelledLogisticsTotal
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
            <span>Баланс на OZON</span>
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
          <span>Комиссия OZON</span>
          <strong>{analytics ? formatLossMoney(analytics.commissionTotal, currency) : '—'}</strong>
        </div>
        <div className="analytics-pipeline-card analytics-pipeline-card--text-danger analytics-pipeline-cell analytics-pipeline-cell--r3c2">
          <span>Логистика</span>
          <strong>{analytics ? formatLossMoney(analytics.logisticsTotal, currency) : '—'}</strong>
        </div>
        <div className="analytics-pipeline-card analytics-pipeline-card--text-danger analytics-pipeline-cell analytics-pipeline-cell--r3c3">
          <span>Прочие услуги OZON</span>
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

function formatMoney(value: number, currency: string) {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: currency || 'KZT',
    maximumFractionDigits: 2,
  }).format(value)
}

function formatLossMoney(value: number, currency: string) {
  return formatMoney(-Math.abs(value), currency || 'KZT')
}

function formatAnalyticsDate(value: string) {
  if (!value || value === '—' || value === 'unknown') {
    return 'Без даты'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value.slice(0, 10)
  }

  return date.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
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

  if (['visible', 'selling', 'active', 'продается', 'продаётся'].includes(normalized)) {
    return 'selling'
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
    продается: 'Продается',
    'продаётся': 'Продается',
    archived: 'Архив',
    archive: 'Архив',
    архив: 'Архив',
    'в архиве': 'Архив',
  }

  if (!normalized) {
    return '-'
  }

  return statuses[normalized] ?? status
}

function translateProductionTaskStatus(status: ProductionTask['status'], isUrgent = false) {
  const statuses: Record<ProductionTask['status'], string> = {
    New: isUrgent ? 'Срочно' : 'Новая',
    InProgress: 'В работе',
    Cancelled: 'Отменена',
    Completed: 'Выполнено',
  }

  return statuses[status] ?? status
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

function formatOzonCreatedAt(value?: string) {
  if (!value) {
    return '-'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return date.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

function formatDaysWithoutSales(value?: number | null) {
  if (value === null || value === undefined) {
    return '-'
  }

  return `${value} дн.`
}

function OfferIdCell({ offerId, inline = false }: { offerId?: string | null; inline?: boolean }) {
  const value = offerId?.trim() || '-'
  return (
    <span
      className={`offer-id-cell${inline ? ' offer-id-cell-inline' : ''}`}
      title={value === '-' ? undefined : value}
    >
      {value}
    </span>
  )
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
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
