import type { ProductionFilePath } from '../../../domain/types/production'
import { PathCopyBlock } from '../../../shared/components/PathCopyBlock'

export function ProductionPathsPanel({
  paths,
  showCopy = true,
}: {
  paths: ProductionFilePath[]
  showCopy?: boolean
}) {
  if (paths.length === 0) {
    return <small className="task-path-empty">Путь не указан</small>
  }

  return (
    <div className="production-paths-panel">
      {paths.map((entry) =>
        showCopy ? (
          <PathCopyBlock key={entry.id} path={entry.path} />
        ) : (
          <span className="production-path-text" key={entry.id} title={entry.path}>
            {entry.path}
          </span>
        ),
      )}
    </div>
  )
}
