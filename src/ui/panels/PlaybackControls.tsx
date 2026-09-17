import { useStore } from '@/state/store';
import { PLAYBACK_SPEEDS } from '@/core/constants';

/**
 * Simulasyon kontrolleri (Faz 3): play/pause, basa sar, adim ileri/geri,
 * hiz secici, timeline scrubber. Gercek ilerleme viewer/Viewport.tsx
 * icindeki rAF dongusunde hesaplanir; burasi yalnizca store'u okur/yazar.
 */
export function PlaybackControls() {
  const parseResult = useStore((s) => s.parseResult);
  const isPlaying = useStore((s) => s.isPlaying);
  const speed = useStore((s) => s.speed);
  const moveCursor = useStore((s) => s.moveCursor);
  const play = useStore((s) => s.play);
  const pause = useStore((s) => s.pause);
  const stepForward = useStore((s) => s.stepForward);
  const stepBackward = useStore((s) => s.stepBackward);
  const seekToMove = useStore((s) => s.seekToMove);
  const setSpeed = useStore((s) => s.setSpeed);

  const total = parseResult?.moves.length ?? 0;
  if (total === 0) return null;

  const cursorInt = Math.min(total, Math.round(moveCursor));

  return (
    <div className="panel panel--playback">
      <div className="playback__buttons">
        <button
          type="button"
          className="playback__btn"
          title="Basa sar"
          onClick={() => {
            pause();
            seekToMove(0);
          }}
        >
          ⏮
        </button>
        <button
          type="button"
          className="playback__btn"
          title="Geri adim"
          onClick={() => stepBackward(1)}
        >
          ⏪
        </button>
        <button
          type="button"
          className="playback__btn playback__btn--main"
          title={isPlaying ? 'Duraklat' : 'Baslat'}
          onClick={() => (isPlaying ? pause() : play())}
        >
          {isPlaying ? '⏸' : '▶'}
        </button>
        <button
          type="button"
          className="playback__btn"
          title="Ileri adim"
          onClick={() => stepForward(1)}
        >
          ⏩
        </button>

        <select
          className="playback__speed"
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
          title="Oynatma hizi"
        >
          {PLAYBACK_SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}x
            </option>
          ))}
        </select>
      </div>

      <input
        type="range"
        className="playback__scrubber"
        min={0}
        max={total}
        value={cursorInt}
        onChange={(e) => seekToMove(Number(e.target.value))}
      />
      <span className="playback__counter">
        {cursorInt}/{total}
      </span>
    </div>
  );
}
