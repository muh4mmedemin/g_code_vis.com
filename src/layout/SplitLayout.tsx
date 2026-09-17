import type { ReactNode } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';

/**
 * Surukle-birak ile yeniden boyutlandirilabilir ikiye bolunmus yerlesim.
 * Oran react-resizable-panels tarafindan localStorage'a otomatik yazilir
 * (autoSaveId), boylece sayfa yenilendiginde son oran korunur.
 */
export interface SplitLayoutProps {
  left: ReactNode;
  right: ReactNode;
  defaultRatio?: number;
}

export function SplitLayout({ left, right, defaultRatio = 50 }: SplitLayoutProps) {
  return (
    <PanelGroup direction="horizontal" autoSaveId="gcode-split-layout" className="split-layout">
      <Panel defaultSize={defaultRatio} minSize={20} className="split-pane split-pane--left">
        {left}
      </Panel>
      <PanelResizeHandle className="split-handle" />
      <Panel minSize={20} className="split-pane split-pane--right">
        {right}
      </Panel>
    </PanelGroup>
  );
}
