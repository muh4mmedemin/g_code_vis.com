import { useState } from 'react';
import { useStore } from '@/state/store';

interface SampleEntry {
  label: string;
  description: string;
  file: string;
}

const SAMPLES: SampleEntry[] = [
  {
    label: 'Katmanli kare',
    description: '3 katmanli basit FDM baskisi',
    file: 'kare-katmanli.gcode',
  },
  {
    label: 'Spiral vazo',
    description: 'Surekli yukselen tek cidarli govde',
    file: 'vazo-spiral.gcode',
  },
  {
    label: 'CNC cep frezeleme',
    description: 'Coklu derinlik gecisli cep + tarama pasosu',
    file: 'cnc-cep-frezeleme.gcode',
  },
];

/** Toolbar'daki "Ornekler" menusu: public/samples altindaki hazir dosyalari yukler. */
export function SampleMenu() {
  const [open, setOpen] = useState(false);
  const loadFile = useStore((s) => s.loadFile);

  const handleSelect = async (sample: SampleEntry) => {
    setOpen(false);
    const url = `${import.meta.env.BASE_URL}samples/${sample.file}`;
    const response = await fetch(url);
    const text = await response.text();
    const file = new File([text], sample.file, { type: 'text/plain' });
    void loadFile(file);
  };

  return (
    <div className="sample-menu">
      <button
        type="button"
        className="sample-menu__trigger"
        onClick={() => setOpen((v) => !v)}
      >
        📄 Ornekler
      </button>
      {open && (
        <div className="sample-menu__list" onMouseLeave={() => setOpen(false)}>
          {SAMPLES.map((sample) => (
            <button
              key={sample.file}
              type="button"
              className="sample-menu__item"
              onClick={() => void handleSelect(sample)}
            >
              <span>{sample.label}</span>
              <span className="sample-menu__item-desc">{sample.description}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
