import { ProductImageHoverPreview } from './ProductMedia'

export function UserAvatarPreview({
  avatarUrl,
  displayName,
  nested = false,
  className = 'chat-avatar',
}: {
  avatarUrl?: string
  displayName: string
  nested?: boolean
  className?: string
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

  if (!avatarUrl) {
    return avatar
  }

  return (
    <ProductImageHoverPreview imageUrl={avatarUrl} name={displayName}>
      {avatar}
    </ProductImageHoverPreview>
  )
}
