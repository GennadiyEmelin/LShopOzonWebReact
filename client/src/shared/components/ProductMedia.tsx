import { useState, type ReactNode } from 'react'

export function ProductThumb({ imageUrl, name, large = false }: { imageUrl?: string; name: string; large?: boolean }) {
  return (
    <span className={`product-thumb ${large ? 'product-thumb-large' : ''}`}>
      {imageUrl ? <img src={imageUrl} alt={name} loading="lazy" /> : <span>Фото</span>}
    </span>
  )
}

export function ProductImageHoverPreview({
  imageUrl,
  name,
  children,
}: {
  imageUrl?: string
  name: string
  children: ReactNode
}) {
  const [visible, setVisible] = useState(false)
  const [position, setPosition] = useState({ x: 0, y: 0 })

  if (!imageUrl) {
    return <>{children}</>
  }

  function updatePosition(clientX: number, clientY: number) {
    const popupWidth = 296
    const popupHeight = 296
    const offset = 16
    const maxLeft = window.innerWidth - popupWidth - 12
    const maxTop = window.innerHeight - popupHeight - 12

    setPosition({
      x: Math.max(12, Math.min(clientX + offset, maxLeft)),
      y: Math.max(12, Math.min(clientY + offset, maxTop)),
    })
  }

  return (
    <>
      <span
        className="product-image-hover-trigger"
        onMouseEnter={(event) => {
          setVisible(true)
          updatePosition(event.clientX, event.clientY)
        }}
        onMouseLeave={() => setVisible(false)}
        onMouseMove={(event) => updatePosition(event.clientX, event.clientY)}
      >
        {children}
      </span>
      {visible && (
        <div className="product-image-hover-popup" style={{ left: position.x, top: position.y }}>
          <img src={imageUrl} alt={name} />
        </div>
      )}
    </>
  )
}
