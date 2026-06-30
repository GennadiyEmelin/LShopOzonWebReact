import type { ProductionFilePath, ProductionTask } from '../../../domain/types/production'
import { stripNovinkaMarketplaceNote } from '../../../shopRegion'
import { OfferIdCell } from '../../../shared/components/OfferIdCell'
import { PathCopyBlock } from '../../../shared/components/PathCopyBlock'
import { getProductionPathsForTaskItem } from '../lib/catalogUtils'
import { getProductionTaskItems, isNovinkaTask } from '../lib/taskUtils'
import { NovinkaExternalLinkButton } from './NovinkaExternalLinkButton'

export function ProductionAnalyticsTaskItemsTable({
  task,
  productionFilePaths = [],
}: {
  task: ProductionTask
  productionFilePaths?: ProductionFilePath[]
}) {
  const novinka = isNovinkaTask(task)
  const taskItems = getProductionTaskItems(task)

  if (taskItems.length === 0) {
    return (
      <div className="production-analytics-empty production-analytics-task-items-empty">
        В задаче нет позиций.
      </div>
    )
  }

  return (
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
                  {productLink ? <NovinkaExternalLinkButton url={productLink} /> : '—'}
                </span>
                <span>{item.requiredQuantity}</span>
                <span>{item.actualQuantity ?? 0}</span>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
