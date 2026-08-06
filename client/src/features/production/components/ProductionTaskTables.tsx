import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import type {
  ProductionFile,
  ProductionFilePath,
  ProductionTask,
  ProductionTaskItem,
} from '../../../domain/types/production'
import { stripNovinkaMarketplaceNote } from '../../../shopRegion'
import { LinkHoverPreview } from '../../../shared/components/LinkPreview'
import { OfferIdCell } from '../../../shared/components/OfferIdCell'
import { ProductImageHoverPreview, ProductThumb } from '../../../shared/components/ProductMedia'
import { formatDateTime } from '../../../shared/utils/formatters'
import {
  getProductionFilesForTaskItem,
  getProductionPathsForTaskItem,
} from '../lib/catalogUtils'
import { getProductionTaskTypeLabel } from '../lib/taskDisplayUtils'
import {
  getProductionTaskActualTotal,
  getProductionTaskItems,
  getProductionTaskRequiredTotal,
  getProductionTaskSummary,
  getProductionTaskTableLabels,
  getProductionTaskTableMode,
  getTaskItemActualInputValue,
  isNovinkaTask,
  translateProductionTaskStatus,
} from '../lib/taskUtils'
import { NovinkaExternalLinkButton } from './NovinkaExternalLinkButton'

export type ProductionTaskTableProduct = {
  productId: number
  imageUrl?: string
  name?: string
}
function renderNovinkaItemLink(item: ProductionTaskItem) {
  const productLink = stripNovinkaMarketplaceNote(item.productLink)

  if (!productLink) {
    return '—'
  }

  return <NovinkaExternalLinkButton url={productLink} />
}

function ProductionItemSummaryHint({ item }: { item: ProductionTaskItem }) {
  const summary = item.productionSummary
  if (
    !summary ||
    (summary.createdQuantity <= 0 && summary.inProgressQuantity <= 0 && summary.completedQuantity <= 0)
  ) {
    return null
  }

  const parts = [
    summary.inProgressQuantity > 0 ? `в работе ${summary.inProgressQuantity} шт.` : '',
    summary.createdQuantity > 0 ? `в созданных ${summary.createdQuantity} шт.` : '',
    summary.completedQuantity > 0 ? `в выполненных ${summary.completedQuantity} шт.` : '',
  ].filter(Boolean)

  if (parts.length === 0) {
    return null
  }

  return (
    <small className="production-item-summary-hint">
      Уже в производстве: {parts.join(' · ')}
    </small>
  )
}

function getPreviewFiles(files: ProductionFile[]) {
  return files.filter((file) => file.contentType.startsWith('image/'))
}

function normalizeUserName(value?: string | null) {
  return (value ?? '').trim().toLowerCase()
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
  onOpenFiles,
  onUploadTaskItemFile,
  canUpload,
}: {
  item: ProductionTaskItem
  itemFiles: ProductionFile[]
  onOpenFiles?: (productName: string, files: ProductionFile[]) => void
  onUploadTaskItemFile?: (item: ProductionTaskItem, file: File, taskType?: ProductionTask['taskType']) => void
  canUpload: boolean
}) {
  const uploadInputId = `task-item-upload-${item.id}`
  const previewFiles = getPreviewFiles(itemFiles)

  return (
    <span className="task-item-files">
      {previewFiles.length === 0 && !canUpload && '—'}
      {(previewFiles.length > 0 || canUpload) && (
        <div className="task-item-files-actions">
          {previewFiles.length > 0 && onOpenFiles && (
            <button
              type="button"
              className="production-files-trigger"
              onClick={() => onOpenFiles(item.productName, previewFiles)}
            >
              Превью ({previewFiles.length})
            </button>
          )}
          {canUpload && onUploadTaskItemFile && (
            <>
              <input
                id={uploadInputId}
                type="file"
                accept="image/*"
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
                {previewFiles.length > 0 ? 'Обновить превью' : 'Загрузить превью'}
              </button>
            </>
          )}
        </div>
      )}
    </span>
  )
}

