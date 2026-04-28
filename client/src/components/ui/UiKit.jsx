import React, { useState, useEffect } from 'react';
import clsx from 'clsx';
import { 
  ResponsiveContainer, AreaChart, Area, XAxis, Tooltip, 
  Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis 
} from 'recharts';
import { TrendingUp, TrendingDown, Loader2, Check, Inbox, Search } from 'lucide-react';
import './UiKit.css';

// ── CORE COMPONENTS ───────────────────────────────────────

export function PageLoader({ text = "Loading..." }) {
  return (
    <div className="ui-page-loader">
      <Loader2 size={32} className="ui-spinner-anim" />
      <p>{text}</p>
    </div>
  );
}

export function EmptyState({ icon: Icon = Inbox, title, description, action }) {
  return (
    <div className="ui-empty-state">
      <div className="ui-empty-icon-wrapper">
        <Icon size={32} className="ui-empty-icon" />
      </div>
      <h3 className="ui-empty-title">{title}</h3>
      {description && <p className="ui-empty-desc">{description}</p>}
      {action && <div className="ui-empty-action">{action}</div>}
    </div>
  );
}

export function Card({ children, className, ...props }) {
  return (
    <div className={clsx('ui-card', className)} {...props}>
      {children}
    </div>
  );
}

export function ActionBtn({ children, className, isLoading: externalLoading, isSuccess: externalSuccess, variant = 'primary', icon: Icon, onClick, ...props }) {
  const [internalLoading, setInternalLoading] = useState(false);
  const [internalSuccess, setInternalSuccess] = useState(false);
  
  const isLoading = externalLoading || internalLoading;
  const isSuccess = externalSuccess || internalSuccess;

  useEffect(() => {
    if (isSuccess) {
      setInternalSuccess(true);
      const timer = setTimeout(() => {
        if (typeof externalSuccess === 'undefined') setInternalSuccess(false);
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [isSuccess, externalSuccess]);

  const handleClick = async (e) => {
    if (!onClick) return;
    const result = onClick(e);
    if (result instanceof Promise) {
      setInternalLoading(true);
      try {
        await result;
        setInternalSuccess(true);
      } catch (err) {
        console.error('Action error', err);
      } finally {
        setInternalLoading(false);
      }
    }
  };

  return (
    <button 
      className={clsx('btn', `btn-${variant}`, 'ui-action-btn', className, { 'ui-btn-loading': isLoading, 'ui-btn-success': isSuccess })}
      onClick={handleClick}
      disabled={isLoading || isSuccess || props.disabled}
      {...props}
    >
      <span className="ui-btn-content">
        {Icon && !isLoading && !isSuccess && <Icon size={16} className="ui-btn-icon" />}
        <span className="ui-btn-text">{children}</span>
      </span>
      
      {isLoading && (
        <span className="ui-btn-overlay">
          <Loader2 size={18} className="ui-spinner-anim" />
        </span>
      )}
      
      {isSuccess && (
        <span className="ui-btn-overlay">
          <Check size={18} className="ui-success-anim" />
        </span>
      )}
      <span className="ui-btn-ripple" />
    </button>
  );
}

export function MetricCard({ title, value, trend, trendValue, icon: Icon, intent = 'neutral' }) {
  return (
    <Card className={clsx('ui-metric-card', `ui-intent-${intent}`)}>
      <div className="ui-metric-header">
        <span className="ui-metric-title">{title}</span>
        {Icon && <Icon className="ui-metric-icon" size={18} />}
      </div>
      <div className="ui-metric-body">
        <span className="ui-metric-value">{value}</span>
      </div>
      {(trend || trendValue) && (
        <div className={clsx('ui-metric-footer', trend === 'up' ? 'text-positive' : trend === 'down' ? 'text-negative' : '')}>
          {trend === 'up' ? <TrendingUp size={14} /> : trend === 'down' ? <TrendingDown size={14} /> : null}
          <span>{trendValue}</span>
        </div>
      )}
    </Card>
  );
}

export function Badge({ children, intent = 'default', size = 'md' }) {
  return (
    <span className={clsx('ui-badge', `ui-badge-${intent}`, `ui-badge-${size}`)}>
      {children}
    </span>
  );
}

// ── DATA VISUALS ──────────────────────────────────────────

export function ProgressRing({ percentage, size = 120, strokeWidth = 10, label, sublabel, color = 'var(--accent-primary)' }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (percentage / 100) * circumference;

  return (
    <div className="ui-progress-ring-container" style={{ width: size, height: size }}>
      <svg className="ui-progress-ring" width={size} height={size}>
        <circle
          className="ui-ring-bg"
          stroke="var(--bg-glass-strong)"
          strokeWidth={strokeWidth}
          fill="transparent"
          r={radius}
          cx={size / 2}
          cy={size / 2}
        />
        <circle
          className="ui-ring-fill"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeDasharray={`${circumference} ${circumference}`}
          style={{ strokeDashoffset: offset }}
          strokeLinecap="round"
          fill="transparent"
          r={radius}
          cx={size / 2}
          cy={size / 2}
        />
      </svg>
      <div className="ui-ring-content">
        <span className="ui-ring-label">{label || `${percentage}%`}</span>
        {sublabel && <span className="ui-ring-sublabel">{sublabel}</span>}
      </div>
    </div>
  );
}

export function TrajectoryChart({ data, height = 200, color = 'var(--accent-primary)', dataKey = 'value' }) {
  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 10, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={`color-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={color} stopOpacity={0.3}/>
              <stop offset="95%" stopColor={color} stopOpacity={0}/>
            </linearGradient>
          </defs>
          <Tooltip 
            contentStyle={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-subtle)', borderRadius: '8px' }}
            itemStyle={{ color: 'var(--text-primary)' }}
          />
          <Area 
            type="monotone" 
            dataKey={dataKey} 
            stroke={color} 
            strokeWidth={3}
            fillOpacity={1} 
            fill={`url(#color-${dataKey})`} 
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function RadarHealthChart({ data, height = 300 }) {
  // data format: [{ subject: 'Math', A: 120, fullMark: 150 }, ...]
  return (
    <div style={{ width: '100%', height }}>
      <ResponsiveContainer>
        <RadarChart cx="50%" cy="50%" outerRadius="80%" data={data}>
          <PolarGrid stroke="var(--border-subtle)" />
          <PolarAngleAxis dataKey="subject" tick={{ fill: 'var(--text-secondary)', fontSize: 12 }} />
          <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
          <Radar 
            name="Health" 
            dataKey="value" 
            stroke="var(--accent-primary)" 
            strokeWidth={2}
            fill="var(--accent-primary)" 
            fillOpacity={0.4} 
          />
          <Tooltip 
             contentStyle={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-subtle)', borderRadius: '8px' }}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
