import type { ReactNode } from 'react';

/**
 * Surukle-birak ile yeniden boyutlandirilabilir ikiye bolunmus yerlesim.
 * Varsayilan: %50 / %50. Oran localStorage'a yazilmali.
 * TODO(sonnet): react-resizable-panels ile implementasyon + mobilde
 * sekme (tab) moduna dusme.
 */
export interface SplitLayoutProps {
  left: ReactNode;
  right: ReactNode;
  defaultRatio?: number;
}

export function SplitLayout({ left, right }: SplitLayoutProps) {
  return (
    <div className="split-layout">
      <div className="split-pane split-pane--left">{left}</div>
      <div className="split-handle" role="separator" aria-orientation="vertical" />
      <div className="split-pane split-pane--right">{right}</div>
    </div>
  );
}
