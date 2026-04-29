import React, { useState, useEffect } from 'react';
import clsx from 'clsx';

import { TrendingUp, TrendingDown, Loader2, Check, Inbox, Search } from 'lucide-react';
import './UiKit.css';

// ── CORE COMPONENTS ───────────────────────────────────────

export function PageLoader({ text = "Loading..." }) {
  return (
    <div className="ui-page-loader" role="status" aria-live="polite" aria-label={text}>
      <Loader2 size={32} className="ui-spinner-anim" aria-hidden="true" />
      <p>{text}</p>
    </div>
  );
}

export function EmptyState({ icon: Icon = Inbox, title, description, action }) {
  return (
    <div className="ui-empty-state" role="status" aria-label={title}>
      <div className="ui-empty-icon-wrapper" aria-hidden="true">
        <Icon size={32} className="ui-empty-icon" />
      </div>
      <h3 className="ui-empty-title">{title}</h3>
      {description && <p className="ui-empty-desc">{description}</p>}
      {action && <div className="ui-empty-action">{action}</div>}
    </div>
  );
}

export function Card({ children, className, as: Tag = 'div', ...props }) {
  return (
    <Tag className={clsx('ui-card', className)} {...props}>
      {children}
    </Tag>
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

  const ariaLabel = isLoading ? 'Loading...' : isSuccess ? 'Done' : undefined;

  return (
    <button 
      className={clsx('btn', `btn-${variant}`, 'ui-action-btn', className, { 'ui-btn-loading': isLoading, 'ui-btn-success': isSuccess })}
      onClick={handleClick}
      disabled={isLoading || isSuccess || props.disabled}
      aria-busy={isLoading}
      aria-label={ariaLabel}
      {...props}
    >
      <span className="ui-btn-content">
        {Icon && !isLoading && !isSuccess && <Icon size={16} className="ui-btn-icon" aria-hidden="true" />}
        <span className="ui-btn-text">{children}</span>
      </span>
      
      {isLoading && (
        <span className="ui-btn-overlay" aria-hidden="true">
          <Loader2 size={18} className="ui-spinner-anim" />
        </span>
      )}
      
      {isSuccess && (
        <span className="ui-btn-overlay" aria-hidden="true">
          <Check size={18} className="ui-success-anim" />
        </span>
      )}
      <span className="ui-btn-ripple" aria-hidden="true" />
    </button>
  );
}

export function MetricCard({ title, value, trend, trendValue, icon: Icon, intent = 'neutral' }) {
  const trendText = trend === 'up' ? 'trending up' : trend === 'down' ? 'trending down' : '';
  const fullLabel = `${title}: ${value}${trendValue ? `, ${trendValue} ${trendText}` : ''}`;

  return (
    <Card className={clsx('ui-metric-card', `ui-intent-${intent}`)} role="group" aria-label={fullLabel}>
      <div className="ui-metric-header">
        <span className="ui-metric-title">{title}</span>
        {Icon && <Icon className="ui-metric-icon" size={18} aria-hidden="true" />}
      </div>
      <div className="ui-metric-body">
        <span className="ui-metric-value">{value}</span>
      </div>
      {(trend || trendValue) && (
        <div className={clsx('ui-metric-footer', trend === 'up' ? 'text-positive' : trend === 'down' ? 'text-negative' : '')}>
          {trend === 'up' ? <TrendingUp size={14} aria-hidden="true" /> : trend === 'down' ? <TrendingDown size={14} aria-hidden="true" /> : null}
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
  const ariaLabel = sublabel ? `${sublabel}: ${label || percentage + '%'}` : `Progress: ${label || percentage + '%'}`;

  return (
    <div
      className="ui-progress-ring-container"
      style={{ width: size, height: size }}
      role="progressbar"
      aria-valuenow={percentage}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={ariaLabel}
    >
      <svg className="ui-progress-ring" width={size} height={size} aria-hidden="true">
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
      <div className="ui-ring-content" aria-hidden="true">
        <span className="ui-ring-label">{label || `${percentage}%`}</span>
        {sublabel && <span className="ui-ring-sublabel">{sublabel}</span>}
      </div>
    </div>
  );
}

