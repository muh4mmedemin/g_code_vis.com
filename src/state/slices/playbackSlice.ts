/** Katman slider'i + simulasyon durumu (Faz 2-3). */
export interface PlaybackSlice {
  isPlaying: boolean;
  speed: number;
  /** Gorunur en ust katman. */
  visibleLayer: number;
  /** Izole modda gorunur en alt katman. */
  minVisibleLayer: number;
  /** Simulasyon imleci (hareket indeksi). */
  moveCursor: number;

  play(): void;
  pause(): void;
  stepForward(n?: number): void;
  stepBackward(n?: number): void;
  seekToMove(index: number): void;
  seekToTime(seconds: number): void;
  setVisibleLayer(index: number): void;
  setSpeed(speed: number): void;
}

/** TODO(sonnet): createPlaybackSlice + rAF tabanli ilerleme dongusu. */
