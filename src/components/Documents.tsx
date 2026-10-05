import { lazy, Suspense, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { Download, FileText, Image as ImageIcon, Upload, Trash2, LoaderCircle, ChevronRight, LockKeyhole, ShieldCheck } from 'lucide-react'
import { errorMessage } from '../lib/errors'
import { supabase } from '../lib/supabase'
import { useDocumentVault } from '../hooks/useDocumentVault'
import { decryptDocumentMetadata, documentMime, MAX_DOCUMENT_BYTES, type DocumentMetadata } from '../lib/documentVault'
import { DOCUMENT_BUCKET, readDocument, storeEncryptedDocument } from '../lib/documentStorage'
import type { EstateData, PropertyDocument } from '../lib/types'
import { ConfirmDialog } from './ConfirmDialog'
import { EmptyState, Notice, PageHeading, SearchField, Sheet, displayDate } from './Workspace'

const bucket = DOCUMENT_BUCKET
const PdfReader = lazy(() => import('./PdfReader'))
const categories = ['Land records', 'Tax receipts', 'Loan papers', 'Maps', 'Agreements', 'Insurance', 'Other']
const emptyForm = { title: '', document_date: '', category: 'Land records', notes: '' }

function formatSize(bytes: number | null) {
  if (!bytes) return 'Unknown size'
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
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

type UnlockedVault = { owner: string; key: CryptoKey; lock: () => void; assertUnlocked: () => void }

export function Documents({ data, refresh, userId }: { data: EstateData; refresh: () => Promise<void>; userId: string }) {
  const vault = useDocumentVault(userId)
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [formError, setFormError] = useState('')
  const [decoded, setDecoded] = useState<{ source: PropertyDocument[]; key: CryptoKey; documents: PropertyDocument[]; error: string } | null>(null)
  useEffect(() => {
    setPassword(''); setConfirmation(''); setFormError('')
  }, [vault.key])
  useEffect(() => {
    setDecoded(null)
    if (!vault.key) return
    let cancelled = false
    const key = vault.key
    void Promise.all(data.documents.map(async item => {
      if (!item.encryption_version) return item
      if (item.encryption_version !== 1 || !item.encrypted_metadata) throw new Error('Unsupported encrypted document details.')
      return { ...item, ...await decryptDocumentMetadata(key, userId, item.file_path, item.encrypted_metadata) }
    })).then(documents => {
      if (!cancelled) setDecoded({ source: data.documents, key, documents, error: '' })
    }).catch(() => {
      if (!cancelled) setDecoded({ source: data.documents, key, documents: [], error: 'Some encrypted document details could not be verified. Refresh your records and try again. The files have not been changed.' })
    })
    return () => { cancelled = true }
  }, [data.documents, userId, vault.key])
  async function openVault(event: FormEvent) {
    event.preventDefault(); setFormError('')
    if (!vault.record && (password !== confirmation || !acknowledged)) { setFormError(password !== confirmation ? 'Vault passwords do not match.' : 'Confirm that you have saved your vault password.'); return }
    const secret = password
    setPassword(''); setConfirmation('')
    await vault.submit(secret)
  }
  if (!vault.key) return <div className="page workspace-page files-page">
    <PageHeading title="Document vault" detail="Private property records" />
    <section className="document-vault-lock">
      <LockKeyhole size={32} aria-hidden="true" /><h2>{vault.record ? 'Unlock your documents' : 'Protect your property documents'}</h2>
      <p>Files and their details are encrypted on your device before upload. Your vault password is separate from your account password.</p>
      <Notice error>{vault.error || formError}</Notice>
      {vault.loading ? <p role="status">Loading vault...</p> : vault.error && !vault.record ? <button className="button-secondary" onClick={() => void vault.load()}>Retry vault loading</button> : <form className="workspace-form" onSubmit={openVault}>
        <label className="label">Vault password<input className="field" type="password" autoComplete={vault.record ? 'off' : 'new-password'} value={password} onChange={event => setPassword(event.target.value)} minLength={vault.record ? undefined : 16} maxLength={1024} required disabled={vault.busy} /></label>
        {!vault.record && <><p className="section-detail">Use at least 16 characters or several random words. Save this unique password in your password manager. It cannot be recovered by resetting your account password.</p><label className="label">Confirm vault password<input className="field" type="password" autoComplete="new-password" value={confirmation} onChange={event => setConfirmation(event.target.value)} required disabled={vault.busy} /></label><label className="vault-acknowledgement"><input type="checkbox" checked={acknowledged} onChange={event => setAcknowledged(event.target.checked)} required disabled={vault.busy} /><span>I have saved my vault password. I understand that losing it means losing access to my encrypted documents.</span></label>{data.documents.some(item => !item.encryption_version) && <Notice>Existing documents are still in private storage. After setup, use “Encrypt existing documents” to convert them and remove the originals.</Notice>}</>}
        <button className="button-primary" disabled={vault.busy}>{vault.busy ? 'Opening vault...' : vault.record ? 'Unlock vault' : 'Create encrypted vault'}</button>
      </form>}
      <p className="section-detail">Locks when you leave this screen, hide the app, sign out, or stop using it for 5 minutes.</p>
    </section>
  </div>
  if (!decoded || decoded.key !== vault.key || decoded.source !== data.documents) return <div className="page workspace-page"><p role="status">Decrypting document details...</p><button className="button-secondary" onClick={vault.lock}>Lock vault</button></div>
  if (decoded.error) return <div className="page workspace-page"><Notice error>{decoded.error}</Notice><button className="button-secondary" onClick={() => void refresh()}>Refresh records</button><button className="button-secondary" onClick={vault.lock}>Lock vault</button></div>
  return <DocumentWorkspace data={{ ...data, documents: decoded.documents }} refresh={refresh} vault={{ owner: userId, key: vault.key, lock: vault.lock, assertUnlocked: vault.assertUnlocked }} />
}

export function DocumentWorkspace({ data, refresh, vault }: { data: EstateData; refresh: () => Promise<void>; vault: UnlockedVault }) {
  const [form, setForm] = useState(emptyForm)
  const [file, setFile] = useState<File | null>(null)
  const [message, setMessage] = useState('')
  const [recordError, setRecordError] = useState('')
  const [cleanup, setCleanup] = useState<PropertyDocument | null>(null)
  const writing = useRef(false)
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
  const [limit, setLimit] = useState(40)
  const [pendingCleanup, setPendingCleanup] = useState(0)
  const mounted = useRef(true)
  const downloadUrls = useRef(new Set<string>())
  const downloadControllers = useRef(new Set<AbortController>())
  const cleaningQueue = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; for (const url of downloadUrls.current) URL.revokeObjectURL(url); downloadUrls.current.clear(); for (const controller of downloadControllers.current) controller.abort(); downloadControllers.current.clear() }
  }, [])
  useEffect(() => { void cleanupQueuedFiles() }, [vault.owner])
  useEffect(() => setLimit(40), [search, categoryFilter, sort])
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
    const controller = new AbortController()
    setPreviewLoading(true)
    void (async () => {
      try {
        vault.assertUnlocked()
        const blob = await readDocument(selected, vault.owner, vault.key, controller.signal)
        if (cancelled) return
        vault.assertUnlocked()
        url = URL.createObjectURL(new Blob([blob], { type: previewMime(selected) }))
        setPreviewUrl(url)
      } catch (error) { if (!cancelled) setPreviewError(errorMessage(error, 'Could not open this document.')) }
      finally { if (!cancelled) setPreviewLoading(false) }
    })()
    return () => { cancelled = true; controller.abort(); if (url) URL.revokeObjectURL(url) }
  }, [selected, retry])

  async function saveDocument(event: FormEvent) {
    event.preventDefault()
    if (!file || writing.current) return
    writing.current = true; setSaving(true); setUploadError('')
    try {
      if (!file.size || file.size > MAX_DOCUMENT_BYTES) throw new Error('Choose a non-empty document up to 20 MB.')
      const mime = documentMime(file.name, file.type)
      const { data: userData, error: userError } = await supabase.auth.getUser()
      if (userError) throw userError
      const userId = userData.user?.id
      if (userId !== vault.owner) throw new Error('Sign in to your own account before adding documents.')
      await storeEncryptedDocument(file, {
        title: form.title.trim() || file.name.replace(/\.[^/.]+$/, ''),
        document_date: form.document_date || null, category: form.category, notes: form.notes.trim(),
        file_name: file.name, file_type: mime, file_size: file.size
      }, vault.owner, vault.key, vault.assertUnlocked)
      setForm(emptyForm); setFile(null); setUploadOpen(false); setMessage('Document saved.')
      await refresh()
    } catch (error) { setUploadError(errorMessage(error, 'Document upload failed.')) }
    finally { writing.current = false; setSaving(false) }
  }
  async function downloadDocument(item: PropertyDocument) {
    setDownloadingId(item.id); setMessage(''); setPreviewError('')
    const controller = new AbortController()
    downloadControllers.current.add(controller)
    try {
      vault.assertUnlocked()
      const blob = await readDocument(item, vault.owner, vault.key, controller.signal)
      if (!mounted.current) return
      vault.assertUnlocked()
      const url = URL.createObjectURL(blob)
      downloadUrls.current.add(url)
      const link = document.createElement('a')
      link.href = url; link.download = item.file_name
      document.body.appendChild(link); link.click(); link.remove()
      window.setTimeout(() => { URL.revokeObjectURL(url); downloadUrls.current.delete(url) }, 1000)
    } catch (error) {
      const text = errorMessage(error, 'Download failed. Please try again.')
      if (selected) setPreviewError(text)
      else setRecordError(text)
    } finally { downloadControllers.current.delete(controller); if (mounted.current) setDownloadingId(null) }
  }
  async function removeFile(item: PropertyDocument) {
    vault.assertUnlocked()
    const result = await supabase.storage.from(bucket).remove([item.file_path])
    if (result.error) throw result.error
    const queued = await supabase.from('document_file_cleanup').delete().eq('user_id', vault.owner).eq('file_path', item.file_path)
    if (queued.error) throw queued.error
  }
  async function cleanupQueuedFiles() {
    if (cleaningQueue.current) return
    cleaningQueue.current = true
    try {
      for (;;) {
        vault.assertUnlocked()
        const result = await supabase.from('document_file_cleanup').select('file_path').eq('user_id', vault.owner).limit(100)
        if (result.error) throw result.error
        let failures = 0
        for (const row of result.data ?? []) {
          if (!mounted.current) return
          try { await removeFile({ file_path: row.file_path } as PropertyDocument) } catch { failures++ }
        }
        if (!mounted.current) return
        setPendingCleanup(failures)
        if (failures || (result.data?.length ?? 0) < 100) break
      }
    } catch { if (mounted.current) setPendingCleanup(1) }
    finally { cleaningQueue.current = false }
  }
  async function encryptExistingDocuments() {
    if (writing.current) return
    writing.current = true; setSaving(true); setRecordError(''); setMessage('')
    let converted = 0
    try {
      for (const item of data.documents.filter(document => !document.encryption_version)) {
        vault.assertUnlocked()
        const blob = await readDocument(item, vault.owner, vault.key)
        vault.assertUnlocked()
        const metadata: DocumentMetadata = { title: item.title, category: item.category, document_date: item.document_date, notes: item.notes, file_name: item.file_name, file_type: blob.type, file_size: blob.size }
        await storeEncryptedDocument(blob, metadata, vault.owner, vault.key, vault.assertUnlocked, item)
        converted++
        // The database queued this original in the same transaction as the
        // replacement. A failure here remains visible and retryable next visit.
        try { await removeFile(item) } catch { setPendingCleanup(value => value + 1) }
      }
      setMessage(`${converted} ${converted === 1 ? 'document' : 'documents'} encrypted.`)
    } catch (cause) { setRecordError(errorMessage(cause, 'Encryption stopped. Unconverted originals were preserved.')) }
    finally { await refresh(); writing.current = false; if (mounted.current) setSaving(false) }
  }
  async function deleteDocument() {
    if (!deleting || writing.current) return
    const item = deleting
    writing.current = true; setSaving(true); setRecordError(''); setMessage(''); setDeleting(null)
    try {
      vault.assertUnlocked()
      // If deleting the record is denied, preserve the original file.
      const result = await supabase.from('property_documents').delete().eq('id', item.id).eq('user_id', vault.owner).select('id').single()
      if (result.error || !result.data) throw result.error ?? new Error('Document could not be removed. Refresh and try again.')
      if (selected?.id === item.id) setSelected(null)
      try { await removeFile(item); setMessage('Document removed.') }
      catch { setCleanup(item); setRecordError('The document record was removed, but its file could not be removed. Retry file cleanup below.') }
      await refresh()
    } catch (cause) { setRecordError(errorMessage(cause, 'Could not delete this document.')) }
    finally { writing.current = false; setSaving(false) }
  }
  async function retryCleanup() {
    if (!cleanup || writing.current) return
    writing.current = true; setSaving(true)
    try { await removeFile(cleanup); setCleanup(null); setRecordError(''); setMessage('Document file removed.') }
    catch (cause) { setRecordError(errorMessage(cause, 'File cleanup failed. Please try again.')) }
    finally { writing.current = false; setSaving(false) }
  }

  return <div className="page workspace-page files-page">
    <PageHeading title="Documents" detail={`${data.documents.length} estate files · All years`} action="Add document" onAction={() => { setUploadError(''); setUploadOpen(true) }} />
    <div className="document-vault-status"><span><ShieldCheck size={18} />Encrypted vault unlocked</span><button className="button-secondary" onClick={vault.lock}><LockKeyhole size={16} />Lock vault</button></div>
    {data.documents.some(item => !item.encryption_version) && <div className="document-security-notice"><p><strong>{data.documents.filter(item => !item.encryption_version).length} existing documents still need encryption.</strong> They remain in private storage until converted. Conversion verifies the encrypted copy, then removes the original.</p><button className="button-primary" disabled={saving} onClick={() => void encryptExistingDocuments()}>{saving ? 'Working...' : 'Encrypt existing documents'}</button></div>}
    {pendingCleanup > 0 && <div className="document-security-notice"><p role="alert">Some old document files still need removal. Encryption is incomplete until original-file cleanup succeeds.</p><button className="button-secondary" disabled={saving} onClick={() => void cleanupQueuedFiles()}>Retry queued file cleanup</button></div>}
    <Notice>{message}</Notice><Notice error>{recordError}</Notice>
    {cleanup && <button className="button-secondary" disabled={saving} onClick={() => void retryCleanup()}>Retry file cleanup</button>}
    <section className="workspace-filters" aria-label="Document filters"><div className="filter-row"><SearchField label="Search documents" placeholder="Search documents" value={search} onChange={setSearch} /><select className="field filter-select" aria-label="Filter document category" value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}><option value="">All categories</option>{categories.map(category => <option key={category}>{category}</option>)}</select></div></section>
    <div className="results-toolbar"><p aria-live="polite">{documents.length} {documents.length === 1 ? 'document' : 'documents'}{(search || categoryFilter) && <button className="text-button" onClick={() => { setSearch(''); setCategoryFilter('') }}>Clear filters</button>}</p><select className="sort-select" aria-label="Sort documents" value={sort} onChange={e => setSort(e.target.value)}><option value="recent">Newest first</option><option value="name">Name A-Z</option></select></div>
    <section className="file-list" aria-label="Saved documents">
      {documents.length ? documents.slice(0, limit).map(item => <article className="file-record" key={item.id}>
        <button className="file-open" onClick={() => setSelected(item)} aria-label={`Open ${item.title}`}><span className={`file-mark kind-${documentKind(item).toLowerCase()}`}>{documentKind(item) === 'Image' ? <ImageIcon size={23} /> : <FileText size={23} />}<span>{documentKind(item)}</span></span><span className="file-record-content"><strong>{item.title}</strong><span>{item.category}{item.document_date ? ` · ${displayDate(item.document_date)}` : ''}</span><span className="file-name">{item.file_name} · {formatSize(item.file_size)}</span></span><ChevronRight size={18} /></button>
        <div className="record-actions"><button className="icon-button" title="Download" aria-label={`Download ${item.title}`} disabled={!!downloadingId} onClick={() => void downloadDocument(item)}>{downloadingId === item.id ? <LoaderCircle size={18} className="animate-spin" /> : <Download size={18} />}</button><button className="icon-button danger" title="Delete" disabled={saving || !!cleanup} aria-label={`Delete ${item.title}`} onClick={() => setDeleting(item)}><Trash2 size={17} /></button></div>
      </article>) : <EmptyState title={data.documents.length ? 'No matching documents' : 'No documents yet'} detail={data.documents.length ? 'Try another title or category.' : 'Land records, receipts and agreements will appear here.'} action={data.documents.length ? 'Clear filters' : 'Add document'} onAction={() => data.documents.length ? (setSearch(''), setCategoryFilter('')) : setUploadOpen(true)} />}
      {documents.length > limit && <div className="records-more"><p>Showing {limit} of {documents.length} documents.</p><button className="button-secondary" onClick={() => setLimit(value => value + 40)}>Show more documents</button></div>}
    </section>
    <Sheet open={!!selected} title={selected?.title ?? 'Document'} onClose={() => setSelected(null)} wide>
      {selected && <div className="file-reader"><div className="reader-toolbar"><span className={`file-kind-label kind-${kind.toLowerCase()}`}>{kind}</span><span>{selected.category}</span><button className="button-secondary" disabled={!!downloadingId} onClick={() => void downloadDocument(selected)}><Download size={17} />{downloadingId ? 'Downloading...' : 'Download'}</button></div><p className="section-detail">Downloads are decrypted copies saved outside the vault. Store them somewhere private.</p>
        <Notice error>{previewError}</Notice>
        {previewError && !previewLoading && <button className="text-button" onClick={() => setRetry(retry + 1)}>Try again</button>}
        {previewLoading ? <div className="reader-loading" role="status"><LoaderCircle size={26} className="animate-spin" /><p>Opening document...</p></div> : previewUrl ? kind === 'Image' ? <div className="reader-canvas"><img src={previewUrl} alt={selected.title} /></div> : <Suspense fallback={<div className="reader-loading" role="status">Opening PDF reader...</div>}><PdfReader url={previewUrl} title={selected.title} /></Suspense> : !previewError && <EmptyState title="Preview unavailable for this file type" detail="Download the original file to open it." />}
        <details className="file-details" open><summary>File details</summary><dl className="detail-list"><div><dt>File name</dt><dd>{selected.file_name}</dd></div><div><dt>Size</dt><dd>{formatSize(selected.file_size)}</dd></div><div><dt>Document date</dt><dd>{selected.document_date ? displayDate(selected.document_date) : 'Not specified'}</dd></div><div><dt>Added</dt><dd>{displayDate(selected.created_at.slice(0, 10))}</dd></div>{selected.notes && <div><dt>Notes</dt><dd>{selected.notes}</dd></div>}</dl></details>
      </div>}
    </Sheet>
    <Sheet open={uploadOpen} title="Add document" onClose={() => setUploadOpen(false)} busy={saving}>
      <form className="workspace-form" onSubmit={saveDocument}><Notice error>{uploadError}</Notice><label className="file-upload"><Upload size={26} /><strong>{file ? file.name : 'Choose a document'}</strong><span>{file ? formatSize(file.size) : 'PDF, image, Word or Excel · up to 20 MB'}</span><input type="file" aria-label="Document file" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xls,.xlsx" onChange={e => setFile(e.target.files?.[0] ?? null)} required={!file} /></label><p className="section-detail">The file and all details below are encrypted before upload.</p><label className="label">Title <span className="optional">(optional)</span><input className="field" maxLength={255} value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} placeholder={file?.name.replace(/\.[^/.]+$/, '') || 'e.g. Land ownership record'} /></label><div className="form-pair"><label className="label">Category<select className="field" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>{categories.map(category => <option key={category}>{category}</option>)}</select></label><label className="label">Document date <span className="optional">(optional)</span><input className="field" type="date" value={form.document_date} onChange={e => setForm({ ...form, document_date: e.target.value })} /></label></div><label className="label">Notes <span className="optional">(optional)</span><textarea className="field" rows={3} maxLength={4000} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></label><div className="sheet-footer"><button type="button" className="button-secondary" disabled={saving} onClick={() => setUploadOpen(false)}>Cancel</button><button className="button-primary" disabled={saving}>{saving ? 'Encrypting & uploading...' : 'Save document'}</button></div></form>
    </Sheet>
    <ConfirmDialog open={!!deleting} title="Delete document?" onCancel={() => setDeleting(null)} onConfirm={() => void deleteDocument()}>This removes the saved file and its document record from your estate.</ConfirmDialog>
  </div>
}
