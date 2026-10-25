import React from 'react';
import './room-fonts.css';
import './room-loading.css';

const DEFAULT_STATUS = 'Preparing the kitchen…';

/** A dependency-light full-screen fallback, safe to render before the 3D bundle. */
export default function RoomLoading({error = false, status = DEFAULT_STATUS, progress = null, onRetry}) {
  const percent = typeof progress === 'number' && Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : null;

  return <div className={`room-loading${error ? ' room-loading--error' : ''}`} role={error ? 'alert' : 'status'} aria-live={error ? 'assertive' : 'polite'} aria-atomic="true" aria-busy={!error}>
    <div className="room-loading__content">
      {error ? <>
        <h1 className="room-loading__error-title">The kitchen couldn’t load.</h1>
        {onRetry && <button className="room-loading__retry" type="button" onClick={onRetry}>Try again</button>}
      </> : <>
        <span className="room-loading__sr-only">{status || DEFAULT_STATUS}</span>
        <div className={`room-loading__track${percent === null ? ' room-loading__track--indeterminate' : ''}`}
          role="progressbar" aria-label="Loading the kitchen" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent === null ? undefined : Math.round(percent)}>
          <span className="room-loading__fill" aria-hidden="true" style={percent === null ? undefined : {width: `${percent}%`}}/>
        </div>
      </>}
    </div>
  </div>;
}
