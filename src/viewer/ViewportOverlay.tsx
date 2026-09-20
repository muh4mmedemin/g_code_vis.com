import { LayerSlider } from '@/ui/panels/LayerSlider';
import { PlaybackControls } from '@/ui/panels/PlaybackControls';
import { ViewOptionsPanel } from '@/ui/panels/ViewOptionsPanel';
import { StatsPanel } from '@/ui/panels/StatsPanel';
import { MachineModePanel } from '@/ui/panels/MachineModePanel';

/** Canvas uzerine binen, pointer-events secici sekilde acilan UI katmani. */
export function ViewportOverlay() {
  return (
    <div className="viewport-overlay">
      <div className="overlay-slot overlay-slot--top-right">
        <ViewOptionsPanel />
        <MachineModePanel />
        <StatsPanel />
      </div>
      <div className="overlay-slot overlay-slot--left">
        <LayerSlider />
      </div>
      <div className="overlay-slot overlay-slot--bottom">
        <PlaybackControls />
      </div>
    </div>
  );
}
