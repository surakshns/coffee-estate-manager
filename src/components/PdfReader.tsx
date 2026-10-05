import { useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, LoaderCircle, Maximize2, ZoomIn, ZoomOut } from 'lucide-react'
import { getDocument, GlobalWorkerOptions, type PDFDocumentProxy, type RenderTask } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { Notice } from './Workspace'

GlobalWorkerOptions.workerSrc = workerUrl

export default function PdfReader({ url, title }: { url: string; title: string }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [page, setPage] = useState(1)
  const [zoom, setZoom] = useState(1)
  const [width, setWidth] = useState(0)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  const container = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    let cancelled = false
    setPdf(null); setPage(1); setZoom(1); setError(''); setBusy(true)
    const task = getDocument({ url })
    void task.promise.then(value => { if (!cancelled) setPdf(value) }).catch(reason => {
      if (!cancelled) { setError(reason?.name === 'PasswordException' ? 'This PDF is password protected. Download it and open it with its PDF password.' : 'This PDF could not be displayed. Try again or download the original.'); setBusy(false) }
    })
    return () => { cancelled = true; void task.destroy() }
  }, [url, retry])

  useEffect(() => {
    if (!container.current) return
    const observer = new ResizeObserver(entries => setWidth(Math.max(0, entries[0].contentRect.width - 24)))
    observer.observe(container.current)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (container.current) { container.current.scrollTop = 0; container.current.scrollLeft = 0 }
  }, [page])

  useEffect(() => {
    if (!pdf || !width || !canvas.current) return
    let cancelled = false
    let task: RenderTask | undefined
    setBusy(true); setError('')
    void (async () => {
      try {
        const source = await pdf.getPage(page)
        if (cancelled || !canvas.current) return
        const base = source.getViewport({ scale: 1 })
        const viewport = source.getViewport({ scale: width / base.width * zoom })
        const ratio = Math.min(window.devicePixelRatio || 1, 2)
        const target = canvas.current
        target.width = Math.ceil(viewport.width * ratio)
        target.height = Math.ceil(viewport.height * ratio)
        target.style.width = viewport.width + 'px'
        target.style.height = viewport.height + 'px'
        task = source.render({ canvas: target, viewport, transform: [ratio, 0, 0, ratio, 0, 0] })
        await task.promise
      } catch (reason) {
        if (!cancelled && !(reason instanceof Error && reason.name === 'RenderingCancelledException')) setError('Could not display this page. Download the original to open it.')
      } finally { if (!cancelled) setBusy(false) }
    })()
    return () => { cancelled = true; task?.cancel() }
  }, [pdf, page, width, zoom])

  return <div className="pdf-reader">
    <div className="pdf-controls" aria-label="PDF controls">
      <div><button className="icon-button" title="Previous page" aria-label="Previous page" disabled={!pdf || page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft size={19} /></button><span className="pdf-page-count" aria-live="polite">Page {page} of {pdf?.numPages ?? '...'}</span><button className="icon-button" title="Next page" aria-label="Next page" disabled={!pdf || page >= pdf.numPages} onClick={() => setPage(page + 1)}><ChevronRight size={19} /></button></div>
      <div><button className="icon-button" title="Zoom out" aria-label="Zoom out" disabled={!pdf || zoom <= .5} onClick={() => setZoom(Math.max(.5, zoom - .25))}><ZoomOut size={18} /></button><button className="icon-button" title="Fit to width" aria-label="Fit to width" disabled={!pdf} onClick={() => setZoom(1)}><Maximize2 size={17} /></button><button className="icon-button" title="Zoom in" aria-label="Zoom in" disabled={!pdf || zoom >= 2.5} onClick={() => setZoom(Math.min(2.5, zoom + .25))}><ZoomIn size={18} /></button></div>
    </div>
    <Notice error>{error}</Notice>{error && <button className="text-button" onClick={() => setRetry(retry + 1)}>Try again</button>}
    <div className="pdf-page-scroll" ref={container} aria-busy={busy}>
      {busy && <div className="pdf-loading" role="status"><LoaderCircle size={22} className="animate-spin" /><span>Loading page...</span></div>}
      <canvas ref={canvas} role="img" aria-label={title + ', page ' + page} style={{ visibility: busy || error ? 'hidden' : 'visible' }} />
    </div>
  </div>
}