export function ProductionFilesModal({
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
          <h3>Превью товара</h3>
          <button type="button" onClick={onClose}>
            Закрыть
          </button>
        </div>
        <p className="production-files-modal-product">{productName}</p>
        <div className="data-table modal-table">
          <div className="table-row file-row table-head">
              <span>Превью</span>
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
              <strong>Для этого товара еще нет превью.</strong>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
export function ProductionTaskTable({
  tasks,
  tableContext = 'ozon',
  products,
  productionFiles,
  productionFilePaths = [],
  token,
  actualQuantities,
  setActualQuantities,
  currentUserId,
  currentUserName,
  currentUserAliases = [],
  isAdmin,
  canCancelTasks = false,
  canManageTaskDeadline = false,
  canStartTask,
  onStart,
  onCancelRequest,
  onComplete,
  onOpenFiles,
  onUploadTaskItemFile,
  onSaveTaskItemFilePath,
  onDeleteTaskItemFilePath,
  onSaveTaskItemActualQuantity,
  onSaveTaskItemRequiredQuantity,
  onCreateProductionFromNovinkaItem,
  onTransferNovinkaItem,
  onDelete,
  onArchive,
  onRestore,
  onEdit,
  completed = false,
  cancelled = false,
}: {
  tasks: ProductionTask[]
  products: ProductionTaskTableProduct[]
  productionFiles: ProductionFile[]
  productionFilePaths?: ProductionFilePath[]
  token: string
  actualQuantities: Record<string, string>
  setActualQuantities: Dispatch<SetStateAction<Record<string, string>>>
  currentUserId?: string
  currentUserName?: string
  currentUserAliases?: string[]
  isAdmin?: boolean
  canCancelTasks?: boolean
  canManageTaskDeadline?: boolean
  canStartTask?: (task: ProductionTask) => boolean
  onStart: (id: string) => void
  onCancelRequest: (id: string) => void
  onComplete: (id: string) => void
  onOpenFiles: (productName: string, files: ProductionFile[]) => void
  onUploadTaskItemFile?: (
    item: ProductionTaskItem,
    file: File,
    taskType?: ProductionTask['taskType'],
  ) => void
  onSaveTaskItemFilePath?: (taskId: string, item: ProductionTaskItem, path: string) => void | Promise<void>
  onDeleteTaskItemFilePath?: (taskId: string, item: ProductionTaskItem) => void | Promise<void>
  onSaveTaskItemActualQuantity?: (
    taskId: string,
    item: ProductionTaskItem,
    actualQuantity: number,
  ) => void | Promise<void>
  onSaveTaskItemRequiredQuantity?: (
    taskId: string,
    item: ProductionTaskItem,
    requiredQuantity: number,
  ) => void | Promise<void>
  onCreateProductionFromNovinkaItem?: (task: ProductionTask, item: ProductionTaskItem) => void
  onTransferNovinkaItem?: (task: ProductionTask, item: ProductionTaskItem) => void
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
        const isOverdue =
          canManageTaskDeadline &&
          Boolean(task.dueAt) &&
          (task.status === 'New' || task.status === 'InProgress') &&
          Date.now() > new Date(task.dueAt as string).getTime()
        const isCreator = Boolean(currentUserId && task.createdByUserId === currentUserId)
        const assignedUserName = normalizeUserName(task.assignedUserName)
        const currentUserNames = [currentUserName, ...currentUserAliases]
          .map(normalizeUserName)
          .filter(Boolean)
        const isAssignedToCurrent = Boolean(
          assignedUserName && currentUserNames.some((name) => name === assignedUserName),
        )
        const hasMinimumViolations =
          !novinka &&
          task.status === 'InProgress' &&
          !completed &&
          !cancelled &&
          taskItems.some((item) => {
            if (!item.enforceMinimumQuantity) {
              return false
            }
            const actualValue = getTaskItemActualInputValue(item, actualQuantities)
            const actualNumber = Number(actualValue)
            return actualValue !== '' && Number.isFinite(actualNumber) && actualNumber < item.requiredQuantity
          })
        const hasMissingActuals =
          !novinka &&
          task.status === 'InProgress' &&
          !completed &&
          !cancelled &&
          taskItems.some((item) => {
            const value = getTaskItemActualInputValue(item, actualQuantities)
            const actualNumber = Number(value)
            return value === '' || !Number.isFinite(actualNumber) || actualNumber < 0
          })
        const hasMissingNovinkaFiles =
          novinka &&
          task.status === 'InProgress' &&
          !completed &&
          !cancelled &&
          taskItems.some((item) => getPreviewFiles(getProductionFilesForTaskItem(item, productionFiles)).length === 0)
        const hasMissingNovinkaPaths =
          novinka &&
          task.status === 'InProgress' &&
          !completed &&
          !cancelled &&
          taskItems.some(
            (item) =>
              !item.filePath?.trim() &&
              getProductionPathsForTaskItem(item, productionFilePaths).length === 0,
          )
        const hasMissingNovinkaRequirements = hasMissingNovinkaFiles || hasMissingNovinkaPaths

        return (
        <details
          className={`task-details-row ${task.isUrgent ? 'task-urgent' : ''} ${isStaleNew ? 'task-stale-new' : ''} ${isOverdue ? 'task-overdue' : ''} ${novinka && task.status === 'InProgress' ? 'task-novinka' : ''} ${novinka ? 'task-details-novinka' : ''}`}
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
              {canManageTaskDeadline && task.dueAt ? ` · До: ${formatDateTime(task.dueAt)}` : ''}
              {isOverdue ? ' · Просрочена' : ''}
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
                : '—'
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
            {!completed && !cancelled && task.status === 'New' && (canStartTask ? canStartTask(task) : true) && (
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
                className={hasMinimumViolations || hasMissingNovinkaRequirements || hasMissingActuals ? 'task-complete-blocked' : ''}
                title={
                  hasMissingNovinkaFiles
                    ? 'Добавьте превью по каждому товару'
                    : hasMissingNovinkaPaths
                      ? 'Укажите путь к файлу по каждому товару'
                    : hasMissingActuals
                      ? 'Сохраните фактическое количество по каждому товару'
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
          <div className={`task-items-table ${novinka ? 'task-items-table-novinka task-items-table-novinka-actions' : ''}`}>
            <div className="table-row task-item-table-row table-head">
              <span>Товар</span>
              {!novinka && <span>Артикул</span>}
              {novinka ? (
                <>
                  <span>Ссылка</span>
                  <span>Количество</span>
                  <span>Превью</span>
                  <span>Путь к файлу</span>
                  <span>Действия</span>
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
              const actualValue = getTaskItemActualInputValue(item, actualQuantities)
              const actualNumber = Number(actualValue)
              const isSaved =
                item.actualQuantity != null &&
                actualValue !== '' &&
                Number.isFinite(actualNumber) &&
                actualNumber === item.actualQuantity
              const itemFiles = getProductionFilesForTaskItem(item, productionFiles)
              const itemPreviewFiles = getPreviewFiles(itemFiles)
              const itemPaths = getProductionPathsForTaskItem(item, productionFilePaths)
              const hasSavedItemPath = Boolean(item.filePath?.trim() || itemPaths.length > 0)
              const canSendNovinkaItemToProduction = Boolean(
                novinka &&
                task.status === 'InProgress' &&
                !completed &&
                !cancelled &&
                onCreateProductionFromNovinkaItem &&
                itemPreviewFiles.length > 0 &&
                hasSavedItemPath,
              )
              const canTransferNovinkaItem = Boolean(
                novinka &&
                task.status === 'InProgress' &&
                !completed &&
                !cancelled &&
                isAssignedToCurrent &&
                onTransferNovinkaItem,
              )
              const isBelowMinimum = Boolean(
                !novinka &&
                !completed &&
                !cancelled &&
                task.status === 'InProgress' &&
                item.enforceMinimumQuantity &&
                actualValue !== '' &&
                Number.isFinite(actualNumber) &&
                actualNumber < item.requiredQuantity,
              )

              return (
              <div className={`table-row task-item-table-row ${isBelowMinimum ? 'task-item-below-minimum' : ''}`} key={item.id}>
                <span className="product-mini task-product-mini" data-label="Товар">
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
                {!novinka && (
                  <span data-label="Артикул">
                    <OfferIdCell offerId={item.offerId} />
                  </span>
                )}
                {novinka ? (
                  <>
                    <span>{renderNovinkaItemLink(item)}</span>
                    <span data-label="Количество">
                      {task.status === 'InProgress' && !completed && !cancelled && onSaveTaskItemRequiredQuantity ? (
                        <TaskItemRequiredPanel
                          item={item}
                          onSave={(requiredQuantity) =>
                            onSaveTaskItemRequiredQuantity(task.id, item, requiredQuantity)
                          }
                        />
                      ) : (
                        item.requiredQuantity
                      )}
                    </span>
                  <TaskItemFilesPanel
                      item={item}
                      itemFiles={itemPreviewFiles}
                      onOpenFiles={onOpenFiles}
                      onUploadTaskItemFile={
                        onUploadTaskItemFile
                          ? (uploadItem, file) => onUploadTaskItemFile(uploadItem, file, task.taskType)
                          : undefined
                      }
                      canUpload={!completed && !cancelled && task.status === 'InProgress'}
                    />
                    <TaskItemPathPanel
                      item={item}
                      itemPaths={itemPaths}
                      canEdit={
                        !completed &&
                        !cancelled &&
                        task.status === 'InProgress' &&
                        Boolean(onSaveTaskItemFilePath)
                      }
                      onSavePath={
                        onSaveTaskItemFilePath
                          ? (path) => onSaveTaskItemFilePath(task.id, item, path)
                          : undefined
                      }
                      onDeletePath={
                        onDeleteTaskItemFilePath
                          ? () => onDeleteTaskItemFilePath(task.id, item)
                          : undefined
                      }
                    />
                    <span className="task-item-actions-cell task-item-actions-stack">
                      {canSendNovinkaItemToProduction && (
                          <button
                            type="button"
                            className="task-create-production-button"
                            onClick={() => onCreateProductionFromNovinkaItem?.(task, item)}
                          >
                            В производство
                          </button>
                        )}
                      {canTransferNovinkaItem && (
                          <button
                            type="button"
                            className="task-transfer-item-button"
                            onClick={() => onTransferNovinkaItem?.(task, item)}
                          >
                            Передать
                          </button>
                        )}
                      {!canSendNovinkaItemToProduction && !canTransferNovinkaItem && (
                          <small className="task-item-readiness-hint">Нужны путь и превью</small>
                        )}
                      <ProductionItemSummaryHint item={item} />
                    </span>
                  </>
                ) : (
                  <>
                    <span data-label="План">
                      {task.status === 'InProgress' && !completed && !cancelled && onSaveTaskItemRequiredQuantity ? (
                        <TaskItemRequiredPanel
                          item={item}
                          onSave={(requiredQuantity) =>
                            onSaveTaskItemRequiredQuantity(task.id, item, requiredQuantity)
                          }
                        />
                      ) : (
                        item.requiredQuantity
                      )}
                    </span>
                    <span className="task-item-fact-cell" data-label="Факт">
                      {completed ? (
                        item.actualQuantity ?? 0
                      ) : task.status === 'InProgress' ? (
                        <TaskItemActualPanel
                          item={item}
                          actualValue={actualValue}
                          isBelowMinimum={isBelowMinimum}
                          isSaved={isSaved}
                          canSave={Boolean(onSaveTaskItemActualQuantity)}
                          onValueChange={(value) =>
                            setActualQuantities((current) => ({
                              ...current,
                              [item.id]: value,
                            }))
                          }
                          onSave={
                            onSaveTaskItemActualQuantity
                              ? (actualQuantity) => onSaveTaskItemActualQuantity(task.id, item, actualQuantity)
                              : undefined
                          }
                        />
                      ) : (
                        '—'
                      )}
                    </span>
                    <span data-label="Файлы">
                    <TaskItemFilesAndPathsCell
                      item={item}
                      itemFiles={itemFiles}
                      itemPaths={itemPaths}
                      onOpenFiles={onOpenFiles}
                    />
                    </span>
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
function getTaskItemImageUrl(item: ProductionTaskItem, products: ProductionTaskTableProduct[]) {
  return products.find((product) => product.productId === item.ozonProductId)?.imageUrl
}

export function ProductionFileThumb({
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
  products: ProductionTaskTableProduct[]
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
function TaskItemPathsButtons({
  paths,
  onDeletePath,
}: {
  paths: ProductionFilePath[]
  onDeletePath?: () => void | Promise<void>
}) {
  const [openedPath, setOpenedPath] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [deleting, setDeleting] = useState(false)

  function copyPath(path: string) {
    void navigator.clipboard.writeText(path).then(() => {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    })
  }

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
        <button
          key={entry.id}
          type="button"
          className="production-files-trigger task-item-path-trigger"
          onClick={() => {
            setOpenedPath(entry.path)
            setCopied(false)
          }}
        >
          Путь
        </button>
      ))}
      {openedPath && (
        <div className="modal-backdrop" role="presentation" onClick={() => setOpenedPath(null)}>
          <div
            className="modal-card production-path-modal"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-title-row">
              <h3>Путь к файлу</h3>
              <button type="button" onClick={() => setOpenedPath(null)}>
                Закрыть
              </button>
            </div>
            <div className="production-path-modal-body">
              <span>Путь</span>
              <code>{openedPath}</code>
            </div>
            <div className="production-path-modal-actions">
              {onDeletePath && (
                <button
                  type="button"
                  className="danger"
                  disabled={deleting}
                  onClick={async () => {
                    setDeleting(true)
                    try {
                      await onDeletePath()
                      setOpenedPath(null)
                    } finally {
                      setDeleting(false)
                    }
                  }}
                >
                  {deleting ? 'Удаление…' : 'Удалить путь'}
                </button>
              )}
              <button type="button" onClick={() => copyPath(openedPath)}>
                {copied ? 'Скопировано' : 'Скопировать путь'}
              </button>
            </div>
          </div>
        </div>
      )}
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
          Превью ({itemFiles.length})
        </button>
      ) : null}
      <TaskItemPathsButtons paths={itemPaths} />
    </span>
  )
}

function TaskItemPathCell({ paths }: { paths: ProductionFilePath[] }) {
  return (
    <span className="task-item-path-cell">
      <TaskItemPathsButtons paths={paths} />
    </span>
  )
}

function TaskItemRequiredPanel({
  item,
  onSave,
}: {
  item: ProductionTaskItem
  onSave: (requiredQuantity: number) => void | Promise<void>
}) {
  const [value, setValue] = useState(String(item.requiredQuantity))
  const [saving, setSaving] = useState(false)
  const requiredNumber = Number(value)
  const canSubmit =
    value !== '' &&
    Number.isFinite(requiredNumber) &&
    requiredNumber > 0 &&
    requiredNumber !== item.requiredQuantity

  useEffect(() => {
    setValue(String(item.requiredQuantity))
  }, [item.requiredQuantity])

  async function handleSave() {
    if (!canSubmit) {
      return
    }

    setSaving(true)
    try {
      await onSave(requiredNumber)
    } finally {
      setSaving(false)
    }
  }

  return (
    <span className="task-required-editor">
      <input
        type="number"
        min="1"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      <button type="button" disabled={!canSubmit || saving} onClick={() => void handleSave()}>
        {saving ? '...' : 'Сохранить'}
      </button>
    </span>
  )
}

function TaskItemActualPanel({
  item,
  actualValue,
  isBelowMinimum,
  isSaved,
  canSave,
  onValueChange,
  onSave,
}: {
  item: ProductionTaskItem
  actualValue: string
  isBelowMinimum: boolean
  isSaved: boolean
  canSave: boolean
  onValueChange: (value: string) => void
  onSave?: (actualQuantity: number) => void | Promise<void>
}) {
  const [saving, setSaving] = useState(false)
  const actualNumber = Number(actualValue)
  const canSubmit =
    canSave &&
    actualValue !== '' &&
    Number.isFinite(actualNumber) &&
    actualNumber >= 0 &&
    !isSaved

  async function handleSave() {
    if (!canSubmit || !onSave) {
      return
    }

    setSaving(true)
    try {
      await onSave(actualNumber)
    } finally {
      setSaving(false)
    }
  }

  return (
    <span className="task-actual-input-wrap">
      <div className="task-item-actual-editor">
        <input
          className={isBelowMinimum ? 'task-quantity-invalid' : ''}
          data-actual-input=""
          type="number"
          min={item.enforceMinimumQuantity ? item.requiredQuantity : 0}
          placeholder={item.enforceMinimumQuantity ? `от ${item.requiredQuantity}` : 'Факт'}
          value={actualValue}
          onChange={(event) => onValueChange(event.target.value)}
        />
        {canSave && (
          <button
            type="button"
            className={`task-item-actual-save-btn ${isSaved ? 'saved' : ''}`}
            disabled={!canSubmit || saving}
            onClick={() => void handleSave()}
          >
            {saving ? '...' : isSaved ? 'Сохранено' : 'Сохранить'}
          </button>
        )}
      </div>
      {isBelowMinimum && (
        <small className="task-minimum-error">Нельзя меньше {item.requiredQuantity}</small>
      )}
      {item.enforceMinimumQuantity && actualValue === '' && (
        <small className="task-minimum-hint">Минимум: {item.requiredQuantity}</small>
      )}
    </span>
  )
}

function TaskItemPathPanel({
  item,
  itemPaths,
  canEdit,
  onSavePath,
  onDeletePath,
}: {
  item: ProductionTaskItem
  itemPaths: ProductionFilePath[]
  canEdit: boolean
  onSavePath?: (path: string) => void | Promise<void>
  onDeletePath?: () => void | Promise<void>
}) {
  const [draftPath, setDraftPath] = useState(item.filePath?.trim() ?? '')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setDraftPath(item.filePath?.trim() ?? '')
  }, [item.filePath])

  if (!canEdit) {
    return <TaskItemPathCell paths={itemPaths} />
  }

  async function handleSave() {
    const trimmedPath = draftPath.trim()
    if (trimmedPath.length < 3 || !onSavePath) {
      return
    }

    setSaving(true)
    try {
      await onSavePath(trimmedPath)
    } finally {
      setSaving(false)
    }
  }

  return (
    <span className="task-item-path-cell">
      {itemPaths.length > 0 && (
        <TaskItemPathsButtons paths={itemPaths} onDeletePath={onDeletePath} />
      )}
      <div className="task-item-path-editor">
        <input
          type="text"
          className="task-item-path-input"
          placeholder="C:\путь\к\файлу"
          value={draftPath}
          disabled={saving}
          onChange={(event) => setDraftPath(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              void handleSave()
            }
          }}
        />
        <button
          type="button"
          className="task-item-path-save-btn"
          disabled={saving || draftPath.trim().length < 3}
          onClick={() => void handleSave()}
        >
          {saving ? 'Сохранение…' : item.filePath?.trim() ? 'Обновить' : 'Сохранить'}
        </button>
      </div>
    </span>
  )
}
export function ProductionTaskArchiveTable({
  tasks,
  tableContext = 'mixed',
  products,
  productionFiles = [],
  productionFilePaths = [],
  token = '',
  onOpenFiles,
  onArchive,
  onDelete,
  onCreateProductionFromNovinka,
  onPackItem,
  archiveView = false,
  emptyText = 'В архиве задач пока нет.',
}: {
  tasks: ProductionTask[]
  products: ProductionTaskTableProduct[]
  productionFiles?: ProductionFile[]
  productionFilePaths?: ProductionFilePath[]
  token?: string
  onOpenFiles?: (productName: string, files: ProductionFile[]) => void
  onArchive?: (id: string) => void
  onDelete?: (id: string) => void
  onCreateProductionFromNovinka?: (task: ProductionTask) => void
  onPackItem?: (task: ProductionTask, item: ProductionTaskItem) => void
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
                : '—'
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
            {!archiveView && novinka && task.status === 'Completed' && onCreateProductionFromNovinka && (
              <button type="button" className="task-create-production-button" onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                onCreateProductionFromNovinka(task)
              }}>
                В производство
              </button>
            )}
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
          <div className={`task-items-table ${novinka ? 'task-items-table-novinka' : onPackItem && !archiveView ? 'task-items-table-pack-actions' : ''}`}>
            <div className="table-row task-item-table-row table-head">
              <span>Товар</span>
              {!novinka && <span>Артикул</span>}
              {novinka ? (
                <>
                  <span>Ссылка</span>
                  <span>Превью</span>
                  <span>Путь к файлу</span>
                </>
              ) : (
                <>
                  <span>План</span>
                  <span>Факт</span>
                  {onPackItem && !archiveView && <span>Действия</span>}
                </>
              )}
            </div>
            {taskItems.map((item) => {
              const itemFiles = getProductionFilesForTaskItem(item, productionFiles)
              const itemPreviewFiles = getPreviewFiles(itemFiles)
              const itemPaths = getProductionPathsForTaskItem(item, productionFilePaths)

              return (
              <div className="table-row task-item-table-row" key={item.id}>
                <span className="product-mini task-product-mini" data-label="Товар">
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
                {!novinka && (
                  <span data-label="Артикул">
                    <OfferIdCell offerId={item.offerId} />
                  </span>
                )}
                {novinka ? (
                  <>
                    <span>{renderNovinkaItemLink(item)}</span>
                    <TaskItemFilesPanel
                      item={item}
                      itemFiles={itemPreviewFiles}
                      onOpenFiles={onOpenFiles}
                      canUpload={false}
                    />
                    <TaskItemPathCell paths={itemPaths} />
                  </>
                ) : (
                  <>
                    <span data-label="План">{item.requiredQuantity}</span>
                    <span data-label="Факт">{item.actualQuantity ?? 0}</span>
                    {onPackItem && !archiveView && (
                      <span className="task-item-actions-cell" data-label="Действия">
                        {item.packedAt ? (
                          <small className="task-item-packed-hint">
                            Упаковано{item.packedByDisplayName ? ` · ${item.packedByDisplayName}` : ''}
                          </small>
                        ) : (
                          <button
                            type="button"
                            className="task-pack-item-button"
                            onClick={() => onPackItem(task, item)}
                          >
                            Упаковать
                          </button>
                        )}
                      </span>
                    )}
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
