import type {
  ProductionAnalyticsSummaryRow,
  ProductionFilePath,
  ProductionTask,
} from '../../../domain/types/production'
import { UserAvatarPreview } from '../../../shared/components/UserAvatarPreview'
import { formatDateTime } from '../../../shared/utils/formatters'
import { getProductionTaskItems } from '../lib/taskUtils'
import { getProductionTaskTypeLabel } from '../lib/taskDisplayUtils'
import { ProductionAnalyticsTaskItemsTable } from './ProductionAnalyticsTaskItemsTable'

export function ProductionAnalyticsUserCard({
  row,
  tasks,
  productionFilePaths = [],
  isExpanded,
  expandedTaskId,
  isAdmin,
  onToggleDetails,
  onToggleTask,
  onExportExcel,
  onEditTask,
}: {
  row: ProductionAnalyticsSummaryRow
  tasks: ProductionTask[]
  productionFilePaths?: ProductionFilePath[]
  isExpanded: boolean
  expandedTaskId: string | null
  isAdmin?: boolean
  onToggleDetails: () => void
  onToggleTask: (taskId: string) => void
  onExportExcel: (userId: string) => void
  onEditTask?: (task: ProductionTask) => void
}) {
  return (
    <article className={`production-analytics-user-card${isExpanded ? ' production-analytics-user-card-expanded' : ''}`}>
      <div className="production-analytics-user-card-top">
        <div className="production-analytics-user-card-main">
          <UserAvatarPreview
            avatarUrl={row.avatarUrl}
            displayName={row.userName}
            className="production-analytics-avatar"
          />
          <div className="production-analytics-user-card-text">
            <strong>{row.userName}</strong>
            <span>
              {row.taskCount} задач · {row.itemCount} позиций
            </span>
          </div>
        </div>
        <div className="production-analytics-user-card-actions">
          <button type="button" className="text-action-button" onClick={onToggleDetails}>
            {isExpanded ? 'Скрыть' : 'Подробнее'}
          </button>
          {row.userId && (
            <button type="button" className="text-action-button" onClick={() => onExportExcel(row.userId!)}>
              Excel
            </button>
          )}
        </div>
      </div>

      {isExpanded && (
        <div className="production-analytics-user-tasks">
          {tasks.length === 0 ? (
            <div className="production-analytics-empty">За выбранный период задач не найдено.</div>
          ) : (
            tasks.map((task) => {
              const taskItems = getProductionTaskItems(task)
              const taskExpanded = expandedTaskId === task.id

              return (
                <section className="production-analytics-user-task" key={task.id}>
                  <button
                    type="button"
                    className={`production-analytics-user-task-toggle${taskExpanded ? ' expanded' : ''}`}
                    onClick={() => onToggleTask(task.id)}
                  >
                    <span className="production-analytics-user-task-toggle-main">
                      <strong>{task.productName}</strong>
                      <span>
                        {getProductionTaskTypeLabel(task)}
                        {task.isUrgent ? ' · срочно' : ''}
                        {task.completedAt ? ` · ${formatDateTime(task.completedAt)}` : ''}
                        {` · ${taskItems.length} поз.`}
                      </span>
                    </span>
                    <span className="production-analytics-user-task-toggle-icon" aria-hidden="true">
                      {taskExpanded ? '▾' : '▸'}
                    </span>
                  </button>
                  {taskExpanded && (
                    <div className="production-analytics-user-task-body">
                      <div className="production-analytics-user-task-meta">
                        <span>Создана: {formatDateTime(task.createdAt)}</span>
                        {task.startedAt && <span>Начата: {formatDateTime(task.startedAt)}</span>}
                        {task.completedAt && <span>Завершена: {formatDateTime(task.completedAt)}</span>}
                        {task.createdByDisplayName && <span>Создал: {task.createdByDisplayName}</span>}
                        {isAdmin && onEditTask && (
                          <button type="button" className="text-action-button" onClick={() => onEditTask(task)}>
                            Изменить
                          </button>
                        )}
                      </div>
                      <ProductionAnalyticsTaskItemsTable
                        task={task}
                        productionFilePaths={productionFilePaths}
                      />
                    </div>
                  )}
                </section>
              )
            })
          )}
        </div>
      )}
    </article>
  )
}
