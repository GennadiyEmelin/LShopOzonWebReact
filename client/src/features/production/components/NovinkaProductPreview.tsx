import type {
  ProductionCatalogItem,
  ProductionFile,
  ProductionFilePath,
} from '../../../domain/types/production'
import { LinkHoverPreview } from '../../../shared/components/LinkPreview'
import { OfferIdCell } from '../../../shared/components/OfferIdCell'
import { NovinkaExternalLinkButton } from './NovinkaExternalLinkButton'
import { ProductionFileThumb } from './ProductionTaskTables'
import { ProductionPathsPanel } from './ProductionPathsPanel'

export function NovinkaProductPreview({
  item,
  token,
  files = [],
  paths = [],
}: {
  item: ProductionCatalogItem
  token: string
  files?: ProductionFile[]
  paths?: ProductionFilePath[]
}) {
  const imageFile = files.find((file) => file.contentType.startsWith('image/'))

  return (
    <div className="task-form-modal-preview selected-product-card selected-product-card-large">
      {imageFile ? (
        <ProductionFileThumb file={imageFile} token={token} name={item.productName} />
      ) : (
        <LinkHoverPreview url={item.productLink} name={item.productName} token={token} />
      )}
      <span>
        <strong>{item.productName}</strong>
        <OfferIdCell offerId={item.offerId} />
        {item.productLink && <NovinkaExternalLinkButton url={item.productLink} />}
        {files.length > 0 && (
          <small className="novinka-preview-meta">Файлы производства: {files.length}</small>
        )}
        {paths.length > 0 && (
          <div className="novinka-preview-paths">
            <small className="novinka-preview-meta">Пути к файлу</small>
            <ProductionPathsPanel paths={paths} showCopy />
          </div>
        )}
      </span>
    </div>
  )
}
