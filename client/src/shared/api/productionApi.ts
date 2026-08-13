import { apiFetch } from './client'
import type {
  ProductionAnalyticsAssignee,
  ProductionAnalyticsReport,
  ProductionFile,
  ProductionFilePath,
  ProductionTask,
  ProductionTaskStatus,
} from '../../domain/types/production'

export async function fetchProductionTasks(token: string) {
  return apiFetch('/api/production/tasks', token)
}

export async function fetchProductionDesigners(token: string) {
  return apiFetch('/api/production/designers', token)
}

export async function saveProductionTask(
  token: string,
  taskId: string | null,
  body: unknown,
) {
  return apiFetch(taskId ? `/api/production/tasks/${taskId}` : '/api/production/tasks', token, {
    method: taskId ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function startProductionTask(token: string, id: string) {
  return apiFetch(`/api/production/tasks/${id}/start`, token, { method: 'PUT' })
}

export async function cancelProductionTask(token: string, id: string, comment: string) {
  return apiFetch(`/api/production/tasks/${id}/cancel`, token, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ comment }),
  })
}

export async function completeProductionTask(token: string, id: string, body: unknown) {
  return apiFetch(`/api/production/tasks/${id}/complete`, token, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function archiveProductionTask(token: string, id: string) {
  return apiFetch(`/api/production/tasks/${id}/archive`, token, { method: 'PUT' })
}

export async function restoreProductionTask(token: string, id: string, status: ProductionTaskStatus = 'New') {
  return apiFetch(`/api/production/tasks/${id}/restore`, token, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  })
}

export async function deleteProductionTask(token: string, id: string) {
  return apiFetch(`/api/production/tasks/${id}`, token, { method: 'DELETE' })
}

export async function exportProductionArchive(token: string) {
  return apiFetch('/api/production/tasks/archive/export', token)
}

export async function fetchProductionFiles(token: string, search = '') {
  const params = new URLSearchParams()
  if (search.trim()) {
    params.set('search', search.trim())
  }

  const query = params.toString()
  const suffix = query ? `?${query}` : ''
  return Promise.all([
    apiFetch(`/api/production/files${suffix}`, token),
    apiFetch(`/api/production/file-paths${suffix}`, token),
  ])
}

export async function uploadProductionFile(token: string, formData: FormData) {
  return apiFetch('/api/production/files', token, {
    method: 'POST',
    body: formData,
  })
}

export async function downloadProductionFile(token: string, id: string) {
  return apiFetch(`/api/production/files/${id}/download`, token)
}

export async function deleteProductionFile(token: string, id: string) {
  return apiFetch(`/api/production/files/${id}`, token, { method: 'DELETE' })
}

export async function saveProductionCatalogFilePath(token: string, body: unknown) {
  return apiFetch('/api/production/catalog/file-path', token, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function deleteProductionCatalogFilePath(token: string, pathId: string) {
  return apiFetch(`/api/production/catalog/file-path/${pathId}`, token, { method: 'DELETE' })
}

export async function saveProductionTaskItemFilePath(
  token: string,
  taskId: string,
  itemId: string,
  path: string,
) {
  return apiFetch(`/api/production/tasks/${taskId}/items/${itemId}/file-path`, token, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  })
}

export async function deleteProductionTaskItemFilePath(token: string, taskId: string, itemId: string) {
  return apiFetch(`/api/production/tasks/${taskId}/items/${itemId}/file-path`, token, { method: 'DELETE' })
}

export async function saveProductionTaskItemActualQuantity(
  token: string,
  taskId: string,
  itemId: string,
  actualQuantity: number,
) {
  return apiFetch(`/api/production/tasks/${taskId}/items/${itemId}/actual-quantity`, token, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actualQuantity }),
  })
}

export async function packProductionTaskItem(token: string, taskId: string, itemId: string) {
  return apiFetch(`/api/production/tasks/${taskId}/items/${itemId}/pack`, token, { method: 'PUT' })
}

export async function takeDesignerTaskItem(token: string, taskId: string, itemId: string) {
  return apiFetch(`/api/production/tasks/${taskId}/items/${itemId}/take-designer`, token, { method: 'PUT' })
}

export async function transferDesignerTaskItem(
  token: string,
  taskId: string,
  itemId: string,
  targetUserId: string,
) {
  return apiFetch(`/api/production/tasks/${taskId}/items/${itemId}/transfer-designer`, token, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetUserId }),
  })
}

export async function saveProductionTaskItemRequiredQuantity(
  token: string,
  taskId: string,
  itemId: string,
  requiredQuantity: number,
) {
  return apiFetch(`/api/production/tasks/${taskId}/items/${itemId}/quantity`, token, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requiredQuantity }),
  })
}

export async function convertNovinkaCatalogToOzon(token: string, body: unknown) {
  return apiFetch('/api/production/catalog/convert-to-ozon', token, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function fetchProductionAnalyticsAssignees(token: string) {
  return apiFetch('/api/production/analytics/assignees', token)
}

export async function fetchProductionAnalyticsReport(token: string, params: URLSearchParams) {
  return apiFetch(`/api/production/analytics/report?${params.toString()}`, token)
}

export async function exportProductionAnalytics(token: string, params: URLSearchParams) {
  return apiFetch(`/api/production/analytics/export?${params.toString()}`, token)
}

export async function updateProductionAnalyticsRecord(token: string, taskId: string, body: unknown) {
  return apiFetch(`/api/production/analytics/records/${taskId}`, token, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function parseProductionTasks(response: Response): Promise<ProductionTask[]> {
  return response.json() as Promise<ProductionTask[]>
}

export async function parseProductionFiles(response: Response): Promise<ProductionFile[]> {
  return response.json() as Promise<ProductionFile[]>
}

export async function parseProductionFilePaths(response: Response): Promise<ProductionFilePath[]> {
  return response.json() as Promise<ProductionFilePath[]>
}

export async function parseProductionAnalyticsAssignees(response: Response): Promise<ProductionAnalyticsAssignee[]> {
  return response.json() as Promise<ProductionAnalyticsAssignee[]>
}

export async function parseProductionAnalyticsReport(response: Response): Promise<ProductionAnalyticsReport> {
  return response.json() as Promise<ProductionAnalyticsReport>
}

export async function fetchProductionFilePreviewBlob(token: string, fileId: string) {
  return apiFetch(`/api/production/files/${fileId}/download`, token)
}
