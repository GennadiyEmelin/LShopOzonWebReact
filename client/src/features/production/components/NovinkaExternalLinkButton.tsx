export function NovinkaExternalLinkButton({ url }: { url: string }) {
  const normalizedUrl = url.trim()
  if (!normalizedUrl) {
    return null
  }

  return (
    <button
      type="button"
      className="task-form-modal-btn novinka-external-link-btn"
      onClick={() => window.open(normalizedUrl, '_blank', 'noopener,noreferrer')}
    >
      Ссылка
    </button>
  )
}
