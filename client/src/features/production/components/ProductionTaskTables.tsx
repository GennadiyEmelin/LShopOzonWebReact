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
import { PathCopyBlock } from '../../../shared/components/PathCopyBlock'
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
  isAdmin,
  canCancelTasks = false,
  onStart,
  onCancelRequest,
  onComplete,
  onOpenFiles,
  onUploadTaskItemFile,
  onSaveTaskItemFilePath,
  onDeleteFile,
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
  isAdmin?: boolean
  canCancelTasks?: boolean
  onStart: (id: string) => void
  onCancelRequest: (id: string) => void
  onComplete: (id: string) => void
  onOpenFiles: (productName: string, files: ProductionFile[]) => void
  onUploadTaskItemFile?: (item: ProductionTaskItem, file: File) => void
  onSaveTaskItemFilePath?: (taskId: string, item: ProductionTaskItem, path: string) => void | Promise<void>
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
                    />
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

function TaskItemPathCell({ paths }: { paths: ProductionFilePath[] }) {
  return (
    <span className="task-item-path-cell">
      <TaskItemPathsButtons paths={paths} />
    </span>
  )
}

function TaskItemPathPanel({
  item,
  itemPaths,
  canEdit,
  onSavePath,
}: {
  item: ProductionTaskItem
  itemPaths: ProductionFilePath[]
  canEdit: boolean
  onSavePath?: (path: string) => void | Promise<void>
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
        <div className="task-item-paths-buttons">
          {itemPaths.map((entry) => (
            <PathCopyBlock key={entry.id} path={entry.path} />
          ))}
        </div>
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
  onDeleteFile,
  onArchive,
  onDelete,
  archiveView = false,
  emptyText = 'В архиве задач пока нет.',
}: {
  tasks: ProductionTask[]
  products: ProductionTaskTableProduct[]
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