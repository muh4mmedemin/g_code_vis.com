import { useState } from 'react';
import { useStore } from '@/state/store';

/**
 * CNC modunda ham malzeme (stok) blogu paneli.
 *
 * ATOLYEDEKI SIRA: once testereden holder olculerinde tam dolu bir blok
 * kesilir, sonra o blok CNC'ye baglanip G-code ile islenir. Bu panel ilk
 * adimi yapar: olculeri girip "Blok olustur" deyince sahnede TAM DOLU bir
 * blok belirir. Editordeki G-code, simulasyon oynatildikca bu bloktan
 * talas kaldirir (cep acar, delik deler).
 */

const ORIGIN_MODES = [
  { id: 'center', label: 'Merkez' },
  { id: 'corner', label: 'Sol-on kose' },
] as const;

type OriginMode = (typeof ORIGIN_MODES)[number]['id'];

interface BlockForm {
  x: number;
  y: number;
  z: number;
  toolDiameter: number;
  resolution: number;
}

const DEFAULT_FORM: BlockForm = {
  x: 40,
  y: 50,
  z: 70,
  toolDiameter: 6,
  resolution: 140,
};

const LIMITS: Record<keyof BlockForm, { min: number; max: number; step: number }> = {
  x: { min: 1, max: 500, step: 1 },
  y: { min: 1, max: 500, step: 1 },
  z: { min: 1, max: 500, step: 1 },
  toolDiameter: { min: 0.2, max: 50, step: 0.5 },
  resolution: { min: 32, max: 320, step: 10 },
};

function clampField(key: keyof BlockForm, value: number): number {
  const { min, max } = LIMITS[key];
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function MachineModePanel() {
  const mode = useStore((s) => s.mode);
  const setStock = useStore((s) => s.setStock);
  const setTool = useStore((s) => s.setTool);
  const setVoxelResolution = useStore((s) => s.setVoxelResolution);
  const seekToMove = useStore((s) => s.seekToMove);
  const pause = useStore((s) => s.pause);

  const [form, setForm] = useState<BlockForm>(DEFAULT_FORM);
  const [originMode, setOriginMode] = useState<OriginMode>('center');

  if (mode !== 'cnc') return null;

  const update = (key: keyof BlockForm, raw: string) => {
    const value = Number(raw);
    setForm((prev) => ({ ...prev, [key]: Number.isFinite(value) ? value : prev[key] }));
  };

  const handleCreate = () => {
    const size = {
      x: clampField('x', form.x),
      y: clampField('y', form.y),
      z: clampField('z', form.z),
    };
    const resolution = clampField('resolution', form.resolution);
    const toolDiameter = clampField('toolDiameter', form.toolDiameter);
    setForm({ ...size, toolDiameter, resolution });

    // Sifir noktasi: "merkez"de blok origin'de ortalanir; "sol-on kose"de
    // G-code'un X0 Y0'i blogun sol-on kosesine denk gelir.
    const origin =
      originMode === 'center'
        ? { x: 0, y: 0, z: 0 }
        : { x: size.x / 2, y: size.y / 2, z: 0 };

    setTool({ diameter: toolDiameter });
    setVoxelResolution(resolution);
    // Yeni blok HAM halde gorunsun: simulasyonu basa sar. Kullanici "Baslat"
    // dediginde blok gozunun onunde islenir.
    pause();
    seekToMove(0);
    // Stok en son ayarlanir: viewer bunu blogu yeniden kurma sinyali sayar.
    setStock({ shape: 'box', size, origin });
  };

  const field = (key: keyof BlockForm, label: string) => (
    <label key={key} className="job-form__field">
      <span>{label}</span>
      <input
        type="number"
        value={form[key]}
        min={LIMITS[key].min}
        max={LIMITS[key].max}
        step={LIMITS[key].step}
        onChange={(e) => update(key, e.target.value)}
      />
    </label>
  );

  return (
    <div className="panel panel--machine-mode">
      <div className="panel__title">Ham blok (stok)</div>

      <div className="job-form__row">
        {field('x', 'X (mm)')}
        {field('y', 'Y (mm)')}
        {field('z', 'Z (mm)')}
      </div>

      <div className="job-form__row">
        {field('toolDiameter', 'Takim capi')}
        {field('resolution', 'Cozunurluk')}
      </div>

      <div className="job-form__row job-form__row--origin">
        <span className="job-form__label">Sifir noktasi</span>
        <div className="segmented">
          {ORIGIN_MODES.map((option) => (
            <button
              key={option.id}
              type="button"
              className={
                originMode === option.id ? 'segmented__btn is-active' : 'segmented__btn'
              }
              onClick={() => setOriginMode(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <button type="button" className="job-form__submit" onClick={handleCreate}>
        Blok olustur
      </button>

      <p className="job-form__hint">
        Blok tam dolu baslar; ust yuzeyi Z=0'dir. Editordeki G-code oynatildikca
        kesme hareketleri (G1/G2/G3) bloktan talas kaldirir.
      </p>
    </div>
  );
}
