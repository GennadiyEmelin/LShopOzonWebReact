import { useEffect, useState } from 'react'
import {
  appendNovinkaMarketplaceNote,
  getKzMarketplaceLabel,
  KZ_MARKETPLACES,
  type KzMarketplace,
  type ShopRegion,
} from '../../../shopRegion'
import type { ProductionCatalogItem, ProductionFile, ProductionFilePath } from '../../../domain/types/production'
import type { OzonProduct } from '../../../domain/types/ozon'
import { getApiErrorMessage } from '../../../shared/api/client'
import * as productionApi from '../../../shared/api/productionApi'
import { PathCopyBlock } from '../../../shared/components/PathCopyBlock'
import { formatDateTime } from '../../../shared/utils/formatters'
import {
  getProductionFilesForCatalogItem,
  getProductionPathsForCatalogItem,
} from '../lib/catalogUtils'
import { NovinkaProductPreview } from './NovinkaProductPreview'
import { NovinkaSearchInput } from './NovinkaSearchInput'
import { ProductSearchInput } from './ProductSearchInput'
import { TaskProductPreview } from './TaskProductPreview'

export function ProductCatalogFilesEditor({
  token,
  novinkaProducts,
  catalogProducts,
  kzProducts,
  productionFiles,
  productionFilePaths,
  onRefreshProductionData,
  onDownloadFile,
  onDeleteFile,
  shopRegion,
  kzMarketplace,
}: {
  token: string
  novinkaProducts: ProductionCatalogItem[]
  catalogProducts: OzonProduct[]
  kzProducts: Record<KzMarketplace, OzonProduct[]>
  productionFiles: ProductionFile[]
  productionFilePaths: ProductionFilePath[]
  onRefreshProductionData: () => Promise<void>
  onDownloadFile: (id: string) => void
  onDeleteFile?: (id: string) => void
  shopRegion: ShopRegion
  kzMarketplace: KzMarketplace
}) {
  const [targetMode, setTargetMode] = useState<'novinka' | 'catalog'>('novinka')
  const [filesCatalogMarketplace, setFilesCatalogMarketplace] = useState<KzMarketplace>(kzMarketplace)
  const [filesNovinkaOfferId, setFilesNovinkaOfferId] = useState('')
  const [filesCatalogProductId, setFilesCatalogProductId] = useState('')
  const [pathDraft, setPathDraft] = useState('')
  const [pendingFiles, setPendingFiles] = useState<File[]>([])
  const [filesStatus, setFilesStatus] = useState('')
  const [filesSaving, setFilesSaving] = useState(false)

  useEffect(() => {
    setFilesCatalogMarketplace(kzMarketplace)
  }, [kzMarketplace])

  const activeCatalogProducts =
    shopRegion === 'rf' ? catalogProducts : kzProducts[filesCatalogMarketplace]
  const catalogLabel = shopRegion === 'rf' ? 'Ozon' : getKzMarketplaceLabel(filesCatalogMarketplace)

  const selectedNovinka = novinkaProducts.find((item) => item.offerId === filesNovinkaOfferId)
  const selectedCatalogProduct = activeCatalogProducts.find(
    (product) => String(product.productId) === filesCatalogProductId,
  )
  const selectedCatalogItem: ProductionCatalogItem | undefined =
    targetMode === 'novinka' && selectedNovinka
      ? selectedNovinka
      : selectedCatalogProduct
        ? {
            offerId: selectedCatalogProduct.offerId,
            ozonProductId: selectedCatalogProduct.productId,
            productName: selectedCatalogProduct.name,
            productLink: selectedCatalogProduct.productUrl ?? '',
            fileCount: 0,
          }
        : undefined

  const itemFiles = selectedCatalogItem
    ? getProductionFilesForCatalogItem(selectedCatalogItem, productionFiles)
    : []
  const itemPaths = selectedCatalogItem
    ? getProductionPathsForCatalogItem(selectedCatalogItem, productionFilePaths)
    : []

  async function deleteCatalogPath(pathId: string) {
    if (!window.confirm('Удалить путь к файлу?')) {
      return
    }

    const response = await productionApi.deleteProductionCatalogFilePath(token, pathId)

    if (!response.ok) {
      setFilesStatus(getApiErrorMessage(await response.text(), 'Не удалось удалить путь'))
      return
    }

    setFilesStatus('Путь удалён')
    await onRefreshProductionData()
  }

  async function saveCatalogAssets() {
    if (!selectedCatalogItem) {
      setFilesStatus(
        shopRegion === 'rf' ? 'Выберите новинку или товар Ozon' : 'Выберите новинку или товар маркетплейса',
      )
      return
    }

    const trimmedPath = pathDraft.trim()
    if (trimmedPath.length > 0 && trimmedPath.length < 3) {
      setFilesStatus('Путь к файлу должен содержать минимум 3 символа')
      return
    }

    if (trimmedPath.length === 0 && pendingFiles.length === 0) {
      setFilesStatus('Укажите путь или выберите файлы для загрузки')
      return
    }

    setFilesSaving(true)
    setFilesStatus('')

    try {
      if (trimmedPath.length >= 3) {
        const response = await productionApi.saveProductionCatalogFilePath(token, {
          offerId: selectedCatalogItem.offerId,
          ozonProductId: selectedCatalogItem.ozonProductId ?? null,
          productName: selectedCatalogItem.productName,
          productLink: selectedCatalogItem.productLink ?? '',
          path: trimmedPath,
        })

        if (!response.ok) {
          setFilesStatus(getApiErrorMessage(await response.text(), 'Не удалось сохранить путь'))
          return
        }
      }

      const marketplace =
        targetMode === 'novinka'
          ? selectedNovinka?.marketplace ?? (shopRegion === 'rf' ? 'ozon' : filesCatalogMarketplace)
          : shopRegion === 'rf'
            ? 'ozon'
            : filesCatalogMarketplace

      const uploadedCount = pendingFiles.length

      for (const file of pendingFiles) {
        const formData = new FormData()
        formData.append(
          'ozonProductId',
          selectedCatalogItem.ozonProductId ? String(selectedCatalogItem.ozonProductId) : '0',
        )
        formData.append('offerId', selectedCatalogItem.offerId)
        formData.append('productName', selectedCatalogItem.productName)
        formData.append('productLink', selectedCatalogItem.productLink ?? '')
        formData.append('notes', appendNovinkaMarketplaceNote('', marketplace))
        formData.append('file', file)

        const response = await productionApi.uploadProductionFile(token, formData)

        if (!response.ok) {
          setFilesStatus(getApiErrorMessage(await response.text(), `Не удалось загрузить файл ${file.name}`))
          return
        }
      }

      setPathDraft('')
      setPendingFiles([])
      await onRefreshProductionData()
      setFilesStatus(
        uploadedCount > 0 && trimmedPath.length >= 3
          ? `Сохранено: путь и ${uploadedCount} файл(ов)`
          : uploadedCount > 0
            ? `Загружено файлов: ${uploadedCount}`
            : 'Путь сохранён',
      )
    } finally {
      setFilesSaving(false)
    }
  }

  return (
    <section className="product-catalog-files-editor">
      <div className="section-title soft-title">
        <div>
          <h2>Файлы и пути производства</h2>
          <p>
            {shopRegion === 'rf'
              ? 'Выберите новинку или товар Ozon, укажите путь на диске и прикрепите файлы.'
              : 'Выберите новинку или товар маркетплейса KZ, укажите путь на диске и прикрепите файлы.'}
          </p>
        </div>
      </div>

      <div className="product-catalog-files-body">
        <div className="product-catalog-files-tabs" role="tablist" aria-label="Тип товара">
          <button
            type="button"
            role="tab"
            aria-selected={targetMode === 'novinka'}
            className={targetMode === 'novinka' ? 'active' : ''}
            onClick={() => setTargetMode('novinka')}
          >
            Новинка
          </button>
          {shopRegion === 'rf' ? (
            <button
              type="button"
              role="tab"
              aria-selected={targetMode === 'catalog'}
              className={targetMode === 'catalog' ? 'active' : ''}
              onClick={() => setTargetMode('catalog')}
            >
              Товар Ozon
            </button>
          ) : (
            KZ_MARKETPLACES.map((marketplace) => (
              <button
                type="button"
                role="tab"
                key={marketplace}
                aria-selected={targetMode === 'catalog' && filesCatalogMarketplace === marketplace}
                className={targetMode === 'catalog' && filesCatalogMarketplace === marketplace ? 'active' : ''}
                onClick={() => {
                  setTargetMode('catalog')
                  setFilesCatalogMarketplace(marketplace)
                  setFilesCatalogProductId('')
                }}
              >
                {getKzMarketplaceLabel(marketplace)}
              </button>
            ))
          )}
        </div>

        <div className="supply-form-block supply-form-block-novinka product-catalog-files-picker">
          <strong>{targetMode === 'novinka' ? 'Новинка' : `Товар ${catalogLabel}`}</strong>
          <span className="product-type-editor-hint">
            {targetMode === 'novinka'
              ? 'Выберите новинку из списка'
              : shopRegion === 'rf'
                ? 'Выберите товар из каталога Ozon'
                : `Выберите товар из каталога ${getKzMarketplaceLabel(filesCatalogMarketplace)}`}
          </span>
          {targetMode === 'novinka' ? (
            <NovinkaSearchInput
              listId="product-editor-files-novinka-list"
              products={novinkaProducts}
              selectedOfferId={filesNovinkaOfferId}
              onOfferIdChange={setFilesNovinkaOfferId}
              placeholder="Начните писать название или артикул"
              showClearButton
            />
          ) : (
            <ProductSearchInput
              listId="product-editor-files-catalog-list"
              products={activeCatalogProducts}
              selectedProductId={filesCatalogProductId}
              onProductIdChange={setFilesCatalogProductId}
              placeholder="Начните писать название или артикул"
              hideInlinePreview
              showClearButton
            />
          )}
        </div>

        {selectedCatalogItem ? (
          <div className="product-catalog-files-current">
            {targetMode === 'catalog' && selectedCatalogProduct ? (
              <TaskProductPreview product={selectedCatalogProduct} />
            ) : (
              <NovinkaProductPreview
                item={selectedCatalogItem}
                token={token}
                files={itemFiles}
                paths={itemPaths}
              />
            )}

            {itemPaths.length > 0 && (
              <div className="product-catalog-files-list">
                <strong>Текущие пути</strong>
                {itemPaths.map((entry) => (
                  <div className="product-catalog-files-row" key={entry.id}>
                    <PathCopyBlock path={entry.path} />
                    <button type="button" className="danger" onClick={() => void deleteCatalogPath(entry.id)}>
                      Удалить
                    </button>
                  </div>
                ))}
              </div>
            )}

            {itemFiles.length > 0 && (
              <div className="product-catalog-files-list">
                <strong>Текущие файлы</strong>
                {itemFiles.map((file) => (
                  <div className="product-catalog-files-row" key={file.id}>
                    <span>
                      <strong>{file.fileName}</strong>
                      <small>{formatDateTime(file.createdAt)}</small>
                    </span>
                    <span className="product-catalog-files-actions">
                      <button type="button" onClick={() => onDownloadFile(file.id)}>
                        Скачать
                      </button>
                      {onDeleteFile && (
                        <button type="button" className="danger" onClick={() => void onDeleteFile(file.id)}>
                          Удалить
                        </button>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="task-form-modal-preview task-form-modal-preview-empty product-catalog-files-empty">
            <span>Выберите товар, чтобы добавить файлы и пути</span>
          </div>
        )}

        <div className="supply-form-block supply-form-block-novinka product-catalog-files-form">
          <strong>Добавить путь и файлы</strong>
          <label className="product-catalog-files-field">
            <span className="product-type-editor-hint">Путь к файлу на диске</span>
            <input
              type="text"
              value={pathDraft}
              placeholder="Например: D:\Production\Товар\макет.psd"
              onChange={(event) => setPathDraft(event.target.value)}
            />
          </label>

          <label className="product-catalog-files-field">
            <span className="product-type-editor-hint">Файлы для загрузки</span>
            <input
              type="file"
              multiple
              onChange={(event) => setPendingFiles(Array.from(event.target.files ?? []))}
            />
            {pendingFiles.length > 0 && (
              <small className="product-catalog-files-pending">Выбрано файлов: {pendingFiles.length}</small>
            )}
          </label>
        </div>
      </div>

      <div className="supply-create-bar product-type-editor-footer product-catalog-files-footer">
        <button
          type="button"
          disabled={!selectedCatalogItem || filesSaving}
          onClick={() => void saveCatalogAssets()}
        >
          {filesSaving ? 'Сохранение...' : 'Сохранить'}
        </button>
        {filesStatus && <p className="modal-status">{filesStatus}</p>}
      </div>
    </section>
  )
}
