import type {
  ProductionAnalyticsSummaryRow,
  ProductionFilePath,
  ProductionTask,
} from '../../../domain/types/production'
import { stripNovinkaMarketplaceNote } from '../../../shopRegion'
import { OfferIdCell } from '../../../shared/components/OfferIdCell'
import { PathCopyBlock } from '../../../shared/components/PathCopyBlock'
import { UserAvatarPreview } from '../../../shared/components/UserAvatarPreview'
import { getRoleLabel } from '../../../shared/constants/appRoles'
import { formatDateTime } from '../../../shared/utils/formatters'
import { getProductionPathsForTaskItem } from '../lib/catalogUtils'
import { getProductionTaskTypeLabel } from '../lib/taskDisplayUtils'
import { getProductionTaskItems, isNovinkaTask } from '../lib/taskUtils'
import { NovinkaExternalLinkButton } from './NovinkaExternalLinkButton'

export function ProductionAnalyticsUserDetailModal({
  userName,
  summaryRow,
  tasks,
  productionFilePaths = [],
  isAdmin,
  onClose,
  onExportExcel,
  onEditTask,
}: {
  userName: string
  summaryRow: ProductionAnalyticsSummaryRow | null
  tasks: ProductionTask[]
  productionFilePaths?: ProductionFilePath[]
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
          {tasks.map((task) => {
            const novinka = isNovinkaTask(task)
            const taskItems = getProductionTaskItems(task)

            return (
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
                <div
                  className={`table-row production-analytics-detail-item-row table-head${novinka ? ' production-analytics-detail-item-row-novinka' : ''}`}
                >
                  <span>Товар</span>
                  <span>Артикул</span>
                  {novinka ? (
                    <>
                      <span>Путь</span>
                      <span>Ссылка</span>
                    </>
                  ) : (
                    <>
                      <span>Ссылка</span>
                      <span>План</span>
                      <span>Факт</span>
                    </>
                  )}
                </div>
                {taskItems.map((item) => {
                  const itemPaths = getProductionPathsForTaskItem(item, productionFilePaths)
                  const productLink = stripNovinkaMarketplaceNote(item.productLink)

                  return (
                  <div
                    className={`table-row production-analytics-detail-item-row${novinka ? ' production-analytics-detail-item-row-novinka' : ''}`}
                    key={item.id ?? item.offerId}
                  >
                    <span>{item.productName}</span>
                    <OfferIdCell offerId={item.offerId} />
                    {novinka ? (
                      <>
                        <span className="production-analytics-detail-item-actions">
                          {itemPaths.length > 0 ? (
                            itemPaths.map((entry) => <PathCopyBlock key={entry.id} path={entry.path} />)
                          ) : (
                            '—'
                          )}
                        </span>
                        <span className="production-analytics-detail-item-actions">
                          {productLink ? <NovinkaExternalLinkButton url={productLink} /> : '—'}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="production-analytics-detail-item-actions">
                          {productLink ? (
                            <NovinkaExternalLinkButton url={productLink} />
                          ) : (
                            '—'
                          )}
                        </span>
                        <span>{item.requiredQuantity}</span>
                        <span>{item.actualQuantity ?? 0}</span>
                      </>
                    )}
                  </div>
                  )
                })}
              </div>
            </article>
            )
          })}
        </div>
      </div>
    </div>
  )
}
