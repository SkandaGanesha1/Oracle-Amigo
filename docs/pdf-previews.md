# Local PDF Previews

Oracle Amigo renders local chat PDF attachments through the local-agent storage service. Chat payloads store only preview status and metadata; browser-visible PDF and thumbnail URLs are short-lived signed URLs.

## Runtime Pieces

- Frontend viewer: `pdfjs-dist`, loaded only when a user opens a PDF.
- Thumbnail renderer: Poppler `pdftoppm` renders page 1 to PNG, then `sharp` writes `thumb_360.webp` and `thumb_720.webp`.
- Storage root: `AGENTIC_STORAGE_ROOT`, defaulting to the local AgenticApp storage folder.
- Preview directory: `<storage-root>/previews/<file-id>/`.

## Environment

- `PDF_PREVIEW_MAX_BYTES`: maximum PDF size accepted for preview generation. Default: `26214400` bytes.
- `PDF_PREVIEW_RENDER_TIMEOUT_MS`: Poppler render timeout. Default: `15000`.
- `FILE_PREVIEW_SIGNING_SECRET`: HMAC secret for stable signed URLs across local-agent restarts. Use at least 32 characters. If omitted, a process-local secret is generated and all old signed URLs expire on restart.

## Poppler

Install Poppler so `pdftoppm` is available on `PATH`.

Windows options include Chocolatey, Scoop, or a packaged Poppler build. After installation, restart the shell or dev server so the updated `PATH` is visible.

If Poppler is missing, PDFs remain visible as attachment cards and downloads still work, but preview generation records a failed state instead of showing a thumbnail.

## Security Model

- Only files already stored in `received_files` are previewed.
- Files must be under the configured local storage root.
- Files must use `.pdf`, fit the configured size limit, start with `%PDF-`, and match their stored SHA-256.
- Thumbnail and viewer routes require local UI access plus a short-lived HMAC signature.
- Signed URLs are never persisted in chat message payloads.
- Blocked or failed validations prevent thumbnail/view access.

## Local API

- `GET /storage/files/:id/preview`
- `GET /storage/files/:id/thumbnail-url?variant=360|720`
- `GET /storage/files/:id/viewer-url`
- `GET /storage/files/:id/thumbnail?variant=360|720&expires=...&sig=...`
- `GET /storage/files/:id/view?expires=...&sig=...`

Existing `/storage/files/:id/open` and `/storage/files/:id/download` routes remain available for compatibility.
