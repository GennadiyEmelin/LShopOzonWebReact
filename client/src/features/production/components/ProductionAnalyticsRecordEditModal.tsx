import { useState } from 'react'
import type {
  ProductionAnalyticsAssignee,
  ProductionTask,
  ProductionTaskItem,
} from '../../../domain/types/production'
import {
  fromDatetimeLocalValue,
  getProductionTaskItems,
  toDatetimeLocalValue,
} from '../lib/taskUtils'

export function ProductionAnalyticsRecordEditModal({
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
