import React from 'react';
import { TrajectoryChart as TrajectoryChartImpl, RadarHealthChart as RadarHealthChartImpl } from './Charts.impl';

export function TrajectoryChart(props) {
  return (
    <TrajectoryChartImpl {...props} />
  );
}

export function RadarHealthChart(props) {
  return (
    <RadarHealthChartImpl {...props} />
  );
}
