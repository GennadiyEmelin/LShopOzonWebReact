import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { OzonProduct } from '../../../domain/types/ozon'
import { OfferIdCell } from '../../../shared/components/OfferIdCell'
import { ProductImageHoverPreview, ProductThumb } from '../../../shared/components/ProductMedia'
import { formatProductOption, formatProductSelectedLabel } from '../lib/productSearchUtils'

export function ProductSearchInput({
  listId: _listId,
  products,
  selectedProductId,
  onProductIdChange,
  placeholder,
  required = false,
  largePreview = false,
  hideInlinePreview = false,
  showClearButton = false,
}: {
  listId: string
  products: OzonProduct[]
  selectedProductId: string
  onProductIdChange: (productId: string) => void
  placeholder: string
  required?: boolean
  largePreview?: boolean
  hideInlinePreview?: boolean
  showClearButton?: boolean
}) {
  const safeProducts = products ?? []
  const selectedProduct = safeProducts.find((product) => String(product.productId) === selectedProductId)
  const selectedLabel = selectedProduct ? formatProductSelectedLabel(selectedProduct) : ''
  const [query, setQuery] = useState(selectedLabel)
  const [isOpen, setIsOpen] = useState(false)
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({})
  const controlRef = useRef<HTMLDivElement>(null)
  const normalizedQuery = query.trim().toLowerCase()
  const filteredProducts = normalizedQuery
    ? safeProducts
        .filter((product) =>
          [
            product.name,
            product.offerId,
            product.sku,
            product.productId,
            product.status,
          ]
            .filter((value) => value !== undefined && value !== null)
            .some((value) => String(value).toLowerCase().includes(normalizedQuery)),
        )
        .slice(0, 80)
    : safeProducts.slice(0, 80)

  useEffect(() => {
    setQuery(selectedLabel)
  }, [selectedLabel])

  useEffect(() => {
    if (!isOpen) {
      return
    }

    function updateMenuPosition() {
      const input = controlRef.current?.querySelector('.product-search-input')
      if (!(input instanceof HTMLInputElement)) {
        return
      }

      const rect = input.getBoundingClientRect()
      setMenuStyle({
        position: 'fixed',
        top: `${rect.bottom + 6}px`,
        left: `${rect.left}px`,
        width: `${Math.min(rect.width, 680)}px`,
        zIndex: 2000,
      })
    }

    updateMenuPosition()
    window.addEventListener('resize', updateMenuPosition)
    window.addEventListener('scroll', updateMenuPosition, true)
    return () => {
      window.removeEventListener('resize', updateMenuPosition)
      window.removeEventListener('scroll', updateMenuPosition, true)
    }
  }, [isOpen, query, products.length])

  function handleChange(value: string) {
    setQuery(value)
    setIsOpen(true)

    const selected = products.find((product) => {
      const productId = String(product.productId)
      return productId === value || formatProductOption(product) === value || formatProductSelectedLabel(product) === value
    })

    onProductIdChange(selected ? String(selected.productId) : '')
  }

  function selectProduct(product: OzonProduct) {
    onProductIdChange(String(product.productId))
    setQuery(formatProductSelectedLabel(product))
    setIsOpen(false)
  }

  function clearSelection() {
    onProductIdChange('')
    setQuery('')
    setIsOpen(false)
  }

  return (
    <div className="product-search-wrap">
      <div
        className={`product-search-control-row ${showClearButton && selectedProduct ? 'has-outside-clear' : ''}`}
      >
        <div
          ref={controlRef}
          className={`product-search-control ${selectedProduct && !showClearButton ? 'has-inline-thumb' : ''}`}
        >
          <input
            className="product-search-input"
            placeholder={placeholder}
            value={query}
            onChange={(event) => handleChange(event.target.value)}
            onFocus={() => setIsOpen(true)}
            onBlur={() => window.setTimeout(() => setIsOpen(false), 120)}
            required={required}
          />
          {selectedProduct && !showClearButton && (
            <ProductThumb imageUrl={selectedProduct.imageUrl} name={selectedProduct.name} />
          )}
          {isOpen && filteredProducts.length > 0 && (
            <div className="product-search-menu product-search-menu-fixed" id={_listId} style={menuStyle}>
              {filteredProducts.map((product) => (
                <button
                  type="button"
                  className="product-search-option"
                  key={product.productId}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectProduct(product)}
                >
                  <ProductImageHoverPreview imageUrl={product.imageUrl} name={product.name}>
                    <ProductThumb imageUrl={product.imageUrl} name={product.name} />
                  </ProductImageHoverPreview>
                  <span>
                    <OfferIdCell offerId={product.offerId} />
                    <small>{product.name}</small>
                  </span>
                </button>
              ))}
            </div>
          )}
          {isOpen && filteredProducts.length === 0 && (
            <div className="product-search-menu product-search-menu-fixed product-search-menu-empty" style={menuStyle}>
              <span>
                {products.length === 0
                  ? 'Список товаров пуст. Подождите загрузку или откройте вкладку «Товары».'
                  : 'По вашему запросу ничего не найдено.'}
              </span>
            </div>
          )}
        </div>
        {showClearButton && selectedProduct && (
          <button
            type="button"
            className="product-search-clear-outside"
            aria-label="Очистить выбор"
            onMouseDown={(event) => event.preventDefault()}
            onClick={clearSelection}
          >
            ×
          </button>
        )}
      </div>
      {selectedProduct && !hideInlinePreview && (
        <div className={`selected-product-card ${largePreview ? 'selected-product-card-large' : ''}`}>
          <ProductThumb imageUrl={selectedProduct.imageUrl} name={selectedProduct.name} large={largePreview} />
          <span>
            <strong>{selectedProduct.name}</strong>
            <small>
              <OfferIdCell offerId={selectedProduct.offerId} inline />
              {selectedProduct.sku ? ` | SKU ${selectedProduct.sku}` : ''}
            </small>
          </span>
        </div>
      )}
    </div>
  )
}
