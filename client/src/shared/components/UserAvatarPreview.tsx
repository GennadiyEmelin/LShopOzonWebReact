import { ProductImageHoverPreview } from './ProductMedia'

export function UserAvatarPreview({
  avatarUrl,
  displayName,
  nested = false,
  className = 'chat-avatar',
  hoverPreview = true,
}: {
  avatarUrl?: string
  displayName: string
  nested?: boolean
  className?: string
  hoverPreview?: boolean
}) {
  const content = avatarUrl ? (
    <img src={avatarUrl} alt={displayName} />
  ) : (
    <span>Фото</span>
  )

  const avatar = nested ? (
    content
  ) : (
    <span className={className}>{content}</span>
  )

  if (!avatarUrl || !hoverPreview) {
    return avatar
  }

  return (
    <ProductImageHoverPreview imageUrl={avatarUrl} name={displayName}>
      {avatar}
    </ProductImageHoverPreview>
  )
}
