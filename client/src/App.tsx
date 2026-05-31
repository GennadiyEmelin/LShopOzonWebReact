import { useEffect, useRef, useState } from 'react'
import type { Dispatch, FormEvent, SetStateAction } from 'react'
import * as signalR from '@microsoft/signalr'
import './App.css'

type User = {
  id: string
  userName: string
  displayName: string
  role: string
  isOnline?: boolean
  lastSeenAt?: string
  unreadCount?: number
}

type ChatMessage = {
  id: string
  senderId: string
  receiverId: string
  text: string
  createdAt: string
  isOwn: boolean
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
  }>
  topProducts: Array<{
    sku: number
    offerId: string
    productName: string
    quantity: number
    revenue: number
    currencyCode: string
  }>
  orderedUnitsTotal: number
  revenueTotal: number
  commissionTotal: number
  payoutTotal: number
  logisticsTotal: number
  servicesTotal: number
  awaitingDeliverCount: number
  deliveringCount: number
  deliveredCount: number
  timestamp: string
}

type ProductionFile = {
  id: string
  ozonProductId?: number
  offerId: string
  productName: string
  notes: string
  fileName: string
  contentType: string
  createdAt: string
}

type ProductionTask = {
  id: string
  ozonProductId: number
  offerId: string
  productName: string
  requiredQuantity: number
  actualQuantity?: number
  status: 'New' | 'InProgress' | 'Deferred' | 'Completed'
  assignedUserName?: string
  createdAt: string
  startedAt?: string
  deferredAt?: string
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
  requiredQuantity: number
  actualQuantity?: number
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

type Supply = {
  id: string
  status: SupplyStatus
  createdAt: string
  sentAt?: string
  acceptedAt?: string
  isArchived: boolean
  archivedAt?: string
  items: SupplyItem[]
}

type SupplyAnalyticsItem = SupplyItem & {
  supplyId: string
  status: SupplyStatus
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
  quantity: number
  isReserve: boolean
}

type DraftTaskItem = {
  tempId: string
  ozonProductId: number
  offerId: string
  productName: string
  requiredQuantity: number
}

function createTempId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

const tabs = [
  { id: 'production', label: 'Производство' },
  { id: 'products', label: 'Товары' },
  { id: 'analytics', label: 'Аналитика', adminOnly: true },
  { id: 'pooling', label: 'Складчина', adminOnly: true },
  { id: 'supplies', label: 'Поставки' },
  { id: 'chats', label: 'Чаты' },
  { id: 'users', label: 'Пользователи', adminOnly: true },
  { id: 'settings', label: 'Настройки', adminOnly: true },
] as const

type TabId = (typeof tabs)[number]['id']
type ProductionSubTab = 'products' | 'tasks' | 'inProgress' | 'deferred' | 'completed' | 'archive'
type SupplySubTab = 'create' | 'editor' | 'all' | 'archive' | 'analytics'
type AnalyticsSubTab = 'summary' | 'topProducts'

function App() {
  const [token, setToken] = useState(() => localStorage.getItem('authToken') ?? '')
  const [user, setUser] = useState<User | null>(() => {
    const value = localStorage.getItem('authUser')
    return value ? JSON.parse(value) : null
  })
  const [users, setUsers] = useState<User[]>([])
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([])
  const [auditSearch, setAuditSearch] = useState('')
  const [auditStatus, setAuditStatus] = useState('')
  const [activeTab, setActiveTab] = useState<TabId>('production')
  const [isLoading, setIsLoading] = useState(true)
  const [loginError, setLoginError] = useState('')
  const [ozonStatus, setOzonStatus] = useState('')
  const [ozonProducts, setOzonProducts] = useState<OzonProduct[]>([])
  const [stockStatus, setStockStatus] = useState('')
  const [ozonStocks, setOzonStocks] = useState<OzonStock[]>([])
  const [stockSortDirection, setStockSortDirection] = useState<'desc' | 'asc'>('desc')
  const [priceStatus, setPriceStatus] = useState('')
  const [editingPrices, setEditingPrices] = useState<Record<number, string>>({})
  const [analyticsStatus, setAnalyticsStatus] = useState('')
  const [analytics, setAnalytics] = useState<OzonAnalytics | null>(null)
  const [analyticsSubTab, setAnalyticsSubTab] = useState<AnalyticsSubTab>('summary')
  const [productionSearch, setProductionSearch] = useState('')
  const [productionSubTab, setProductionSubTab] = useState<ProductionSubTab>('products')
  const [selectedProductionProductId, setSelectedProductionProductId] = useState<number | null>(null)
  const [productionFiles, setProductionFiles] = useState<ProductionFile[]>([])
  const [productionTasks, setProductionTasks] = useState<ProductionTask[]>([])
  const [productionStatus, setProductionStatus] = useState('')
  const [taskStatus, setTaskStatus] = useState('')
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [selectedTaskProductId, setSelectedTaskProductId] = useState('')
  const [taskQuantity, setTaskQuantity] = useState('')
  const [showCreateTaskModal, setShowCreateTaskModal] = useState(false)
  const [draftTaskItems, setDraftTaskItems] = useState<DraftTaskItem[]>([])
  const [actualQuantities, setActualQuantities] = useState<Record<string, string>>({})
  const [supplySubTab, setSupplySubTab] = useState<SupplySubTab>('create')
  const [supplies, setSupplies] = useState<Supply[]>([])
  const [supplyAnalytics, setSupplyAnalytics] = useState<SupplyAnalyticsItem[]>([])
  const [supplyStatus, setSupplyStatus] = useState('')
  const [supplyProductId, setSupplyProductId] = useState('')
  const [supplyQuantity, setSupplyQuantity] = useState('')
  const [reserveProductName, setReserveProductName] = useState('')
  const [reserveQuantity, setReserveQuantity] = useState('')
  const [draftSupplyItems, setDraftSupplyItems] = useState<DraftSupplyItem[]>([])
  const [replaceProducts, setReplaceProducts] = useState<Record<string, string>>({})
  const [editingSupplyId, setEditingSupplyId] = useState<string | null>(null)
  const [editSupplyItems, setEditSupplyItems] = useState<DraftSupplyItem[]>([])
  const [editSupplyProductId, setEditSupplyProductId] = useState('')
  const [editSupplyQuantity, setEditSupplyQuantity] = useState('')
  const [editReserveProductName, setEditReserveProductName] = useState('')
  const [editReserveQuantity, setEditReserveQuantity] = useState('')
  const [analyticsProductKey, setAnalyticsProductKey] = useState('')
  const [showSupplyHelp, setShowSupplyHelp] = useState(false)
  const [showCreateSupplyModal, setShowCreateSupplyModal] = useState(false)
  const [supplyImportFile, setSupplyImportFile] = useState<File | null>(null)
  const [newUser, setNewUser] = useState({
    userName: '',
    displayName: '',
    password: '',
    role: 'User',
  })
  const [passwordEdits, setPasswordEdits] = useState<Record<string, string>>({})
  const [chatUsers, setChatUsers] = useState<User[]>([])
  const [selectedChatUserId, setSelectedChatUserId] = useState('')
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatText, setChatText] = useState('')
  const [chatStatus, setChatStatus] = useState('')
  const knownNewTaskIdsRef = useRef<Set<string> | null>(null)
  const knownChatUnreadCountsRef = useRef<Record<string, number> | null>(null)
  const knownChatMessageIdsRef = useRef<Record<string, Set<string>>>({})
  const selectedChatUserIdRef = useRef('')
  const normalizedProductionSearch = productionSearch.trim().toLowerCase()
  const filteredOzonProducts = normalizedProductionSearch
    ? ozonProducts.filter((item) =>
        [
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
          .some((value) => String(value).toLowerCase().includes(normalizedProductionSearch)),
      )
    : ozonProducts
  const newProductionTasks = productionTasks.filter((task) => task.status === 'New' && !task.isArchived)
  const inProgressProductionTasks = productionTasks.filter((task) => task.status === 'InProgress' && !task.isArchived)
  const deferredProductionTasks = productionTasks.filter((task) => task.status === 'Deferred' && !task.isArchived)
  const completedProductionTasks = productionTasks.filter((task) => task.status === 'Completed' && !task.isArchived)
  const archivedProductionTasks = productionTasks.filter((task) => task.isArchived)
  const selectedProductionProduct = ozonProducts.find(
    (item) => item.productId === selectedProductionProductId,
  )
  const filteredSupplyAnalytics = analyticsProductKey
    ? supplyAnalytics.filter((item) =>
        item.isReserve
          ? `reserve:${item.productName}` === analyticsProductKey
          : `product:${item.ozonProductId}` === analyticsProductKey,
      )
    : supplyAnalytics
  const activeSupplies = supplies.filter((supply) => !supply.isArchived)
  const archivedSupplies = supplies.filter((supply) => supply.isArchived)
  const createdSupplies = activeSupplies.filter((supply) => supply.status === 'Created')
  const editableSupplies = activeSupplies.filter((supply) => supply.status !== 'Created')
  const sortedOzonStocks = [...ozonStocks].sort((left, right) => {
    const leftTotal = left.fboPresent + left.fbsPresent
    const rightTotal = right.fboPresent + right.fbsPresent
    return stockSortDirection === 'desc' ? rightTotal - leftTotal : leftTotal - rightTotal
  })
  const topAnalyticsProducts = (analytics?.topProducts ?? [])
    .map((row) => ({
      ...row,
      key: row.sku ? `sku:${row.sku}` : `offer:${row.offerId}`,
    }))
    .sort((left, right) => right.quantity - left.quantity)
  const selectedChatUser = chatUsers.find((item) => item.id === selectedChatUserId)
  const chatUnreadTotal = chatUsers.reduce((sum, item) => sum + (item.unreadCount ?? 0), 0)

  useEffect(() => {
    if (!token) {
      setIsLoading(false)
      return
    }

    setIsLoading(false)
  }, [token])

  useEffect(() => {
    if (!token || user?.role !== 'Admin') {
      return
    }

    loadUsers()
    loadAuditLogs()
    const intervalId = window.setInterval(() => {
      loadUsers()
      loadAuditLogs()
    }, 30000)
    return () => window.clearInterval(intervalId)
  }, [token, user?.role])

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
    selectedChatUserIdRef.current = selectedChatUserId
  }, [selectedChatUserId])

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
      loadProductionTasks()
    })

    connection.on('ChatMessagesChanged', (senderId: string, receiverId: string) => {
      if (user?.id !== senderId && user?.id !== receiverId) {
        return
      }

      loadChatUsers()
      const activeChatUserId = selectedChatUserIdRef.current
      if (activeChatUserId && (activeChatUserId === senderId || activeChatUserId === receiverId)) {
        loadChatMessages(activeChatUserId)
      }
    })

    connection.start().catch(() => {
      setTaskStatus('Live-уведомления временно недоступны')
    })

    return () => {
      connection.stop()
    }
  }, [token, user?.id])

  useEffect(() => {
    if (!token) {
      return
    }

    loadProductionFiles('')
    loadProductionTasks()
    loadSupplies()
    loadSupplyAnalytics()
  }, [token])

  useEffect(() => {
    if (!token) {
      return
    }

    loadOzonProducts()
    if (user?.role === 'Admin') {
      loadAnalytics()
    }
  }, [token, user?.role])

  useEffect(() => {
    if (!token) {
      return
    }

    loadChatUsers()
    const intervalId = window.setInterval(loadChatUsers, 30000)
    return () => window.clearInterval(intervalId)
  }, [token])

  useEffect(() => {
    if (!token || !selectedChatUserId) {
      return
    }

    loadChatMessages(selectedChatUserId)
    const intervalId = window.setInterval(() => loadChatMessages(selectedChatUserId), 5000)
    return () => window.clearInterval(intervalId)
  }, [token, selectedChatUserId])

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
    setChatUsers([])
    setChatMessages([])
    setSelectedChatUserId('')
    knownNewTaskIdsRef.current = null
    knownChatUnreadCountsRef.current = null
    knownChatMessageIdsRef.current = {}
    selectedChatUserIdRef.current = ''
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
      return
    }

    const data: User[] = await response.json()
    setUsers(data)
  }

  async function loadAuditLogs(search = auditSearch) {
    const params = new URLSearchParams()
    if (search.trim()) {
      params.set('search', search.trim())
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
    const response = await fetch('/api/admin/audit-logs/export', {
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
    link.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  async function loadChatUsers() {
    const response = await fetch('/api/chat/users', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      return
    }

    const data: User[] = await response.json()
    const previousUnreadCounts = knownChatUnreadCountsRef.current
    const nextUnreadCounts = Object.fromEntries(
      data.map((item) => [item.id, item.unreadCount ?? 0]),
    )

    if (previousUnreadCounts) {
      data.forEach((item) => {
        const previousCount = previousUnreadCounts[item.id] ?? 0
        const currentCount = item.unreadCount ?? 0
        if (currentCount > previousCount) {
          showBrowserNotification(
            'Новое сообщение',
            `${item.displayName || item.userName}: ${currentCount - previousCount} новое`,
          )
        }
      })
    }

    knownChatUnreadCountsRef.current = nextUnreadCounts
    setChatUsers(data)
    setSelectedChatUserId((current) => current || data[0]?.id || '')
  }

  async function loadChatMessages(chatUserId = selectedChatUserId) {
    if (!chatUserId) {
      setChatMessages([])
      return
    }

    const response = await fetch(`/api/chat/${chatUserId}/messages`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      return
    }

    const data: ChatMessage[] = await response.json()
    const previousMessageIds = knownChatMessageIdsRef.current[chatUserId]
    if (previousMessageIds) {
      const incomingMessages = data.filter((message) => !message.isOwn && !previousMessageIds.has(message.id))
      if (incomingMessages.length > 0) {
        showBrowserNotification(
          'Новое сообщение',
          incomingMessages[incomingMessages.length - 1].text,
        )
      }
    }

    knownChatMessageIdsRef.current[chatUserId] = new Set(data.map((message) => message.id))
    setChatMessages(data)
    await loadChatUsers()
  }

  async function sendChatMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!selectedChatUserId || !chatText.trim()) {
      setChatStatus('Выберите пользователя и напишите сообщение')
      return
    }

    const response = await fetch(`/api/chat/${selectedChatUserId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text: chatText }),
    })

    if (!response.ok) {
      setChatStatus('Не удалось отправить сообщение')
      return
    }

    setChatText('')
    setChatStatus('')
    await loadChatMessages(selectedChatUserId)
  }

  async function deleteChatMessage(id: string) {
    const response = await fetch(`/api/chat/messages/${id}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      setChatStatus('Не удалось удалить сообщение')
      return
    }

    setChatStatus('Сообщение удалено')
    await loadChatMessages(selectedChatUserId)
  }

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const response = await fetch('/api/admin/users', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(newUser),
    })

    if (!response.ok) {
      return
    }

    const createdUser = await response.json()
    setUsers((current) => [...current, createdUser])
    setNewUser({
      userName: '',
      displayName: '',
      password: '',
      role: 'User',
    })
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
          : 'Не удалось получить данные Ozon',
      )
      return
    }

    const data: OzonProduct[] = await response.json()
    setOzonProducts(data)
    setOzonStatus(`Загружено товаров Ozon: ${data.length}`)
  }

  async function loadOzonStocks() {
    setStockStatus('Загружаем остатки со склада Ozon...')

    const response = await fetch('/api/ozon/stocks', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      setStockStatus('Не удалось получить остатки Ozon')
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

  async function loadAnalytics() {
    setAnalyticsStatus('Загружаем аналитику Ozon...')

    const response = await fetch('/api/ozon/analytics', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      setAnalyticsStatus('Не удалось получить аналитику Ozon')
      return
    }

    const data: OzonAnalytics = await response.json()
    setAnalytics(data)
    setAnalyticsStatus(`Аналитика обновлена: ${data.timestamp}`)
  }

  async function loadProductionFiles(search: string) {
    const params = new URLSearchParams()
    if (search.trim()) {
      params.set('search', search.trim())
    }

    const response = await fetch(`/api/production/files?${params.toString()}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      setProductionStatus('Не удалось загрузить данные производства')
      return
    }

    const data: ProductionFile[] = await response.json()
    setProductionFiles(data)
    setProductionStatus(data.length ? `Найдено записей: ${data.length}` : 'Записей пока нет')
  }

  async function uploadProductionFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!uploadFile) {
      setProductionStatus('Выберите файл')
      return
    }

    if (!selectedProductionProduct) {
      setProductionStatus('Выберите товар')
      return
    }

    const formData = new FormData()
    formData.append('ozonProductId', String(selectedProductionProduct.productId))
    formData.append('offerId', selectedProductionProduct.offerId)
    formData.append('productName', selectedProductionProduct.name)
    formData.append('notes', '')
    formData.append('file', uploadFile)

    const response = await fetch('/api/production/files', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
      body: formData,
    })

    if (!response.ok) {
      setProductionStatus('Не удалось загрузить файл')
      return
    }

    setUploadFile(null)
    setProductionStatus('Файл загружен')
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
    const response = await fetch(`/api/production/files/${id}`, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      setProductionStatus('Не удалось удалить файл')
      return
    }

    setProductionStatus('Файл удален')
    await loadProductionFiles(productionSearch)
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
    const newTasks = data.filter((task) => task.status === 'New')
    const previousTaskIds = knownNewTaskIdsRef.current
    const nextTaskIds = new Set(newTasks.map((task) => task.id))

    if (previousTaskIds) {
      const arrivedTasks = newTasks.filter((task) => !previousTaskIds.has(task.id))
      if (arrivedTasks.length > 0) {
        showBrowserNotification(
          'Новая задача',
          arrivedTasks.length === 1
            ? getProductionTaskSummary(arrivedTasks[0])
            : `Новых задач: ${arrivedTasks.length}`,
        )
      }
    }

    knownNewTaskIdsRef.current = nextTaskIds
    setProductionTasks(data)
    setTaskStatus(data.length ? `Задач: ${data.length}` : 'Задач пока нет')
  }

  function addDraftTaskItem() {
    const product = ozonProducts.find((item) => String(item.productId) === selectedTaskProductId)
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
        requiredQuantity: quantity,
      },
    ])
    setSelectedTaskProductId('')
    setTaskQuantity('')
    setTaskStatus('Товар добавлен в задачу')
  }

  async function createProductionTasksFromDraft() {
    if (draftTaskItems.length === 0) {
      setTaskStatus('Добавьте хотя бы один товар')
      return
    }

    const response = await fetch('/api/production/tasks', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        items: draftTaskItems.map((item) => ({
          ozonProductId: item.ozonProductId,
          offerId: item.offerId,
          productName: item.productName,
          requiredQuantity: item.requiredQuantity,
        })),
      }),
    })

    if (!response.ok) {
      setTaskStatus('Не удалось создать задачу')
      return
    }

    setDraftTaskItems([])
    setShowCreateTaskModal(false)
    setTaskStatus('Задача создана')
    await loadProductionTasks()
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

  async function deferProductionTask(id: string) {
    const response = await fetch(`/api/production/tasks/${id}/defer`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })

    if (!response.ok) {
      setTaskStatus('Не удалось отложить задачу')
      return
    }

    setTaskStatus('Задача отложена')
    await loadProductionTasks()
  }

  async function completeProductionTask(id: string) {
    const task = productionTasks.find((item) => item.id === id)
    const taskItems = task ? getProductionTaskItems(task) : []
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

    if (!reserveProductName.trim() || !Number.isFinite(quantity) || quantity <= 0) {
      setSupplyStatus('Укажите название резервного товара и количество')
      return
    }

    setDraftSupplyItems((current) => [
      ...current,
      {
        tempId: createTempId(),
        offerId: '',
        productName: reserveProductName.trim(),
        quantity,
        isReserve: true,
      },
    ])
    setReserveProductName('')
    setReserveQuantity('')
    setSupplyStatus('Резервный товар добавлен')
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
      setSupplyStatus('Не удалось заменить резервный товар')
      return
    }

    setReplaceProducts((current) => ({ ...current, [itemId]: '' }))
    setSupplyStatus('Резервный товар заменен на постоянный')
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
        quantity: item.quantity,
        isReserve: item.isReserve,
      })),
    )
    setEditSupplyProductId('')
    setEditSupplyQuantity('')
    setEditReserveProductName('')
    setEditReserveQuantity('')
  }

  function cancelEditSupply() {
    setEditingSupplyId(null)
    setEditSupplyItems([])
    setEditSupplyProductId('')
    setEditSupplyQuantity('')
    setEditReserveProductName('')
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
        quantity,
        isReserve: false,
      },
    ])
    setEditSupplyProductId('')
    setEditSupplyQuantity('')
  }

  function addEditReserveSupplyProduct() {
    const quantity = Number(editReserveQuantity)

    if (!editReserveProductName.trim() || !Number.isFinite(quantity) || quantity <= 0) {
      setSupplyStatus('Укажите название резервного товара и количество')
      return
    }

    setEditSupplyItems((current) => [
      ...current,
      {
        tempId: createTempId(),
        offerId: '',
        productName: editReserveProductName.trim(),
        quantity,
        isReserve: true,
      },
    ])
    setEditReserveProductName('')
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
          <span>LShop Ozon</span>
          <strong>Панель магазина</strong>
        </div>

        <nav className="main-tabs" aria-label="Основные разделы">
          {tabs
            .filter((tab) => !('adminOnly' in tab) || user?.role === 'Admin')
            .map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={activeTab === tab.id ? 'active' : ''}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
                {tab.id === 'chats' && chatUnreadTotal > 0 && (
                  <span className="tab-badge">{chatUnreadTotal}</span>
                )}
              </button>
            ))}
        </nav>

        <div className="session">
          <span>
            <small>В системе</small>
            <strong>{user?.displayName || user?.userName}</strong>
          </span>
          <button type="button" onClick={logout}>
            Выйти
          </button>
        </div>
      </header>

      <div className="app-content">
        <section className="workspace">
          {activeTab === 'production' && (
            <section className="tab-panel">
              <div className="section-title">
                <div>
                  <h2>Производство</h2>
                  <p>{productionSubTab === 'tasks' ? taskStatus : productionStatus || 'Фото, данные и задачи'}</p>
                </div>
                <button
                  type="button"
                  className="header-action"
                  onClick={() => setProductionSubTab('archive')}
                >
                  Архив задач
                </button>
              </div>

              <div className="inner-tabs">
                <button
                  type="button"
                  className={productionSubTab === 'products' ? 'active' : ''}
                  onClick={() => setProductionSubTab('products')}
                >
                  Список товаров
                </button>
                <button
                  type="button"
                  className={productionSubTab === 'tasks' ? 'active' : ''}
                  onClick={() => setProductionSubTab('tasks')}
                >
                  Задачи
                  {newProductionTasks.length > 0 && (
                    <span className="tab-badge">{newProductionTasks.length}</span>
                  )}
                </button>
                <button
                  type="button"
                  className={productionSubTab === 'inProgress' ? 'active' : ''}
                  onClick={() => setProductionSubTab('inProgress')}
                >
                  В работе
                </button>
                <button
                  type="button"
                  className={productionSubTab === 'deferred' ? 'active' : ''}
                  onClick={() => setProductionSubTab('deferred')}
                >
                  Отложенные
                </button>
                <button
                  type="button"
                  className={productionSubTab === 'completed' ? 'active' : ''}
                  onClick={() => setProductionSubTab('completed')}
                >
                  Выполненные
                </button>
              </div>

              {productionSubTab === 'products' && (
                <>
                  <div className="production-tools">
                    <form
                      className="search-form"
                      onSubmit={(event) => {
                        event.preventDefault()
                        loadProductionFiles(productionSearch)
                      }}
                    >
                      <input
                        placeholder="Поиск по любому полю товара или файла"
                        value={productionSearch}
                        onChange={(event) => setProductionSearch(event.target.value)}
                      />
                      <button type="submit">Найти</button>
                    </form>
                  </div>

                  <div className="section-title soft-title">
                    <h2>Товары на Ozon</h2>
                    <p>Ссылки, названия и артикулы</p>
                  </div>

                  <div className="data-table">
                <div className="table-row production-product-row table-head">
                  <span>Товар</span>
                  <span>Артикул</span>
                  <span>Файлы</span>
                  <span>Действия</span>
                </div>
                    {filteredOzonProducts.map((item) => {
                      const isSelected = selectedProductionProductId === item.productId
                      const itemFiles = productionFiles.filter(
                        (file) =>
                          file.offerId === item.offerId || file.ozonProductId === item.productId,
                      )

                      return (
                        <div className="product-row-group" key={item.productId}>
                          <div
                            className={`table-row production-product-row ${
                              isSelected ? 'selected-row' : ''
                            }`}
                          >
                            <span>
                              <strong>{item.name}</strong>
                              <small>{item.status}</small>
                            </span>
                            <span>{item.offerId}</span>
                            <span>
                              {itemFiles.map((file) => (
                                <button
                                  type="button"
                                  key={file.id}
                                  onClick={() => downloadProductionFile(file.id)}
                                >
                                  {file.fileName}
                                </button>
                              ))}
                            </span>
                            <span>
                              {item.productUrl ? (
                                <a href={item.productUrl} target="_blank" rel="noreferrer">
                                  Открыть
                                </a>
                              ) : (
                                '-'
                              )}
                            </span>
                            <span className="row-actions">
                              <button
                                type="button"
                                onClick={() =>
                                  setSelectedProductionProductId(isSelected ? null : item.productId)
                                }
                              >
                                {isSelected ? 'Скрыть' : 'Выбрать'}
                              </button>
                            </span>
                          </div>

                          {isSelected && (
                            <ProductDetail
                              product={item}
                              files={itemFiles}
                              userRole={user?.role}
                              onUpload={uploadProductionFile}
                              onFileChange={setUploadFile}
                              onDownload={downloadProductionFile}
                              onDelete={deleteProductionFile}
                            />
                          )}
                        </div>
                      )
                    })}
                  </div>
                </>
              )}

              {productionSubTab === 'tasks' && (
                <>
                  {user?.role === 'Admin' && (
                    <div className="supply-create-bar">
                      <button type="button" onClick={() => setShowCreateTaskModal(true)}>
                        Создать задачу
                      </button>
                    </div>
                  )}

                  {showCreateTaskModal && user?.role === 'Admin' && (
                    <div className="modal-backdrop" role="presentation">
                      <div className="modal-card modal-card-wide" role="dialog" aria-modal="true">
                        <div className="modal-title-row">
                          <h3>Создать задачу</h3>
                          <button type="button" onClick={() => setShowCreateTaskModal(false)}>
                            Закрыть
                          </button>
                        </div>

                        <div className="task-form task-form-modal">
                          <ProductSearchInput
                            listId="task-products"
                            products={ozonProducts}
                            selectedProductId={selectedTaskProductId}
                            onProductIdChange={setSelectedTaskProductId}
                            placeholder="Начните писать название или артикул"
                          />
                          <input
                            type="number"
                            min="1"
                            placeholder="Нужно сделать, шт."
                            value={taskQuantity}
                            onChange={(event) => setTaskQuantity(event.target.value)}
                          />
                          <button type="button" onClick={addDraftTaskItem}>
                            Добавить
                          </button>
                        </div>

                        <div className="data-table modal-table">
                          <div className="table-row task-draft-row table-head">
                            <span>Товар</span>
                            <span>Артикул</span>
                            <span>Количество</span>
                            <span></span>
                          </div>
                          {draftTaskItems.map((item) => (
                            <div className="table-row task-draft-row" key={item.tempId}>
                              <span>{item.productName}</span>
                              <span>{item.offerId}</span>
                              <span>{item.requiredQuantity}</span>
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
                          ))}
                          {draftTaskItems.length === 0 && (
                            <div className="empty-state">
                              <strong>Добавьте товары в задачу.</strong>
                            </div>
                          )}
                        </div>

                        <div className="supply-actions">
                          <button type="button" onClick={createProductionTasksFromDraft}>
                            Сохранить
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  <ProductionTaskTable
                    tasks={newProductionTasks}
                    actualQuantities={actualQuantities}
                    setActualQuantities={setActualQuantities}
                    onStart={startProductionTask}
                    onDefer={deferProductionTask}
                    onComplete={completeProductionTask}
                  />
                </>
              )}

              {productionSubTab === 'inProgress' && (
                <ProductionTaskTable
                  tasks={inProgressProductionTasks}
                  actualQuantities={actualQuantities}
                  setActualQuantities={setActualQuantities}
                  onStart={startProductionTask}
                  onDefer={deferProductionTask}
                  onComplete={completeProductionTask}
                />
              )}

              {productionSubTab === 'deferred' && (
                <ProductionTaskTable
                  tasks={deferredProductionTasks}
                  actualQuantities={actualQuantities}
                  setActualQuantities={setActualQuantities}
                  onStart={startProductionTask}
                  onDefer={deferProductionTask}
                  onComplete={completeProductionTask}
                  deferred
                />
              )}

              {productionSubTab === 'completed' && (
                <ProductionTaskArchiveTable
                  tasks={completedProductionTasks}
                  onArchive={user?.role === 'Admin' ? archiveProductionTask : undefined}
                  emptyText="Выполненных задач пока нет."
                />
              )}

              {productionSubTab === 'archive' && (
                <ProductionTaskArchiveTable
                  tasks={archivedProductionTasks}
                  onDelete={user?.role === 'Admin' ? deleteProductionTask : undefined}
                  emptyText="В архиве задач пока нет."
                />
              )}
            </section>
          )}

          {activeTab === 'products' && (
            <section className="products">
              <div className="section-title">
                <h2>Товары</h2>
                <p>{isLoading ? 'Загрузка...' : 'Ответ получен от ASP.NET Core'}</p>
              </div>

              <div className="subtabs-placeholder">
                {user?.role === 'Admin' && (
                  <button type="button" onClick={loadOzonProducts}>
                    Обновить товары Ozon
                  </button>
                )}
              </div>

              {ozonStatus && (
                <div className="ozon-status">
                  <strong>{ozonStatus}</strong>
                  {ozonProducts && (
                    <span>
                      Загружено: {ozonProducts.length}
                    </span>
                  )}
                </div>
              )}

              <div className="data-table">
                <div className="table-row ozon-product-row table-head">
                  <span>Товар</span>
                  <span>Артикул</span>
                  <span>Фото</span>
                  <span>Цена</span>
                  <span>Ссылка</span>
                </div>
                {ozonProducts.map((item) => (
                  <div className="table-row ozon-product-row" key={item.productId}>
                    <span>
                      <strong>{item.name}</strong>
                      <small>{item.productId}</small>
                    </span>
                    <span>{item.offerId}</span>
                    <span>
                      {item.imageUrl ? (
                        <img className="product-thumb" src={item.imageUrl} alt="" />
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
                <p>{analyticsStatus || 'Продажи и выручка из Ozon API'}</p>
              </div>
              <div className="inner-tabs">
                <button
                  type="button"
                  className={analyticsSubTab === 'summary' ? 'active' : ''}
                  onClick={() => setAnalyticsSubTab('summary')}
                >
                  Общая аналитика
                </button>
                <button
                  type="button"
                  className={analyticsSubTab === 'topProducts' ? 'active' : ''}
                  onClick={() => setAnalyticsSubTab('topProducts')}
                >
                  Топ товары
                </button>
              </div>
              <div className="subtabs-placeholder">
                <button type="button" onClick={loadAnalytics}>
                  Обновить аналитику
                </button>
              </div>
              {analyticsSubTab === 'summary' && (
                <>
                  <div className="analytics-grid">
                    <div>
                      <span>Товары Ozon</span>
                      <strong>{ozonProducts.length || '-'}</strong>
                    </div>
                    <div>
                      <span>Продано, шт.</span>
                      <strong>{analytics?.orderedUnitsTotal ?? '-'}</strong>
                    </div>
                    <div>
                      <span>Выручка</span>
                      <strong>{analytics ? formatMoney(analytics.revenueTotal, 'KZT') : '-'}</strong>
                    </div>
                    <div>
                      <span>Комиссия Ozon</span>
                      <strong>{analytics ? formatMoney(analytics.commissionTotal, 'KZT') : '-'}</strong>
                    </div>
                    <div>
                      <span>К выплате</span>
                      <strong>{analytics ? formatMoney(analytics.payoutTotal, 'KZT') : '-'}</strong>
                    </div>
                    <div>
                      <span>Логистика</span>
                      <strong>{analytics ? formatMoney(analytics.logisticsTotal, 'KZT') : '-'}</strong>
                    </div>
                    <div>
                      <span>Прочие услуги</span>
                      <strong>{analytics ? formatMoney(analytics.servicesTotal, 'KZT') : '-'}</strong>
                    </div>
                    <div>
                      <span>Собираются</span>
                      <strong>{analytics?.awaitingDeliverCount ?? '-'}</strong>
                    </div>
                    <div>
                      <span>Едут</span>
                      <strong>{analytics?.deliveringCount ?? '-'}</strong>
                    </div>
                    <div>
                      <span>Доставлены</span>
                      <strong>{analytics?.deliveredCount ?? '-'}</strong>
                    </div>
                  </div>
                  <div className="data-table">
                    <div className="table-row analytics-row table-head">
                      <span>Артикул</span>
                      <span>Товар</span>
                      <span>Статус</span>
                      <span>Шт.</span>
                      <span>Выручка</span>
                      <span>Комиссия</span>
                      <span>Логистика</span>
                      <span>К выплате</span>
                    </div>
                    {analytics?.rows.map((row) => (
                      <div className="table-row analytics-row" key={`${row.postingNumber}-${row.sku}`}>
                        <span>
                          <strong>{row.offerId}</strong>
                          <small>{row.sku}</small>
                        </span>
                        <span>{row.productName}</span>
                        <span>{translateStatus(row.status)}</span>
                        <span>{row.quantity}</span>
                        <span>{formatMoney(row.revenue, row.currencyCode || 'KZT')}</span>
                        <span>
                          {row.commissionPercent}% / {formatMoney(row.commissionAmount, row.currencyCode || 'KZT')}
                        </span>
                        <span>{formatMoney(row.logisticsAmount, row.currencyCode || 'KZT')}</span>
                        <span>{formatMoney(row.payout, row.currencyCode || 'KZT')}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {analyticsSubTab === 'topProducts' && (
                <>
                  <div className="ozon-status">
                    <strong>Все продажи без фильтра по статусу доставки</strong>
                    <span>Сортировка по количеству продаж</span>
                  </div>
                  <div className="data-table">
                    <div className="table-row top-products-row table-head">
                      <span>Место</span>
                      <span>Товар</span>
                      <span>Артикул</span>
                      <span>SKU</span>
                      <span>Продано</span>
                      <span>Сумма заказов</span>
                    </div>
                    {topAnalyticsProducts.map((row, index) => (
                      <div className="table-row top-products-row" key={row.key}>
                        <span>{index + 1}</span>
                        <span>
                          <strong>{row.productName}</strong>
                        </span>
                        <span>{row.offerId || '-'}</span>
                        <span>{row.sku || '-'}</span>
                        <span>{row.quantity}</span>
                        <span>{formatMoney(row.revenue, row.currencyCode)}</span>
                      </div>
                    ))}
                    {topAnalyticsProducts.length === 0 && (
                      <div className="empty-state">
                        <strong>Проданных товаров пока нет.</strong>
                      </div>
                    )}
                  </div>
                </>
              )}
            </section>
          )}

          {activeTab === 'pooling' && (
            <section className="tab-panel">
              <div className="section-title">
                <h2>Складчина</h2>
                <p>{priceStatus || stockStatus || 'Остатки товаров на складе Ozon'}</p>
              </div>
              <div className="subtabs-placeholder">
                <button type="button" onClick={loadOzonStocks}>
                  Обновить остатки Ozon
                </button>
                <span className="sort-actions stock-sort-actions">
                  <button type="button" onClick={() => setStockSortDirection('desc')}>
                    По убыванию
                  </button>
                  <button type="button" onClick={() => setStockSortDirection('asc')}>
                    По возрастанию
                  </button>
                </span>
              </div>
              <div className="data-table stock-table">
                <div className="table-row stock-row table-head">
                  <span>Товар</span>
                  <span>Артикул</span>
                  <span>FBO</span>
                  <span>FBS</span>
                  <span>Цена</span>
                  <span>Действие</span>
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
                  />
                ))}
              </div>
            </section>
          )}

          {activeTab === 'supplies' && (
            <section className="tab-panel">
              <div className="section-title">
                <div>
                  <h2>Поставки</h2>
                  <p>{supplyStatus || 'Создание, статусы и аналитика поставок'}</p>
                </div>
                {user?.role === 'Admin' && (
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
                >
                  Создать поставку
                </button>
                {user?.role === 'Admin' && (
                  <button
                    type="button"
                    className={supplySubTab === 'editor' ? 'active' : ''}
                    onClick={() => setSupplySubTab('editor')}
                  >
                    Редактор поставок
                  </button>
                )}
                <button
                  type="button"
                  className={supplySubTab === 'all' ? 'active' : ''}
                  onClick={() => setSupplySubTab('all')}
                >
                  Все поставки
                </button>
                {user?.role === 'Admin' && (
                  <button
                    type="button"
                    className={supplySubTab === 'analytics' ? 'active' : ''}
                    onClick={() => setSupplySubTab('analytics')}
                  >
                    Аналитика поставок
                  </button>
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
                          Добавьте товары из списка Ozon или резервные товары, если товара еще
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
                    <div className="modal-backdrop" role="presentation">
                      <div className="modal-card modal-card-wide" role="dialog" aria-modal="true">
                        <div className="modal-title-row">
                          <h3>Создать поставку</h3>
                          <button
                            type="button"
                            onClick={() => setShowCreateSupplyModal(false)}
                          >
                            Закрыть
                          </button>
                        </div>

                        <div className="supply-forms">
                          <div className="supply-form-block">
                            <strong>Товар из Ozon</strong>
                            <ProductSearchInput
                              listId="supply-products"
                              products={ozonProducts}
                              selectedProductId={supplyProductId}
                              onProductIdChange={setSupplyProductId}
                              placeholder="Начните писать название или артикул"
                            />
                            <input
                              type="number"
                              min="1"
                              placeholder="Количество"
                              value={supplyQuantity}
                              onChange={(event) => setSupplyQuantity(event.target.value)}
                            />
                            <button type="button" onClick={addSupplyProduct}>
                              Добавить
                            </button>
                          </div>

                          <div className="supply-form-block">
                            <strong>Резервный товар</strong>
                            <input
                              placeholder="Название резервного товара"
                              value={reserveProductName}
                              onChange={(event) => setReserveProductName(event.target.value)}
                            />
                            <input
                              type="number"
                              min="1"
                              placeholder="Количество"
                              value={reserveQuantity}
                              onChange={(event) => setReserveQuantity(event.target.value)}
                            />
                            <button type="button" onClick={addReserveSupplyProduct}>
                              Создать резервный товар
                            </button>
                          </div>
                        </div>

                        <div className="data-table modal-table">
                          <div className="table-row supply-item-row table-head">
                            <span>Товар в новой поставке</span>
                            <span>Артикул</span>
                            <span>Количество</span>
                            <span>Тип</span>
                            <span></span>
                          </div>
                          {draftSupplyItems.map((item) => (
                            <div className="table-row supply-item-row" key={item.tempId}>
                              <span>{item.productName}</span>
                              <span>{item.offerId || '-'}</span>
                              <span>{item.quantity}</span>
                              <span>{item.isReserve ? 'Резервный' : 'Постоянный'}</span>
                              <span>
                                <button
                                  type="button"
                                  className="danger"
                                  onClick={() =>
                                    setDraftSupplyItems((current) =>
                                      current.filter((draft) => draft.tempId !== item.tempId),
                                    )
                                  }
                                >
                                  Убрать
                                </button>
                              </span>
                            </div>
                          ))}
                          {draftSupplyItems.length === 0 && (
                            <div className="empty-state">
                              <strong>Добавьте товары в поставку.</strong>
                            </div>
                          )}
                        </div>

                        <div className="supply-actions">
                          <button type="button" onClick={createSupply}>
                            Сохранить
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  <SupplyTable
                    supplies={createdSupplies}
                    ozonProducts={ozonProducts}
                    replaceProducts={replaceProducts}
                    setReplaceProducts={setReplaceProducts}
                    editingSupplyId={editingSupplyId}
                    editSupplyItems={editSupplyItems}
                    setEditSupplyItems={setEditSupplyItems}
                    editSupplyProductId={editSupplyProductId}
                    setEditSupplyProductId={setEditSupplyProductId}
                    editSupplyQuantity={editSupplyQuantity}
                    setEditSupplyQuantity={setEditSupplyQuantity}
                    editReserveProductName={editReserveProductName}
                    setEditReserveProductName={setEditReserveProductName}
                    editReserveQuantity={editReserveQuantity}
                    setEditReserveQuantity={setEditReserveQuantity}
                    onStartEdit={startEditSupply}
                    onCancelEdit={cancelEditSupply}
                    onAddEditProduct={addEditSupplyProduct}
                    onAddEditReserve={addEditReserveSupplyProduct}
                  onSaveEdit={saveSupplyEdit}
                  onDeleteSupply={deleteSupply}
                  onArchiveSupply={archiveSupply}
                  onStatusChange={updateSupplyStatus}
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
                  editSupplyItems={editSupplyItems}
                  setEditSupplyItems={setEditSupplyItems}
                  editSupplyProductId={editSupplyProductId}
                  setEditSupplyProductId={setEditSupplyProductId}
                  editSupplyQuantity={editSupplyQuantity}
                  setEditSupplyQuantity={setEditSupplyQuantity}
                  editReserveProductName={editReserveProductName}
                  setEditReserveProductName={setEditReserveProductName}
                  editReserveQuantity={editReserveQuantity}
                  setEditReserveQuantity={setEditReserveQuantity}
                  onStartEdit={startEditSupply}
                  onCancelEdit={cancelEditSupply}
                  onAddEditProduct={addEditSupplyProduct}
                  onAddEditReserve={addEditReserveSupplyProduct}
                  onSaveEdit={saveSupplyEdit}
                  onDeleteSupply={deleteSupply}
                  onArchiveSupply={archiveSupply}
                  onStatusChange={updateSupplyStatus}
                  onReplaceReserve={replaceReserveItem}
                  userRole={user?.role}
                  hideItemsUntilEdit
                />
              )}

              {supplySubTab === 'all' && <AllSuppliesTable supplies={activeSupplies} />}

              {supplySubTab === 'archive' && user?.role === 'Admin' && (
                <SupplyTable
                  supplies={archivedSupplies}
                  ozonProducts={ozonProducts}
                  replaceProducts={replaceProducts}
                  setReplaceProducts={setReplaceProducts}
                  editingSupplyId={editingSupplyId}
                  editSupplyItems={editSupplyItems}
                  setEditSupplyItems={setEditSupplyItems}
                  editSupplyProductId={editSupplyProductId}
                  setEditSupplyProductId={setEditSupplyProductId}
                  editSupplyQuantity={editSupplyQuantity}
                  setEditSupplyQuantity={setEditSupplyQuantity}
                  editReserveProductName={editReserveProductName}
                  setEditReserveProductName={setEditReserveProductName}
                  editReserveQuantity={editReserveQuantity}
                  setEditReserveQuantity={setEditReserveQuantity}
                  onStartEdit={startEditSupply}
                  onCancelEdit={cancelEditSupply}
                  onAddEditProduct={addEditSupplyProduct}
                  onAddEditReserve={addEditReserveSupplyProduct}
                  onSaveEdit={saveSupplyEdit}
                  onDeleteSupply={deleteSupply}
                  onArchiveSupply={archiveSupply}
                  onStatusChange={updateSupplyStatus}
                  onReplaceReserve={replaceReserveItem}
                  userRole={user?.role}
                  archiveMode
                  hideItemsUntilEdit
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
                  </div>

                  <SupplyAnalyticsTable rows={filteredSupplyAnalytics} />
                </>
              )}
            </section>
          )}

          {activeTab === 'chats' && (
            <section className="tab-panel chat-panel">
              <div className="section-title">
                <div>
                  <h2>Чаты</h2>
                  <p>{chatStatus || 'Обмен сообщениями между пользователями'}</p>
                </div>
                <button type="button" className="header-action" onClick={loadChatUsers}>
                  Обновить
                </button>
              </div>

              <div className="chat-layout">
                <aside className="chat-users">
                  {chatUsers.map((item) => (
                    <button
                      type="button"
                      className={selectedChatUserId === item.id ? 'active' : ''}
                      onClick={() => setSelectedChatUserId(item.id)}
                      key={item.id}
                    >
                      <span>
                        <strong>{item.displayName || item.userName}</strong>
                        <small>{item.userName}</small>
                      </span>
                      <b className={item.isOnline ? 'online-dot' : 'offline-dot'}>
                        {item.isOnline ? 'В сети' : 'Не в сети'}
                      </b>
                      {(item.unreadCount ?? 0) > 0 && (
                        <span className="tab-badge">{item.unreadCount}</span>
                      )}
                    </button>
                  ))}
                  {chatUsers.length === 0 && (
                    <div className="empty-state">
                      <strong>Пока нет других пользователей для переписки.</strong>
                    </div>
                  )}
                </aside>

                <section className="chat-window">
                  {selectedChatUser ? (
                    <>
                      <div className="chat-window-head">
                        <span>
                          <strong>{selectedChatUser.displayName || selectedChatUser.userName}</strong>
                          <small>{selectedChatUser.isOnline ? 'В сети' : 'Не в сети'}</small>
                        </span>
                      </div>

                      <div className="chat-messages">
                        {chatMessages.map((message) => (
                          <div
                            className={`chat-message ${message.isOwn ? 'own' : 'incoming'}`}
                            key={message.id}
                          >
                            <p>{message.text}</p>
                            <span>
                              {formatDateTime(message.createdAt)}
                              {(message.isOwn || user?.role === 'Admin') && (
                                <button type="button" onClick={() => deleteChatMessage(message.id)}>
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
                      </div>

                      <form className="chat-form" onSubmit={sendChatMessage}>
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
                        <button type="submit">Отправить</button>
                      </form>
                    </>
                  ) : (
                    <div className="empty-state">
                      <strong>Выберите пользователя слева.</strong>
                    </div>
                  )}
                </section>
              </div>
            </section>
          )}

          {activeTab === 'users' && user?.role === 'Admin' && (
            <section className="admin-panel">
              <div className="section-title">
                <h2>Пользователи</h2>
                <p>Добавляет только админ</p>
              </div>

              <form className="user-form" onSubmit={createUser}>
                <input
                  placeholder="Логин"
                  value={newUser.userName}
                  onChange={(event) => setNewUser({ ...newUser, userName: event.target.value })}
                  required
                />
                <input
                  placeholder="Имя"
                  value={newUser.displayName}
                  onChange={(event) => setNewUser({ ...newUser, displayName: event.target.value })}
                  required
                />
                <input
                  placeholder="Пароль"
                  type="password"
                  value={newUser.password}
                  onChange={(event) => setNewUser({ ...newUser, password: event.target.value })}
                  required
                />
                <select
                  value={newUser.role}
                  onChange={(event) => setNewUser({ ...newUser, role: event.target.value })}
                >
                  <option value="User">User</option>
                  <option value="Admin">Admin</option>
                </select>
                <button type="submit">Добавить</button>
              </form>

              <ul className="users-list">
                {users.map((item) => (
                  <li key={item.id}>
                    <span>
                      <strong>{item.userName}</strong>
                      <small>{item.displayName}</small>
                    </span>
                    <b>{item.role}</b>
                    <span className={`online-status ${item.isOnline ? 'is-online' : 'is-offline'}`}>
                      {item.isOnline ? 'В сети' : 'Не в сети'}
                      {!item.isOnline && item.lastSeenAt && (
                        <small>Был: {formatDateTime(item.lastSeenAt)}</small>
                      )}
                    </span>
                    <input
                      placeholder="Новый пароль"
                      type="password"
                      value={passwordEdits[item.id] ?? ''}
                      onChange={(event) =>
                        setPasswordEdits((current) => ({
                          ...current,
                          [item.id]: event.target.value,
                        }))
                      }
                    />
                    <button type="button" onClick={() => changeUserPassword(item.id)}>
                      Сменить пароль
                    </button>
                    <button type="button" className="danger" onClick={() => deleteUser(item.id)}>
                      Удалить
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {activeTab === 'settings' && user?.role === 'Admin' && (
            <section className="admin-panel">
              <div className="section-title">
                <div>
                  <h2>Настройки</h2>
                  <p>{auditStatus || 'Системные инструменты и журнал действий'}</p>
                </div>
                <span className="section-actions">
                  <button type="button" className="header-action" onClick={() => loadAuditLogs()}>
                    Обновить журнал
                  </button>
                  <button type="button" className="header-action" onClick={exportAuditLogs}>
                    Скачать CSV
                  </button>
                </span>
              </div>

              <div className="settings-grid">
                <div>
                  <span>База данных</span>
                  <strong>PostgreSQL</strong>
                  <small>Работает внутри Docker Compose.</small>
                </div>
                <div>
                  <span>Бэкапы</span>
                  <strong>Каждые 24 часа</strong>
                  <small>Файлы складываются в папку backups рядом с проектом.</small>
                </div>
                <div>
                  <span>Просмотр БД</span>
                  <strong>Adminer</strong>
                  <a href="http://localhost:8082" target="_blank" rel="noreferrer">
                    Открыть Adminer
                  </a>
                </div>
              </div>

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
                <button type="submit">Найти</button>
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
            </section>
          )}
        </section>
      </div>
    </main>
  )
}

function ProductSearchInput({
  listId,
  products,
  selectedProductId,
  onProductIdChange,
  placeholder,
  required = false,
}: {
  listId: string
  products: OzonProduct[]
  selectedProductId: string
  onProductIdChange: (productId: string) => void
  placeholder: string
  required?: boolean
}) {
  const selectedProduct = products.find((product) => String(product.productId) === selectedProductId)
  const selectedLabel = selectedProduct ? formatProductOption(selectedProduct) : ''
  const [query, setQuery] = useState(selectedLabel)
  const normalizedQuery = query.trim().toLowerCase()
  const filteredProducts = normalizedQuery
    ? products
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
    : products.slice(0, 80)

  useEffect(() => {
    setQuery(selectedLabel)
  }, [selectedLabel])

  function handleChange(value: string) {
    setQuery(value)

    const selected = products.find((product) => {
      const productId = String(product.productId)
      return productId === value || formatProductOption(product) === value
    })

    onProductIdChange(selected ? String(selected.productId) : '')
  }

  return (
    <>
      <input
        className="product-search-input"
        list={listId}
        placeholder={placeholder}
        value={query}
        onChange={(event) => handleChange(event.target.value)}
        required={required}
      />
      <datalist id={listId}>
        {filteredProducts.map((product) => (
          <option value={formatProductOption(product)} key={product.productId} />
        ))}
      </datalist>
    </>
  )
}

function formatProductOption(product: OzonProduct) {
  const sku = product.sku ? ` | SKU ${product.sku}` : ''
  return `${product.offerId} | ${product.name}${sku} | ID ${product.productId}`
}

function ProductDetail({
  product,
  files,
  userRole,
  onUpload,
  onFileChange,
  onDownload,
  onDelete,
}: {
  product: OzonProduct
  files: ProductionFile[]
  userRole?: string
  onUpload: (event: FormEvent<HTMLFormElement>) => void
  onFileChange: (file: File | null) => void
  onDownload: (id: string) => void
  onDelete: (id: string) => void
}) {
  return (
    <section className="product-detail inline-detail">
      <div className="product-preview">
        <div className="preview-media">
          {product.imageUrl ? <img src={product.imageUrl} alt="" /> : <span>Нет фото</span>}
        </div>
        <div>
          <p className="eyebrow">Карточка товара</p>
          <h2>{product.name}</h2>
          <dl>
            <div>
              <dt>Артикул</dt>
              <dd>{product.offerId}</dd>
            </div>
            <div>
              <dt>Product ID</dt>
              <dd>{product.productId}</dd>
            </div>
            <div>
              <dt>Статус</dt>
              <dd>{product.status}</dd>
            </div>
          </dl>
          {product.productUrl && (
            <a className="product-link" href={product.productUrl} target="_blank" rel="noreferrer">
              Открыть товар на Ozon
            </a>
          )}
        </div>
      </div>

      <form className="product-file-form" onSubmit={onUpload}>
        <input
          type="file"
          accept="image/*,.pdf,.xlsx,.xls,.doc,.docx"
          onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}
        />
        <button type="submit">Добавить файл</button>
      </form>

      <div className="data-table">
        <div className="table-row file-row table-head">
          <span>Файл</span>
          <span>Дата</span>
          <span>Действия</span>
        </div>
        {files.map((file) => (
          <div className="table-row file-row" key={file.id}>
            <span>{file.fileName}</span>
            <span>{new Date(file.createdAt).toLocaleDateString('ru-RU')}</span>
            <span className="file-actions">
              <button type="button" onClick={() => onDownload(file.id)}>
                Скачать
              </button>
              {userRole === 'Admin' && (
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
    </section>
  )
}

function ProductionTaskTable({
  tasks,
  actualQuantities,
  setActualQuantities,
  onStart,
  onDefer,
  onComplete,
  onDelete,
  completed = false,
  deferred = false,
}: {
  tasks: ProductionTask[]
  actualQuantities: Record<string, string>
  setActualQuantities: Dispatch<SetStateAction<Record<string, string>>>
  onStart: (id: string) => void
  onDefer: (id: string) => void
  onComplete: (id: string) => void
  onDelete?: (id: string) => void
  completed?: boolean
  deferred?: boolean
}) {
  return (
    <div className="data-table">
      <div className="table-row task-row table-head">
        <span>Товар</span>
        <span>Артикул</span>
        <span>Нужно</span>
        <span>Факт</span>
        <span>Статус</span>
        <span>Исполнитель</span>
        <span></span>
      </div>
      {tasks.map((task) => {
        const taskItems = getProductionTaskItems(task)
        const isStaleDeferred =
          task.status === 'Deferred' &&
          task.deferredAt &&
          Date.now() - new Date(task.deferredAt).getTime() > 2 * 24 * 60 * 60 * 1000

        return (
        <details className={`task-details-row ${isStaleDeferred ? 'deferred-stale' : ''}`} key={task.id}>
          <summary className="table-row task-row">
          <span>
            <strong>{getProductionTaskSummary(task)}</strong>
            <small>
              {task.status === 'Deferred' && task.deferredAt
                ? `Отложена: ${new Date(task.deferredAt).toLocaleDateString('ru-RU')}`
                : new Date(task.createdAt).toLocaleDateString('ru-RU')}
            </small>
          </span>
          <span>{taskItems.map((item) => item.offerId || '-').join(', ')}</span>
          <span>{getProductionTaskRequiredTotal(task)}</span>
          <span>
            {completed ? (
              getProductionTaskActualTotal(task)
            ) : (
              <small>По товарам</small>
            )}
          </span>
          <span>{translateProductionTaskStatus(task.status)}</span>
          <span>{task.assignedUserName || '-'}</span>
          <span className="task-actions">
            {!completed && task.status === 'New' && (
              <button type="button" onClick={(event) => {
                event.preventDefault()
                onStart(task.id)
              }}>
                В работу
              </button>
            )}
            {!completed && task.status !== 'Deferred' && (
              <button type="button" onClick={(event) => {
                event.preventDefault()
                onDefer(task.id)
              }}>
                Отложить
              </button>
            )}
            {deferred && (
              <button type="button" onClick={(event) => {
                event.preventDefault()
                onStart(task.id)
              }}>
                В работу
              </button>
            )}
            {!completed && (
              <button type="button" onClick={(event) => {
                event.preventDefault()
                onComplete(task.id)
              }}>
                Завершить
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
          <div className="task-items-table">
            <div className="table-row task-item-table-row table-head">
              <span>Товар</span>
              <span>Артикул</span>
              <span>План</span>
              <span>Факт</span>
            </div>
            {taskItems.map((item) => (
              <div className="table-row task-item-table-row" key={item.id}>
                <span>
                  <strong>{item.productName}</strong>
                </span>
                <span>{item.offerId || '-'}</span>
                <span>{item.requiredQuantity}</span>
                <span>
                  {completed ? (
                    item.actualQuantity ?? 0
                  ) : (
                    <input
                      type="number"
                      min="0"
                      placeholder="Факт"
                      value={actualQuantities[item.id] ?? ''}
                      onChange={(event) =>
                        setActualQuantities((current) => ({
                          ...current,
                          [item.id]: event.target.value,
                        }))
                      }
                    />
                  )}
                </span>
              </div>
            ))}
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
  }]
}

function getProductionTaskRequiredTotal(task: ProductionTask) {
  return getProductionTaskItems(task).reduce((sum, item) => sum + item.requiredQuantity, 0)
}

function getProductionTaskActualTotal(task: ProductionTask) {
  return getProductionTaskItems(task).reduce((sum, item) => sum + (item.actualQuantity ?? 0), 0)
}

function getProductionTaskSummary(task: ProductionTask) {
  const items = getProductionTaskItems(task)
  return items.length === 1 ? items[0].productName : `${items.length} товаров в задаче`
}

function ProductionTaskArchiveTable({
  tasks,
  onArchive,
  onDelete,
  emptyText = 'В архиве задач пока нет.',
}: {
  tasks: ProductionTask[]
  onArchive?: (id: string) => void
  onDelete?: (id: string) => void
  emptyText?: string
}) {
  return (
    <div className="data-table">
      <div className="table-row task-archive-row table-head">
        <span>Что было в задаче</span>
        <span>Артикул</span>
        <span>План</span>
        <span>Факт</span>
        <span>Кто выполнял</span>
        <span>Взял в работу</span>
        <span>Завершил</span>
        <span></span>
      </div>
      {tasks.map((task) => (
        <details className="task-details-row" key={task.id}>
          <summary className="table-row task-archive-row">
          <span>
            <strong>{getProductionTaskSummary(task)}</strong>
            <small>Создана: {formatDateTime(task.createdAt)}</small>
          </span>
          <span>{getProductionTaskItems(task).map((item) => item.offerId || '-').join(', ')}</span>
          <span>{getProductionTaskRequiredTotal(task)}</span>
          <span>{getProductionTaskActualTotal(task)}</span>
          <span>{task.assignedUserName || '-'}</span>
          <span>{task.startedAt ? formatDateTime(task.startedAt) : '-'}</span>
          <span>{task.completedAt ? formatDateTime(task.completedAt) : '-'}</span>
          <span className="task-actions">
            {onArchive && (
              <button type="button" onClick={(event) => {
                event.preventDefault()
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
          <div className="task-items-table">
            <div className="table-row task-item-table-row table-head">
              <span>Товар</span>
              <span>Артикул</span>
              <span>План</span>
              <span>Факт</span>
            </div>
            {getProductionTaskItems(task).map((item) => (
              <div className="table-row task-item-table-row" key={item.id}>
                <span>
                  <strong>{item.productName}</strong>
                </span>
                <span>{item.offerId || '-'}</span>
                <span>{item.requiredQuantity}</span>
                <span>{item.actualQuantity ?? 0}</span>
              </div>
            ))}
          </div>
        </details>
      ))}
      {tasks.length === 0 && (
        <div className="empty-state">
          <strong>{emptyText}</strong>
        </div>
      )}
    </div>
  )
}

function SupplyTable({
  supplies,
  ozonProducts,
  replaceProducts,
  setReplaceProducts,
  editingSupplyId,
  editSupplyItems,
  setEditSupplyItems,
  editSupplyProductId,
  setEditSupplyProductId,
  editSupplyQuantity,
  setEditSupplyQuantity,
  editReserveProductName,
  setEditReserveProductName,
  editReserveQuantity,
  setEditReserveQuantity,
  onStartEdit,
  onCancelEdit,
  onAddEditProduct,
  onAddEditReserve,
  onSaveEdit,
  onDeleteSupply,
  onArchiveSupply,
  onStatusChange,
  onReplaceReserve,
  userRole,
  hideItemsUntilEdit = false,
  archiveMode = false,
}: {
  supplies: Supply[]
  ozonProducts: OzonProduct[]
  replaceProducts: Record<string, string>
  setReplaceProducts: Dispatch<SetStateAction<Record<string, string>>>
  editingSupplyId: string | null
  editSupplyItems: DraftSupplyItem[]
  setEditSupplyItems: Dispatch<SetStateAction<DraftSupplyItem[]>>
  editSupplyProductId: string
  setEditSupplyProductId: Dispatch<SetStateAction<string>>
  editSupplyQuantity: string
  setEditSupplyQuantity: Dispatch<SetStateAction<string>>
  editReserveProductName: string
  setEditReserveProductName: Dispatch<SetStateAction<string>>
  editReserveQuantity: string
  setEditReserveQuantity: Dispatch<SetStateAction<string>>
  onStartEdit: (supply: Supply) => void
  onCancelEdit: () => void
  onAddEditProduct: () => void
  onAddEditReserve: () => void
  onSaveEdit: (id: string) => void
  onDeleteSupply: (id: string) => void
  onArchiveSupply: (id: string) => void
  onStatusChange: (id: string, status: SupplyStatus) => void
  onReplaceReserve: (itemId: string) => void
  userRole?: string
  hideItemsUntilEdit?: boolean
  archiveMode?: boolean
}) {
  const [expandedArchiveSupplyIds, setExpandedArchiveSupplyIds] = useState<Record<string, boolean>>({})

  return (
    <div className="supply-list">
      {supplies.map((supply) => {
        const isEditing = editingSupplyId === supply.id
        const canEdit = !archiveMode && (userRole === 'Admin' || supply.status === 'Created')
        const isArchiveExpanded = expandedArchiveSupplyIds[supply.id] ?? false
        const showItems = (archiveMode && isArchiveExpanded) || isEditing || (!archiveMode && !hideItemsUntilEdit)
        const rows: DraftSupplyItem[] = isEditing
          ? editSupplyItems
          : supply.items.map((item) => ({
              tempId: item.id,
              id: item.id,
              ozonProductId: item.ozonProductId,
              offerId: item.offerId,
              productName: item.productName,
              quantity: item.quantity,
              isReserve: item.isReserve,
            }))

        return (
          <section className="supply-card" key={supply.id}>
            <div className="supply-card-head">
              <span>
                <strong>Поставка от {formatDateTime(supply.createdAt)}</strong>
                <small>
                  Отгрузка: {supply.sentAt ? formatDateTime(supply.sentAt) : '-'} | Приемка:{' '}
                  {supply.acceptedAt ? formatDateTime(supply.acceptedAt) : '-'}
                </small>
              </span>
              <span className="status-pill">{translateSupplyStatus(supply.status)}</span>
              {(canEdit || archiveMode) && (
                <span className="supply-status-actions">
                  {!archiveMode && supply.status === 'Created' && (
                    <button type="button" onClick={() => onStatusChange(supply.id, 'Sent')}>
                      Отправлено
                    </button>
                  )}
                  {userRole === 'Admin' && !archiveMode && (
                    <>
                      <button type="button" onClick={() => onStatusChange(supply.id, 'Accepted')}>
                        Принято
                      </button>
                    </>
                  )}
                  {isEditing ? (
                    <>
                      <button type="button" onClick={() => onSaveEdit(supply.id)}>
                        Сохранить
                      </button>
                      <button type="button" onClick={onCancelEdit}>
                        Отмена
                      </button>
                    </>
                  ) : (
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

            {isEditing && (
              <div className="supply-edit-tools">
                <div className="supply-form-block">
                  <strong>Добавить товар из Ozon</strong>
                  <ProductSearchInput
                    listId={`edit-supply-products-${supply.id}`}
                    products={ozonProducts}
                    selectedProductId={editSupplyProductId}
                    onProductIdChange={setEditSupplyProductId}
                    placeholder="Начните писать название или артикул"
                  />
                  <input
                    type="number"
                    min="1"
                    placeholder="Количество"
                    value={editSupplyQuantity}
                    onChange={(event) => setEditSupplyQuantity(event.target.value)}
                  />
                  <button type="button" onClick={onAddEditProduct}>
                    Добавить
                  </button>
                </div>

                <div className="supply-form-block">
                  <strong>Добавить резервный товар</strong>
                  <input
                    placeholder="Название"
                    value={editReserveProductName}
                    onChange={(event) => setEditReserveProductName(event.target.value)}
                  />
                  <input
                    type="number"
                    min="1"
                    placeholder="Количество"
                    value={editReserveQuantity}
                    onChange={(event) => setEditReserveQuantity(event.target.value)}
                  />
                  <button type="button" onClick={onAddEditReserve}>
                    Добавить резерв
                  </button>
                </div>
              </div>
            )}

            {showItems && (
              <div className="data-table">
                <div className="table-row supply-item-row table-head">
                  <span>Товар</span>
                  <span>Артикул</span>
                  <span>Количество</span>
                  <span>Тип</span>
                  <span>{isEditing ? 'Действия' : 'Замена'}</span>
                </div>
                {rows.map((item) => (
                  <div className="table-row supply-item-row" key={isEditing ? item.tempId : item.id}>
                    <span>
                      {isEditing && item.isReserve ? (
                        <input
                          value={item.productName}
                          onChange={(event) =>
                            setEditSupplyItems((current) =>
                              current.map((row) =>
                                row.tempId === item.tempId
                                  ? { ...row, productName: event.target.value }
                                  : row,
                              ),
                            )
                          }
                        />
                      ) : (
                        item.productName
                      )}
                    </span>
                    <span>{item.offerId || '-'}</span>
                    <span>
                      {isEditing ? (
                        <input
                          type="number"
                          min="1"
                          value={item.quantity}
                          onChange={(event) =>
                            setEditSupplyItems((current) =>
                              current.map((row) =>
                                row.tempId === item.tempId
                                  ? { ...row, quantity: Number(event.target.value) }
                                  : row,
                              ),
                            )
                          }
                        />
                      ) : (
                        item.quantity
                      )}
                    </span>
                    <span>{item.isReserve ? 'Резервный' : 'Постоянный'}</span>
                    <span className="reserve-replace">
                      {isEditing ? (
                        <>
                          {item.isReserve && (
                            <>
                              <ProductSearchInput
                                listId={`edit-replace-products-${item.tempId}`}
                                products={ozonProducts}
                                selectedProductId={replaceProducts[item.tempId] ?? ''}
                                onProductIdChange={(productId) =>
                                  setReplaceProducts((current) => ({
                                    ...current,
                                    [item.tempId]: productId,
                                  }))
                                }
                                placeholder="Найти постоянный товар"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  const product = ozonProducts.find(
                                    (product) =>
                                      String(product.productId) === replaceProducts[item.tempId],
                                  )

                                  if (!product) {
                                    return
                                  }

                                  setEditSupplyItems((current) =>
                                    current.map((row) =>
                                      row.tempId === item.tempId
                                        ? {
                                            ...row,
                                            ozonProductId: product.productId,
                                            offerId: product.offerId,
                                            productName: product.name,
                                            isReserve: false,
                                          }
                                        : row,
                                    ),
                                  )
                                  setReplaceProducts((current) => ({
                                    ...current,
                                    [item.tempId]: '',
                                  }))
                                }}
                              >
                                Заменить
                              </button>
                            </>
                          )}
                          <button
                            type="button"
                            className="danger"
                            onClick={() =>
                              setEditSupplyItems((current) =>
                                current.filter((row) => row.tempId !== item.tempId),
                              )
                            }
                          >
                            Удалить строку
                          </button>
                        </>
                      ) : item.isReserve && userRole === 'Admin' ? (
                        <>
                          <ProductSearchInput
                            listId={`replace-products-${item.id}`}
                            products={ozonProducts}
                            selectedProductId={replaceProducts[item.id ?? ''] ?? ''}
                            onProductIdChange={(productId) =>
                              setReplaceProducts((current) => ({
                                ...current,
                                [item.id ?? '']: productId,
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
                ))}
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
            <small>{row.isReserve ? 'Резервный товар' : 'Постоянный товар'}</small>
          </span>
          <span>{row.offerId || '-'}</span>
          <span>{row.quantity}</span>
          <span>{translateSupplyStatus(row.status)}</span>
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
                <strong>Поставка от {formatDateTime(supply.createdAt)}</strong>
                <small>
                  Отгрузка: {supply.sentAt ? formatDateTime(supply.sentAt) : '-'} | Приемка:{' '}
                  {supply.acceptedAt ? formatDateTime(supply.acceptedAt) : '-'}
                </small>
              </span>
              <span className="status-pill">{translateSupplyStatus(supply.status)}</span>
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
                  <span>{item.offerId || '-'}</span>
                  <span>{item.quantity}</span>
                  <span>{item.isReserve ? 'Резервный' : 'Постоянный'}</span>
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
}: {
  item: OzonStock
  priceValue: string
  onPriceChange: (value: string) => void
  onSave: () => void
}) {
  return (
    <div className="table-row stock-row">
      <span data-label="Товар">
        <strong>{item.name}</strong>
        {item.productUrl && (
          <a href={item.productUrl} target="_blank" rel="noreferrer">
            Открыть Ozon
          </a>
        )}
      </span>
      <span data-label="Артикул">{item.offerId}</span>
      <span data-label="FBO">{item.fboPresent}</span>
      <span data-label="FBS">{item.fbsPresent}</span>
      <span className="stock-price-cell" data-label="Цена">
        <input value={priceValue} onChange={(event) => onPriceChange(event.target.value)} />
        <small>{item.currencyCode}</small>
      </span>
      <span className="stock-save-cell" data-label="Действие">
        <button type="button" onClick={onSave}>
          Сохранить
        </button>
      </span>
    </div>
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

function formatMoney(value: number, currency: string) {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: currency || 'KZT',
    maximumFractionDigits: 2,
  }).format(value)
}

function translateStatus(status: string) {
  const statuses: Record<string, string> = {
    awaiting_deliver: 'Собирается',
    delivering: 'Едет',
    delivered: 'Доставлен',
    cancelled: 'Отменен',
  }

  return statuses[status] ?? status
}

function translateProductionTaskStatus(status: ProductionTask['status']) {
  const statuses: Record<ProductionTask['status'], string> = {
    New: 'Новая',
    InProgress: 'В работе',
    Deferred: 'Отложена',
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

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default App
