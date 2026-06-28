import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { ProductionCatalogItem } from '../../../domain/types/production'
import { OfferIdCell } from '../../../shared/components/OfferIdCell'
import { ProductThumb } from '../../../shared/components/ProductMedia'
import { formatNovinkaSelectedLabel } from '../lib/productSearchUtils'

export function NovinkaSearchInput({
  listId: _listId,
  products,
  selectedOfferId,
  onOfferIdChange,
  placeholder,
  showClearButton = false,
}: {
  listId: string
  products: ProductionCatalogItem[]
  selectedOfferId: string
  onOfferIdChange: (offerId: string) => void
  placeholder: string
  showClearButton?: boolean
}) {
  const selectedProduct = products.find((item) => item.offerId === selectedOfferId)
  const selectedLabel = selectedProduct ? formatNovinkaSelectedLabel(selectedProduct) : ''
  const [query, setQuery] = useState(selectedLabel)
  const [isOpen, setIsOpen] = useState(false)
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({})
  const controlRef = useRef<HTMLDivElement>(null)
  const normalizedQuery = query.trim().toLowerCase()
  const filteredProducts = normalizedQuery
    ? products
        .filter((item) =>
          [item.productName, item.offerId, item.productLink]
            .filter(Boolean)
            .some((value) => value.toLowerCase().includes(normalizedQuery)),
        )
        .slice(0, 80)
    : products.slice(0, 80)

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

  function selectProduct(item: ProductionCatalogItem) {
    onOfferIdChange(item.offerId)
    setQuery(formatNovinkaSelectedLabel(item))
    setIsOpen(false)
  }

  function clearSelection() {
    onOfferIdChange('')
    setQuery('')
    setIsOpen(false)
  }

  return (
    <div className="product-search-wrap">
      <div
        className={`product-search-control-row ${showClearButton && selectedProduct ? 'has-outside-clear' : ''}`}
      >
        <div ref={controlRef} className="product-search-control">
          <input
            className="product-search-input"
            placeholder={placeholder}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setIsOpen(true)
              if (!event.target.value.trim()) {
                onOfferIdChange('')
              }
            }}
            onFocus={() => setIsOpen(true)}
            onBlur={() => window.setTimeout(() => setIsOpen(false), 120)}
          />
          {isOpen && filteredProducts.length > 0 && (
            <div className="product-search-menu product-search-menu-fixed" id={_listId} style={menuStyle}>
              {filteredProducts.map((item) => (
                <button
                  type="button"
                  className="product-search-option"
                  key={item.offerId}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectProduct(item)}
                >
                  <ProductThumb name={item.productName} />
                  <span>
                    <OfferIdCell offerId={item.offerId} />
                    <small>{item.productName}</small>
                  </span>
                </button>
              ))}
            </div>
          )}
          {isOpen && filteredProducts.length === 0 && (
            <div className="product-search-menu product-search-menu-fixed product-search-menu-empty" style={menuStyle}>
              <span>
                {products.length === 0
                  ? 'Список новинок пуст. Добавьте новый товар в поставку или завершите задачи по новинкам с файлами.'
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
    </div>
  )
}
