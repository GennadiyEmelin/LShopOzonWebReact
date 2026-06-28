import { useEffect, useState } from 'react'
import { ProductThumb } from './ProductMedia'

type LinkPreviewData = {
  imageUrl?: string
  title?: string
}

const linkPreviewCache = new Map<string, LinkPreviewData>()

function parseLinkPreviewResponse(data: Record<string, unknown>): LinkPreviewData {
  return {
    imageUrl: (data.imageUrl ?? data.ImageUrl) as string | undefined,
    title: (data.title ?? data.Title) as string | undefined,
  }
}

async function fetchLinkPreview(url: string, token: string): Promise<LinkPreviewData> {
  const normalizedUrl = url.trim()
  if (!normalizedUrl || !token) {
    return {}
  }

  const cached = linkPreviewCache.get(normalizedUrl)
  if (cached) {
    return cached
  }

  const response = await fetch(`/api/link-preview?url=${encodeURIComponent(normalizedUrl)}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  })

  if (!response.ok) {
    return {}
  }

  const data = parseLinkPreviewResponse((await response.json()) as Record<string, unknown>)
  linkPreviewCache.set(normalizedUrl, data)
  return data
}

function usePreviewImageSrc(imageUrl: string | undefined, token: string) {
  const [displaySrc, setDisplaySrc] = useState<string | undefined>()

  useEffect(() => {
    if (!imageUrl?.trim() || !token) {
      setDisplaySrc(undefined)
      return
    }

    let objectUrl: string | undefined
    let cancelled = false

    void fetch(`/api/link-preview/image?url=${encodeURIComponent(imageUrl.trim())}`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    })
      .then((response) => (response.ok ? response.blob() : null))
      .then((blob) => {
        if (cancelled || !blob) {
          return
        }

        objectUrl = URL.createObjectURL(blob)
        setDisplaySrc(objectUrl)
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl)
      }
    }
  }, [imageUrl, token])

  return displaySrc
}

export function LinkHoverPreview({
  url,
  name,
  token,
}: {
  url: string
  name: string
  token: string
}) {
  const normalizedUrl = url.trim()
  const [preview, setPreview] = useState<LinkPreviewData | null>(
    () => linkPreviewCache.get(normalizedUrl) ?? null,
  )
  const [visible, setVisible] = useState(false)
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const displaySrc = usePreviewImageSrc(preview?.imageUrl, token)

  useEffect(() => {
    if (!normalizedUrl || !token) {
      return
    }

    const cached = linkPreviewCache.get(normalizedUrl)
    if (cached) {
      setPreview(cached)
      return
    }

    let cancelled = false
    void fetchLinkPreview(normalizedUrl, token).then((data) => {
      if (cancelled) {
        return
      }

      setPreview(data)
    })

    return () => {
      cancelled = true
    }
  }, [normalizedUrl, token])

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

  const label = preview?.title || name || 'Ссылка'

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
        <ProductThumb imageUrl={displaySrc ?? preview?.imageUrl} name={label} />
      </span>
      {visible && (
        <div className="product-image-hover-popup link-hover-popup" style={{ left: position.x, top: position.y }}>
          {displaySrc || preview?.imageUrl ? (
            <img src={displaySrc ?? preview?.imageUrl} alt={label} referrerPolicy="no-referrer" />
          ) : (
            <div className="link-hover-popup-fallback">
              <strong>{label}</strong>
              <small>{normalizedUrl}</small>
            </div>
          )}
        </div>
      )}
    </>
  )
}
