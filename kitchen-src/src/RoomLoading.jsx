import React from 'react';
import './room-fonts.css';
import './room-loading.css';

const DEFAULT_STATUS = 'Preparing the kitchen…';

function KitchenLoadingIllustration({error}) {
  return <svg className="room-loading__illustration" viewBox="0 0 160 152" fill="none" aria-hidden="true" focusable="false">
    <ellipse cx="80" cy="139" rx="45" ry="5" fill="currentColor" opacity=".08"/>
    {!error && <g className="room-loading__steam" stroke="currentColor" strokeWidth="3" strokeLinecap="round" opacity=".35">
      <path d="M47 40c-7-7 7-12 0-20"/>
      <path d="M113 40c7-7-7-12 0-20"/>
    </g>}
    <g className="room-loading__chef">
      <path d="M42 76c-12-12-23-3-19 10l8 11m87-21c12-12 23-3 19 10l-8 11" fill="#CFA779" stroke="currentColor" strokeWidth="3" strokeLinejoin="round"/>
      <path d="M33 92c0-24 17-37 47-37s47 13 47 37v20c0 15-19 23-47 23s-47-8-47-23V92Z" fill="#DDBB91" stroke="currentColor" strokeWidth="3"/>
      <path d="M55 91c0-10 50-10 50 0v21c0 9-50 9-50 0V91Z" fill="#EBCDA8"/>
      <path d="M50 68V46c-16-6-14-25 1-28 4-16 25-18 32-7 12-12 32-5 32 10 15 3 15 21 1 25v22H50Z" fill="#FFFEF9" stroke="currentColor" strokeWidth="3" strokeLinejoin="round"/>
      <path d="M51 57h64M71 37v19m23-21v21" stroke="#D9CDB9" strokeWidth="3" strokeLinecap="round"/>
      <g className={error ? '' : 'room-loading__eyes'} fill="currentColor">
        <ellipse cx="53" cy="91" rx="3" ry="4"/>
        <ellipse cx="107" cy="91" rx="3" ry="4"/>
      </g>
      <path d={error ? 'M74 115q6-5 12 0' : 'M74 112q6 5 12 0'} stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
      <path d="m73 99 2 1m10 0 2-1" stroke="currentColor" strokeWidth="3" strokeLinecap="round"/>
      <ellipse cx="43" cy="105" rx="6" ry="3" fill="#C98D71" opacity=".45"/>
      <ellipse cx="117" cy="105" rx="6" ry="3" fill="#C98D71" opacity=".45"/>
    </g>
  </svg>;
}

/** A dependency-light full-screen fallback, safe to render before the 3D bundle. */
export default function RoomLoading({error = false, status = DEFAULT_STATUS, progress = null, onRetry}) {
  const percent = typeof progress === 'number' && Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : null;
  const detail = status && status !== DEFAULT_STATUS ? status : null;

  return <div className={`room-loading${error ? ' room-loading--error' : ''}`} role={error ? 'alert' : 'status'} aria-live={error ? 'assertive' : 'polite'} aria-atomic="true" aria-busy={!error}>
    <div className="room-loading__content">
      <KitchenLoadingIllustration error={error}/>
      <h1 className="room-loading__title">{error ? 'The kitchen couldn’t load.' : <>
        Preparing the kitchen<span className="room-loading__dots" aria-hidden="true"><i/><i/><i/></span><span className="room-loading__sr-only">…</span>
      </>}</h1>
      <p className="room-loading__detail">{error ? 'Please try again.' : detail || 'Getting everything ready for you.'}</p>
      {!error && percent !== null && <div className="room-loading__progress-row">
        <div className="room-loading__progress" role="progressbar" aria-label="Loading the kitchen" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(percent)}>
          <span style={{width: `${percent}%`}}/>
        </div>
        <span className="room-loading__percent" aria-hidden="true">{Math.round(percent)}%</span>
      </div>}
      {error && onRetry && <button className="room-loading__retry" type="button" onClick={onRetry}>Try again</button>}
    </div>
  </div>;
}
