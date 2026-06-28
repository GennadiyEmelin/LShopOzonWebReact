import { useState } from 'react'

export function PathCopyBlock({ path }: { path: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <div className="path-copy-block">
      <button
        type="button"
        className="copy-path-button"
        onClick={() => {
          void navigator.clipboard.writeText(path).then(() => {
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1500)
          })
        }}
      >
        {copied ? 'Скопировано' : 'Копировать путь'}
      </button>
      <span className="path-copy-block-text" title={path}>
        {path}
      </span>
    </div>
  )
}
