import React, { lazy, Suspense } from 'react';
import { Card } from './UiKit';

// Lazy-load the recharts library and our chart implementations
const RechartsCharts = lazy(() => import('./Charts.impl'));

export function TrajectoryChart(props) {
  return (
    <Suspense fallback={<Card className="ui-chart-skeleton" style={{ height: props.height || 200, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)' }}>Loading chart...</Card>}>
      <RechartsCharts.TrajectoryChart {...props} />
    </Suspense>
  );
}

export function RadarHealthChart(props) {
  return (
    <Suspense fallback={<Card className="ui-chart-skeleton" style={{ height: props.height || 300, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)' }}>Loading chart...</Card>}>
      <RechartsCharts.RadarHealthChart {...props} />
    </Suspense>
  );
}
