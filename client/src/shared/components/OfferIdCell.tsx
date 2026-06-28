export function OfferIdCell({ offerId, inline = false }: { offerId?: string | null; inline?: boolean }) {
  const value = offerId?.trim() || '-'
  return (
    <span
      className={`offer-id-cell${inline ? ' offer-id-cell-inline' : ''}`}
      title={value === '-' ? undefined : value}
    >
      {value}
    </span>
  )
}
