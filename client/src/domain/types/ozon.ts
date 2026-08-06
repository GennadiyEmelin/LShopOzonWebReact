export type OzonProduct = {
  productId: number
  offerId: string
  sku?: number
  name: string
  price: number
  oldPrice: number
  minPrice: number
  currencyCode: string
  status: string
  productUrl: string
  imageUrl: string
  costTotal?: number | null
  isPurchased?: boolean
}
