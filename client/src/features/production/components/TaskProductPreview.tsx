import type { OzonProduct } from '../../../domain/types/ozon'
import { OfferIdCell } from '../../../shared/components/OfferIdCell'
import { ProductImageHoverPreview, ProductThumb } from '../../../shared/components/ProductMedia'

export function TaskProductPreview({ product }: { product: OzonProduct }) {
  return (
    <div className="task-form-modal-preview selected-product-card selected-product-card-large">
      <ProductImageHoverPreview imageUrl={product.imageUrl} name={product.name}>
        <ProductThumb imageUrl={product.imageUrl} name={product.name} large />
      </ProductImageHoverPreview>
      <span>
        <strong>{product.name}</strong>
        <small>
          <OfferIdCell offerId={product.offerId} inline />
          {product.sku ? ` | SKU ${product.sku}` : ''}
        </small>
        {product.productUrl && (
          <a className="task-product-ozon-link" href={product.productUrl} target="_blank" rel="noreferrer">
            Открыть на Ozon
          </a>
        )}
      </span>
    </div>
  )
}
