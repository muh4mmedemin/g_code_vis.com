import { useEffect, useState } from 'react';
import { useStore } from '@/state/store';
import {
  DEFAULT_STOCK_MATERIAL,
  STOCK_MATERIALS,
  TOOL_TYPES,
  getToolTypeInfo,
} from '@/core/constants';
import type { StockMaterialId, ToolType } from '@/core/types';

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

  const stock = useStore((s) => s.stock);
  const tool = useStore((s) => s.tool);
  const toolDiameter = tool.diameter;
  const voxelResolution = useStore((s) => s.voxelResolution);

  const [form, setForm] = useState<BlockForm>(DEFAULT_FORM);
  const [originMode, setOriginMode] = useState<OriginMode>('center');
  const [material, setMaterial] = useState<StockMaterialId>(DEFAULT_STOCK_MATERIAL);
  const [toolType, setToolType] = useState<ToolType>('flat');
  const [angle, setAngle] = useState(118);
  const [cornerRadius, setCornerRadius] = useState(1);
  const [tipDiameter, setTipDiameter] = useState(1);

  // Blok disaridan da kurulabilir (ornegin "Ornekler" menusunden bir CNC
  // programi secildiginde). O durumda alanlarin eski degerleri gostermesi
  // kullaniciyi yanlis yonlendirir; sahnedeki blok ile form hep ayni seyi
  // soylemeli.
  useEffect(() => {
    setForm({
      x: stock.size.x,
      y: stock.size.y,
      z: stock.size.z,
      toolDiameter,
      resolution: voxelResolution,
    });
    setOriginMode(stock.origin.x === 0 && stock.origin.y === 0 ? 'center' : 'corner');
    setMaterial(stock.material);
    setToolType(tool.type);
    if (tool.angle !== undefined) setAngle(tool.angle);
    if (tool.cornerRadius !== undefined) setCornerRadius(tool.cornerRadius);
    if (tool.tipDiameter !== undefined) setTipDiameter(tool.tipDiameter);
  }, [stock, tool, toolDiameter, voxelResolution]);

  if (mode !== 'cnc') return null;

  const update = (key: keyof BlockForm, raw: string) => {
    const value = Number(raw);
    setForm((prev) => ({ ...prev, [key]: Number.isFinite(value) ? value : prev[key] }));
  };

  const info = getToolTypeInfo(toolType);

  /** Takim tipi degisince o tipin tipik degerlerini forma doldur. */
  const changeToolType = (next: ToolType) => {
    setToolType(next);
    const defaults = getToolTypeInfo(next).defaults;
    if (defaults.diameter !== undefined) {
      setForm((prev) => ({ ...prev, toolDiameter: defaults.diameter as number }));
    }
    if (defaults.angle !== undefined) setAngle(defaults.angle);
    if (defaults.cornerRadius !== undefined) setCornerRadius(defaults.cornerRadius);
    if (defaults.tipDiameter !== undefined) setTipDiameter(defaults.tipDiameter);
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

    setTool({
      type: toolType,
      diameter: toolDiameter,
      fluteLength: info.defaults.fluteLength ?? 25,
      ...(info.needsAngle ? { angle } : {}),
      ...(info.needsCornerRadius ? { cornerRadius: Math.min(cornerRadius, toolDiameter / 2) } : {}),
      ...(info.needsTipDiameter ? { tipDiameter: Math.min(tipDiameter, toolDiameter) } : {}),
    });
    setVoxelResolution(resolution);
    // Yeni blok HAM halde gorunsun: simulasyonu basa sar. Kullanici "Baslat"
    // dediginde blok gozunun onunde islenir.
    pause();
    seekToMove(0);
    // Stok en son ayarlanir: viewer bunu blogu yeniden kurma sinyali sayar.
    setStock({ shape: 'box', size, origin, material });
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

      <label className="job-form__field job-form__field--wide">
        <span>Takim tipi</span>
        <select value={toolType} onChange={(e) => changeToolType(e.target.value as ToolType)}>
          {TOOL_TYPES.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      {(info.needsAngle || info.needsCornerRadius || info.needsTipDiameter) && (
        <div className="job-form__row">
          {info.needsAngle && (
            <label className="job-form__field">
              <span>Tepe acisi</span>
              <input
                type="number"
                value={angle}
                min={10}
                max={179}
                step={1}
                onChange={(e) => setAngle(Number(e.target.value) || angle)}
              />
            </label>
          )}
          {info.needsCornerRadius && (
            <label className="job-form__field">
              <span>Kose radyusu</span>
              <input
                type="number"
                value={cornerRadius}
                min={0}
                max={form.toolDiameter / 2}
                step={0.5}
                onChange={(e) => setCornerRadius(Number(e.target.value) || 0)}
              />
            </label>
          )}
          {info.needsTipDiameter && (
            <label className="job-form__field">
              <span>Uc capi</span>
              <input
                type="number"
                value={tipDiameter}
                min={0}
                max={form.toolDiameter}
                step={0.5}
                onChange={(e) => setTipDiameter(Number(e.target.value) || 0)}
              />
            </label>
          )}
        </div>
      )}

      <p className="tool-form__hint">{info.hint}</p>

      <label className="job-form__field job-form__field--wide">
        <span>Malzeme</span>
        <select
          value={material}
          onChange={(e) => setMaterial(e.target.value as StockMaterialId)}
        >
          {STOCK_MATERIALS.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <div className="material-swatches">
        {STOCK_MATERIALS.map((option) => (
          <button
            key={option.id}
            type="button"
            title={option.label}
            aria-label={option.label}
            aria-pressed={material === option.id}
            className={
              material === option.id ? 'material-swatch is-active' : 'material-swatch'
            }
            style={{ background: `#${option.color.toString(16).padStart(6, '0')}` }}
            onClick={() => setMaterial(option.id)}
          />
        ))}
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
