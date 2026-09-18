import { useState } from 'react';
import { useStore } from '@/state/store';
import type { MachineMode, StockDefinition, Vec3 } from '@/core/types';

interface SampleEntry {
  label: string;
  description: string;
  file: string;
  /** Yuklendiginde makine modunu da bu deger otomatik ayarlanir. */
  mode: MachineMode;
  /**
   * CNC ornekleri icin ham blok: ornek secildiginde bu olculerde TAM DOLU
   * bir blok kurulur ve program onu isler.
   */
  stock?: { size: Vec3; origin: Vec3; toolDiameter: number };
}

const SAMPLES: SampleEntry[] = [
  {
    label: 'Katmanli kare',
    description: '3 katmanli basit FDM baskisi',
    file: 'kare-katmanli.gcode',
    mode: 'print',
  },
  {
    label: 'Spiral vazo',
    description: 'Surekli yukselen tek cidarli govde',
    file: 'vazo-spiral.gcode',
    mode: 'print',
  },
  {
    label: 'Dolu kup',
    description: '%100 dolgulu, kenarlari tam dolu katiki kup',
    file: 'dolu-kup.gcode',
    mode: 'print',
  },
  {
    label: 'Yay (G2/G3)',
    description: 'Yuvarlatilmis kutu, daire ve yukselen helis',
    file: 'yay-g2g3.gcode',
    mode: 'print',
  },
  {
    label: 'Holder (blok isleme)',
    description: '40x50x70 bloktan konnektor cebi + vida delikleri',
    file: 'holder-cnc.gcode',
    mode: 'cnc',
    stock: {
      size: { x: 40, y: 50, z: 70 },
      origin: { x: 0, y: 0, z: 0 },
      toolDiameter: 6,
    },
  },
  {
    label: 'Holder (konnektor yuvasi)',
    description: '45x60x80 derlin blok: cep, 4 vida deligi, kablo kanali, pah',
    file: 'holder-konnektor.gcode',
    mode: 'cnc',
    stock: {
      size: { x: 45, y: 60, z: 80 },
      origin: { x: 0, y: 0, z: 0 },
      toolDiameter: 6,
    },
  },
  {
    label: 'Delik tablasi (G81/G83)',
    description: 'Delme cevrimleri: civata dairesi, gagalamali derin delik, havsa',
    file: 'cnc-delik-tablasi.gcode',
    mode: 'cnc',
    stock: {
      size: { x: 100, y: 80, z: 12 },
      origin: { x: 0, y: 0, z: 0 },
      toolDiameter: 6,
    },
  },
  {
    label: 'Modal kontur',
    description: 'Komut sozcugu tekrarlamayan tezgah kodu: kontur + kanal',
    file: 'cnc-modal-kontur.gcode',
    mode: 'cnc',
    stock: {
      size: { x: 80, y: 60, z: 15 },
      origin: { x: 0, y: 0, z: 0 },
      toolDiameter: 6,
    },
  },
  {
    label: 'Helisel dalisli cep',
    description: 'Helis ile dalis, spiral tarama ve mutlak yay merkezi (G90.1)',
    file: 'cnc-helis-cep.gcode',
    mode: 'cnc',
    stock: {
      size: { x: 70, y: 70, z: 20 },
      origin: { x: 0, y: 0, z: 0 },
      toolDiameter: 6,
    },
  },
  {
    label: 'Inc program (G20)',
    description: '3x2x0.5 inc blok: inc birimli cep ve delikler',
    file: 'cnc-inc-program.gcode',
    mode: 'cnc',
    stock: {
      size: { x: 76.2, y: 50.8, z: 12.7 },
      origin: { x: 0, y: 0, z: 0 },
      toolDiameter: 6.35,
    },
  },
  {
    label: 'CNC cep frezeleme',
    description: 'Coklu derinlik gecisli cep + tarama pasosu',
    file: 'cnc-cep-frezeleme.gcode',
    mode: 'cnc',
    stock: {
      size: { x: 70, y: 50, z: 20 },
      origin: { x: 30, y: 20, z: 0 },
      toolDiameter: 6,
    },
  },
];

/** Toolbar'daki "Ornekler" menusu: public/samples altindaki hazir dosyalari yukler. */
export function SampleMenu() {
  const [open, setOpen] = useState(false);
  const loadFile = useStore((s) => s.loadFile);
  const setMode = useStore((s) => s.setMode);
  const setStock = useStore((s) => s.setStock);
  const setTool = useStore((s) => s.setTool);

  const handleSelect = async (sample: SampleEntry) => {
    setOpen(false);
    const url = `${import.meta.env.BASE_URL}samples/${sample.file}`;
    const response = await fetch(url);
    const text = await response.text();
    const file = new File([text], sample.file, { type: 'text/plain' });
    setMode(sample.mode);
    if (sample.stock) {
      setTool({ diameter: sample.stock.toolDiameter });
      const stock: StockDefinition = {
        shape: 'box',
        size: sample.stock.size,
        origin: sample.stock.origin,
      };
      setStock(stock);
    }
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
