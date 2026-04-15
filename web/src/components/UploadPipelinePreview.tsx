import { DirectBlobUploadCard } from './DirectBlobUploadCard'
import type { MediaKind } from '../lib/media-upload'

interface UploadCardDefinition {
  accept: string
  description: string
  helperText: string
  kind: MediaKind
  title: string
}

const uploadCards: UploadCardDefinition[] = [
  {
    kind: 'image',
    title: 'Image upload',
    accept: 'image/avif,image/jpeg,image/png,image/webp',
    description:
      'Requests a signed SAS URL from the API, then streams the still image directly into the images container.',
    helperText: 'AVIF, JPEG, PNG, or WebP up to 8 MB.',
  },
  {
    kind: 'gif',
    title: 'GIF upload',
    accept: 'image/gif',
    description:
      'Exercises the same direct-to-blob path for GIF payloads without waiting for composer attachment UI.',
    helperText: 'GIF up to 8 MB.',
  },
  {
    kind: 'audio',
    title: 'Audio upload',
    accept: 'audio/mp4,audio/mpeg,audio/ogg,audio/wav,audio/webm',
    description:
      'Uploads supported audio formats to Blob Storage and reports byte-level progress from the browser.',
    helperText: 'M4A, MP3, OGG, WAV, or WebM up to 25 MB.',
  },
  {
    kind: 'video',
    title: 'Video upload',
    accept: 'video/mp4,video/quicktime,video/webm',
    description:
      'Uses the same signed upload contract for larger video payloads before post attachments are wired in.',
    helperText: 'MP4, MOV, or WebM up to 100 MB.',
  },
]

export function UploadPipelinePreview() {
  return (
    <section className="mt-6 rounded-[1.75rem] border border-white/10 bg-slate-900/70 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.24em] text-sky-100/80">
            Direct upload pipeline
          </p>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-400">
            This issue lands the shared browser primitive for media uploads:
            fetch signs `POST /api/media/upload-url`, then XHR streams the file
            directly to the SAS URL so progress stays visible in the SPA.
          </p>
          <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-500">
            Composer attachment previews and avatar/banner persistence arrive in
            later issues, but they can reuse these same request and upload
            mechanics without reworking the storage contract.
          </p>
        </div>

        <span className="rounded-full border border-sky-300/20 bg-sky-300/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.2em] text-sky-100">
          Issue #56
        </span>
      </div>

      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        {uploadCards.map((card) => (
          <DirectBlobUploadCard
            key={card.kind}
            accept={card.accept}
            description={card.description}
            helperText={card.helperText}
            kind={card.kind}
            title={card.title}
          />
        ))}
      </div>
    </section>
  )
}
