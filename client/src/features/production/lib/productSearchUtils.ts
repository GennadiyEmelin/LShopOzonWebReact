import type { ProductionCatalogItem } from '../../../domain/types/production'
import type { OzonProduct } from '../../../domain/types/ozon'

export function formatProductOption(product: OzonProduct) {
  const sku = product.sku ? ` | SKU ${product.sku}` : ''
  return `${product.offerId} | ${product.name}${sku} | ID ${product.productId}`
}

export function formatProductSelectedLabel(product: OzonProduct) {
  const name = product.name.length > 64 ? `${product.name.slice(0, 64)}...` : product.name
  return `${product.offerId} | ${name}`
}

export function formatNovinkaSelectedLabel(item: ProductionCatalogItem) {
  const name = item.productName.length > 64 ? `${item.productName.slice(0, 64)}...` : item.productName
  return `${item.offerId} | ${name}`
}
