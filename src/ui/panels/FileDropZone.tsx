import { useRef, useState } from 'react';
import { useStore } from '@/state/store';
import { ACCEPTED_EXTENSIONS, LARGE_FILE_WARNING_BYTES } from '@/core/constants';
import { formatBytes } from '@/utils/format';

/**
 * Drag & drop + dosya secici. ACCEPTED_EXTENSIONS'a gore filtreler,
 * LARGE_FILE_WARNING_BYTES ustunde uyari gosterir.
 * Dosya sunucuya GITMEZ; File.text() ile client tarafinda okunur (bkz.
 * documentSlice.loadFile).
 */
export function FileDropZone() {
  const loadFile = useStore((s) => s.loadFile);
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);

  const acceptAttr = ACCEPTED_EXTENSIONS.join(',');

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    const isAccepted = ACCEPTED_EXTENSIONS.some((ext) =>
      file.name.toLowerCase().endsWith(ext),
    );
    if (!isAccepted) {
      setWarning(`Desteklenmeyen uzanti. Beklenen: ${acceptAttr}`);
      return;
    }
    if (file.size > LARGE_FILE_WARNING_BYTES) {
      setWarning(`Buyuk dosya (${formatBytes(file.size)}) — parse suresi uzayabilir.`);
    } else {
      setWarning(null);
    }
    void loadFile(file);
  };

  return (
    <div
      className={`dropzone${isDragging ? ' dropzone--active' : ''}`}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        handleFile(e.dataTransfer.files[0]);
      }}
      title="G-code dosyasi ac (surukle-birak veya tikla)"
    >
      <span>📂 Dosya Ac</span>
      <input
        ref={inputRef}
        type="file"
        accept={acceptAttr}
        style={{ display: 'none' }}
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      {warning && <span className="dropzone__warning">{warning}</span>}
    </div>
  );
}
