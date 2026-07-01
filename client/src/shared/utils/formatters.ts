export function formatInputDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function formatMoney(value: number, currency: string) {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: currency || 'KZT',
    maximumFractionDigits: 2,
  }).format(value)
}

export function formatLossMoney(value: number, currency: string) {
  return formatMoney(-Math.abs(value), currency || 'KZT')
}

export function formatAnalyticsDate(value: string) {
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

export function formatFileSize(value: number) {
  if (value < 1024) {
    return `${value} Б`
  }

  const kb = value / 1024
  if (kb < 1024) {
    return `${kb.toFixed(1)} КБ`
  }

  return `${(kb / 1024).toFixed(1)} МБ`
}

export function formatDateTime(value: string) {
  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function calculateDaysSinceSupplyDate(supplyDate?: string | null) {
  if (!supplyDate?.trim()) {
    return null
  }

  const supplyKey = supplyDate.trim().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(supplyKey)) {
    return null
  }

  const todayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(new Date())
  const [supplyYear, supplyMonth, supplyDay] = supplyKey.split('-').map(Number)
  const [todayYear, todayMonth, todayDay] = todayKey.split('-').map(Number)
  const supplyUtc = Date.UTC(supplyYear, supplyMonth - 1, supplyDay)
  const todayUtc = Date.UTC(todayYear, todayMonth - 1, todayDay)

  return Math.max(0, Math.round((todayUtc - supplyUtc) / 86_400_000))
}

export function formatDaysWithoutSales(value?: number | null, supplyDate?: string | null) {
  const days = value ?? calculateDaysSinceSupplyDate(supplyDate)
  if (days === null || days === undefined) {
    return '-'
  }

  return `${days} дн.`
}

export function formatOzonCreatedAt(value?: string) {
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
