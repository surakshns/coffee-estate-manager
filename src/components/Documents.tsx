import { lazy, Suspense, useEffect, useMemo, useState, type FormEvent } from 'react'
import { Download, FileText, Image as ImageIcon, Upload, Trash2, LoaderCircle, ExternalLink, ChevronRight } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { EstateData, PropertyDocument } from '../lib/types'
import { ConfirmDialog } from './ConfirmDialog'
import { EmptyState, Notice, PageHeading, SearchField, Sheet, displayDate } from './Workspace'

const bucket = 'property-documents'
const PdfReader = lazy(() => import('./PdfReader'))
const categories = ['Land records', 'Tax receipts', 'Loan papers', 'Maps', 'Agreements', 'Insurance', 'Other']
const emptyForm = { title: '', document_date: '', category: 'Land records', notes: '' }

function formatSize(bytes: number | null) {
  if (!bytes) return 'Unknown size'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
function safeFileName(name: string) { return name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'document' }
function documentKind(item: PropertyDocument) {
  if (/^image\/(jpeg|png|webp)$/.test(item.file_type ?? '') || /\.(jpe?g|png|webp)$/i.test(item.file_name)) return 'Image'
  if (item.file_type === 'application/pdf' || /\.pdf$/i.test(item.file_name)) return 'PDF'
  if (/\.(doc|docx)$/i.test(item.file_name)) return 'Word'
  if (/\.(xls|xlsx)$/i.test(item.file_name)) return 'Excel'
  return 'File'
}
function previewMime(item: PropertyDocument) {
  if (documentKind(item) === 'PDF') return 'application/pdf'
  if (/\.webp$/i.test(item.file_name)) return 'image/webp'
  if (/\.png$/i.test(item.file_name)) return 'image/png'
  return item.file_type?.startsWith('image/') ? item.file_type : 'image/jpeg'
}

export function Documents({ data, refresh }: { data: EstateData; refresh: () => Promise<void> }) {
  const [form, setForm] = useState(emptyForm)
  const [file, setFile] = useState<File | null>(null)
  const [message, setMessage] = useState('')
  const [uploadError, setUploadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [selected, setSelected] = useState<PropertyDocument | null>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [previewError, setPreviewError] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [retry, setRetry] = useState(0)
  const [deleting, setDeleting] = useState<PropertyDocument | null>(null)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [sort, setSort] = useState('recent')
  const kind = selected ? documentKind(selected) : ''
  const documents = useMemo(() => data.documents.filter(item => {
    const text = `${item.title} ${item.category} ${item.notes} ${item.file_name}`.toLowerCase()
    return (!categoryFilter || item.category === categoryFilter) && text.includes(search.trim().toLowerCase())
  }).sort((a, b) => sort === 'name' ? a.title.localeCompare(b.title) : b.created_at.localeCompare(a.created_at)), [categoryFilter, data.documents, search, sort])

  useEffect(() => {
    setPreviewUrl(''); setPreviewError('')
    if (!selected || !['PDF', 'Image'].includes(documentKind(selected))) { setPreviewLoading(false); return }
    let cancelled = false
    let url = ''
    setPreviewLoading(true)
    void (async () => {
      try {
        const { data: blob, error } = await supabase.storage.from(bucket).download(selected.file_path)
        if (error || !blob) throw error ?? new Error('Document unavailable.')
        if (cancelled) return
        url = URL.createObjectURL(new Blob([blob], { type: previewMime(selected) }))
        setPreviewUrl(url)
      } catch (error) { if (!cancelled) setPreviewError(error instanceof Error ? error.message : 'Could not open this document.') }
      finally { if (!cancelled) setPreviewLoading(false) }
    })()
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url) }
  }, [selected, retry])

  async function saveDocument(event: FormEvent) {
    event.preventDefault()
    if (!file || saving) return
    setSaving(true); setUploadError('')
    try {
      const { data: userData, error: userError } = await supabase.auth.getUser()
      if (userError) throw userError
      const userId = userData.user?.id
      if (!userId) throw new Error('Sign in before adding documents.')
      const path = `${userId}/${Date.now()}-${safeFileName(file.name)}`
      const upload = await supabase.storage.from(bucket).upload(path, file, { contentType: file.type || undefined, upsert: false })
      if (upload.error) throw upload.error
      const insert = await supabase.from('property_documents').insert({
        title: form.title.trim() || file.name.replace(/\.[^/.]+$/, ''),
        document_date: form.document_date || null, category: form.category, notes: form.notes.trim(),
        file_path: path, file_name: file.name, file_type: file.type || null, file_size: file.size
      })
      if (insert.error) { await supabase.storage.from(bucket).remove([path]); throw insert.error }
      setForm(emptyForm); setFile(null); setUploadOpen(false); setMessage('Document saved.')
      await refresh()
    } catch (error) { setUploadError(error instanceof Error ? error.message : 'Document upload failed.') }
    finally { setSaving(false) }
  }
  async function downloadDocument(item: PropertyDocument) {
    setDownloadingId(item.id); setMessage(''); setPreviewError('')
    try {
      const { data: blob, error } = await supabase.storage.from(bucket).download(item.file_path)
      if (error || !blob) throw error ?? new Error('Download failed.')
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url; link.download = item.file_name
      document.body.appendChild(link); link.click(); link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (error) {
      const text = error instanceof Error ? error.message : 'Download failed. Please try again.'
      if (selected) setPreviewError(text)
      else setMessage(text)
    } finally { setDownloadingId(null) }
  }
  async function deleteDocument() {
    if (!deleting) return
    const item = deleting
    setDeleting(null)
    const fileResult = await supabase.storage.from(bucket).remove([item.file_path])
    if (fileResult.error) { setMessage(fileResult.error.message); return }
    const rowResult = await supabase.from('property_documents').delete().eq('id', item.id)
    setMessage(rowResult.error ? rowResult.error.message : 'Document removed.')
    if (!rowResult.error) await refresh()
  }

  return <div className="page workspace-page files-page">
    <PageHeading title="Documents" detail={`${data.documents.length} estate files · All years`} action="Add document" onAction={() => { setUploadError(''); setUploadOpen(true) }} />
    <Notice>{message}</Notice>
    <section className="workspace-filters" aria-label="Document filters"><div className="filter-row"><SearchField label="Search documents" placeholder="Search documents" value={search} onChange={setSearch} /><select className="field filter-select" aria-label="Filter document category" value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}><option value="">All categories</option>{categories.map(category => <option key={category}>{category}</option>)}</select></div></section>
    <div className="results-toolbar"><p aria-live="polite">{documents.length} {documents.length === 1 ? 'document' : 'documents'}{(search || categoryFilter) && <button className="text-button" onClick={() => { setSearch(''); setCategoryFilter('') }}>Clear filters</button>}</p><select className="sort-select" aria-label="Sort documents" value={sort} onChange={e => setSort(e.target.value)}><option value="recent">Newest first</option><option value="name">Name A-Z</option></select></div>
    <section className="file-list" aria-label="Saved documents">
      {documents.length ? documents.map(item => <article className="file-record" key={item.id}>
        <button className="file-open" onClick={() => setSelected(item)} aria-label={`Open ${item.title}`}><span className={`file-mark kind-${documentKind(item).toLowerCase()}`}>{documentKind(item) === 'Image' ? <ImageIcon size={23} /> : <FileText size={23} />}<span>{documentKind(item)}</span></span><span className="file-record-content"><strong>{item.title}</strong><span>{item.category}{item.document_date ? ` · ${displayDate(item.document_date)}` : ''}</span><span className="file-name">{item.file_name} · {formatSize(item.file_size)}</span></span><ChevronRight size={18} /></button>
        <div className="record-actions"><button className="icon-button" title="Download" aria-label={`Download ${item.title}`} disabled={!!downloadingId} onClick={() => void downloadDocument(item)}>{downloadingId === item.id ? <LoaderCircle size={18} className="animate-spin" /> : <Download size={18} />}</button><button className="icon-button danger" title="Delete" aria-label={`Delete ${item.title}`} onClick={() => setDeleting(item)}><Trash2 size={17} /></button></div>
      </article>) : <EmptyState title={data.documents.length ? 'No matching documents' : 'No documents yet'} detail={data.documents.length ? 'Try another title or category.' : 'Land records, receipts and agreements will appear here.'} action={data.documents.length ? 'Clear filters' : 'Add document'} onAction={() => data.documents.length ? (setSearch(''), setCategoryFilter('')) : setUploadOpen(true)} />}
    </section>
    <Sheet open={!!selected} title={selected?.title ?? 'Document'} onClose={() => setSelected(null)} wide>
      {selected && <div className="file-reader"><div className="reader-toolbar"><span className={`file-kind-label kind-${kind.toLowerCase()}`}>{kind}</span><span>{selected.category}</span><button className="button-secondary" disabled={!!downloadingId} onClick={() => void downloadDocument(selected)}><Download size={17} />{downloadingId ? 'Downloading...' : 'Download'}</button>{previewUrl && <a className="icon-button" href={previewUrl} target="_blank" rel="noreferrer" title="Open original" aria-label="Open original in a new tab"><ExternalLink size={18} /></a>}</div>
        <Notice error>{previewError}</Notice>
        {previewError && !previewLoading && <button className="text-button" onClick={() => setRetry(retry + 1)}>Try again</button>}
        {previewLoading ? <div className="reader-loading" role="status"><LoaderCircle size={26} className="animate-spin" /><p>Opening document...</p></div> : previewUrl ? kind === 'Image' ? <div className="reader-canvas"><img src={previewUrl} alt={selected.title} /></div> : <Suspense fallback={<div className="reader-loading" role="status">Opening PDF reader...</div>}><PdfReader url={previewUrl} title={selected.title} /></Suspense> : !previewError && <EmptyState title="Preview unavailable for this file type" detail="Download the original file to open it." />}
        <details className="file-details" open><summary>File details</summary><dl className="detail-list"><div><dt>File name</dt><dd>{selected.file_name}</dd></div><div><dt>Size</dt><dd>{formatSize(selected.file_size)}</dd></div><div><dt>Document date</dt><dd>{selected.document_date ? displayDate(selected.document_date) : 'Not specified'}</dd></div><div><dt>Added</dt><dd>{displayDate(selected.created_at.slice(0, 10))}</dd></div>{selected.notes && <div><dt>Notes</dt><dd>{selected.notes}</dd></div>}</dl></details>
      </div>}
    </Sheet>
    <Sheet open={uploadOpen} title="Add document" onClose={() => setUploadOpen(false)} busy={saving}>
      <form className="workspace-form" onSubmit={saveDocument}><Notice error>{uploadError}</Notice><label className="file-upload"><Upload size={26} /><strong>{file ? file.name : 'Choose a document'}</strong><span>{file ? formatSize(file.size) : 'PDF, image, Word or Excel'}</span><input type="file" aria-label="Document file" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx" onChange={e => setFile(e.target.files?.[0] ?? null)} required={!file} /></label><label className="label">Title <span className="optional">(optional)</span><input className="field" value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder={file?.name.replace(/\.[^/.]+$/, '') || 'e.g. Land ownership record'} /></label><div className="form-pair"><label className="label">Category<select className="field" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>{categories.map(category => <option key={category}>{category}</option>)}</select></label><label className="label">Document date <span className="optional">(optional)</span><input className="field" type="date" value={form.document_date} onChange={e => setForm({ ...form, document_date: e.target.value })} /></label></div><label className="label">Notes <span className="optional">(optional)</span><textarea className="field" rows={3} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></label><div className="sheet-footer"><button type="button" className="button-secondary" disabled={saving} onClick={() => setUploadOpen(false)}>Cancel</button><button className="button-primary" disabled={saving}>{saving ? 'Uploading...' : 'Save document'}</button></div></form>
    </Sheet>
    <ConfirmDialog open={!!deleting} title="Delete document?" onCancel={() => setDeleting(null)} onConfirm={() => void deleteDocument()}>This removes the saved file and its document record from your estate.</ConfirmDialog>
  </div>
}
