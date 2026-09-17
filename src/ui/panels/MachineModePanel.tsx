import { useState } from 'react';
import { useStore } from '@/state/store';
import {
  CUBE_JOB_LIMITS,
  DEFAULT_CUBE_JOB,
  generateCubeGcode,
  normalizeCubeJob,
  type CubeJobOptions,
} from '@/gcode/generators/cube';

type NumericField = keyof CubeJobOptions;

interface FieldSpec {
  key: NumericField;
  label: string;
  step: number;
}

const PART_FIELDS: FieldSpec[] = [
  { key: 'width', label: 'X (mm)', step: 1 },
  { key: 'depth', label: 'Y (mm)', step: 1 },
  { key: 'height', label: 'Z (mm)', step: 1 },
];

const TOOL_FIELDS: FieldSpec[] = [
  { key: 'toolDiameter', label: 'Takim capi (mm)', step: 0.5 },
  { key: 'stepDown', label: 'Paso (mm)', step: 0.5 },
];

/**
 * CNC modunda parametrik is parcasi olusturma paneli.
 *
 * Kullanici olculeri girer, uretilen G-code dogrudan editore yazilir ve
 * normal akista (parse -> 3D -> simulasyon) gorsellestirilir.
 */
export function MachineModePanel() {
  const mode = useStore((s) => s.mode);
  const setSource = useStore((s) => s.setSource);
  const reparse = useStore((s) => s.reparse);
  const setStock = useStore((s) => s.setStock);
  const setTool = useStore((s) => s.setTool);

  const [job, setJob] = useState<CubeJobOptions>(DEFAULT_CUBE_JOB);

  if (mode !== 'cnc') return null;

  const update = (key: NumericField, raw: string) => {
    const value = Number(raw);
    setJob((prev) => ({ ...prev, [key]: Number.isFinite(value) ? value : prev[key] }));
  };

  const handleCreate = () => {
    const normalized = normalizeCubeJob(job);
    setJob(normalized);
    // Ham malzeme ve takim tanimini da guncelle (voxel asamasinda kullanilacak).
    setStock({ size: { x: normalized.width, y: normalized.depth, z: normalized.height } });
    setTool({ diameter: normalized.toolDiameter });
    setSource(generateCubeGcode(normalized));
    void reparse();
  };

  const renderField = ({ key, label, step }: FieldSpec) => {
    const limits = CUBE_JOB_LIMITS[key];
    return (
      <label key={key} className="job-form__field">
        <span>{label}</span>
        <input
          type="number"
          value={job[key]}
          min={limits.min}
          max={limits.max}
          step={step}
          onChange={(e) => update(key, e.target.value)}
        />
      </label>
    );
  };

  return (
    <div className="panel panel--machine-mode">
      <div className="panel__title">Kup is parcasi</div>
      <div className="job-form__row">{PART_FIELDS.map(renderField)}</div>
      <div className="job-form__row">{TOOL_FIELDS.map(renderField)}</div>
      <button type="button" className="job-form__submit" onClick={handleCreate}>
        Olustur
      </button>
      <p className="job-form__hint">
        Kontur, bitmis olcu tam ciksin diye takim yaricapi kadar disari otelenir.
      </p>
    </div>
  );
}
