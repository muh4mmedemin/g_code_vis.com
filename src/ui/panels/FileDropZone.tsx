/**
 * Drag & drop + dosya secici. ACCEPTED_EXTENSIONS'a gore filtreler,
 * LARGE_FILE_WARNING_BYTES ustunde uyari gosterir.
 * Dosya sunucuya GITMEZ; FileReader ile client tarafinda okunur.
 * TODO(sonnet).
 */
export function FileDropZone() {
  return <div className="dropzone" data-placeholder="FileDropZone: TODO" />;
}
