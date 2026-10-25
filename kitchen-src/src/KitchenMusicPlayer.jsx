import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import './kitchen-music-player.css';

const discPalettes = [
  {base: '#dc879d', light: '#ffe7dc', shadow: '#b35878', ring: '#f7c9ce', ink: '#714052'},
  {base: '#73add6', light: '#e5f6ff', shadow: '#467cae', ring: '#c2e1f1', ink: '#365c7e'},
  {base: '#8bbb9d', light: '#edf9d9', shadow: '#5d8a73', ring: '#cee8c8', ink: '#426b51'},
  {base: '#b19acc', light: '#f2e9ff', shadow: '#866aa6', ring: '#ded0ed', ink: '#66527c'},
];

function discStyle(track, index, direction = 1) {
  const colors = track?.discColors || discPalettes[Math.max(0, index) % discPalettes.length];
  return {'--disc-direction': direction, ...Object.fromEntries(Object.entries(colors).map(([tone, color]) => [`--disc-${tone}`, color]))};
}

function Icon({name}) {
  const shapes = {
    play: <path d="m9 5 11 7-11 7Z"/>,
    pause: <><path d="M8 5h3v14H8z"/><path d="M15 5h3v14h-3z"/></>,
    previous: <><path d="M7 6v12"/><path d="m18 6-9 6 9 6Z"/></>,
    next: <><path d="M17 6v12"/><path d="m6 6 9 6-9 6Z"/></>,
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className={`kitchen-music__icon kitchen-music__icon--${name}`}>{shapes[name]}</svg>;
}

/** Compact audio-only player. Tracks must have a direct audio-file src. */
export default function KitchenMusicPlayer({tracks = [], paused = false}) {
  const library = useMemo(() => tracks.filter(track => track && track.provider !== 'youtube' && typeof track.src === 'string' && track.src.trim()), [tracks]);
  const [selected, setSelected] = useState(0), [playing, setPlaying] = useState(false), [error, setError] = useState('');
  const [discChange, setDiscChange] = useState({id: 0, direction: 1, previousIndex: 0, active: false});
  const audioRef = useRef(null), wantsPlayback = useRef(true), playRequest = useRef(0);
  const autoplayPending = useRef(true), startOnGesture = useRef(null);
  const track = library[selected] || library[0];
  const currentIndex = track ? library.indexOf(track) : -1;
  const title = track?.title || 'music';

  const pausePlayback = useCallback(() => {
    autoplayPending.current = false;
    wantsPlayback.current = false;
    ++playRequest.current;
    audioRef.current?.pause();
    setPlaying(false);
  }, []);

  const playAudio = audio => {
    if (!audio || !track || paused) return;
    const request = ++playRequest.current;
    setError('');
    audio.volume = .35;
    audio.play()?.catch(cause => {
      if (request !== playRequest.current || cause.name === 'AbortError') return;
      wantsPlayback.current = false;
      setPlaying(false);
      // Autoplay restrictions are normal: retry from the next real gesture.
      if (cause.name === 'NotAllowedError' && autoplayPending.current) return;
      autoplayPending.current = false;
      setError(cause.name === 'NotAllowedError' ? 'Tap the disc to play.' : 'This audio file could not play.');
    });
  };

  const togglePlayback = () => {
    if (!track || paused) return;
    autoplayPending.current = false;
    if (wantsPlayback.current || playing) pausePlayback();
    else {wantsPlayback.current = true;playAudio(audioRef.current);}
  };

  const skip = direction => {
    if (!library.length || paused) return;
    if (autoplayPending.current) wantsPlayback.current = true;
    const next = (currentIndex + direction + library.length) % library.length;
    setError('');
    if (next !== currentIndex) {
      setDiscChange(previous => ({id: previous.id + 1, direction, previousIndex: currentIndex, active: true}));
      setSelected(next);
    }
    else if (audioRef.current) {
      audioRef.current.currentTime = 0;
      if (wantsPlayback.current) playAudio(audioRef.current);
    }
  };

  useEffect(() => {if (selected >= library.length) setSelected(0);}, [selected, library.length]);
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    ++playRequest.current;
    audio.pause();setPlaying(false);
    if (!track?.src) wantsPlayback.current = false;
    if (track?.src && (wantsPlayback.current || autoplayPending.current) && !paused && !document.hidden) {
      wantsPlayback.current = true;playAudio(audio);
    }
    // Preserve play/pause intention across a track change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [track?.src]);
  useEffect(() => {if (paused) pausePlayback();}, [paused, pausePlayback]);

  startOnGesture.current = () => {
    if (!autoplayPending.current || !track || paused || document.hidden) return;
    wantsPlayback.current = true;playAudio(audioRef.current);
  };
  useEffect(() => {
    const start = event => {
      // The player buttons handle their own gestures; avoid toggling twice.
      if (!event.isTrusted || event.target instanceof Element && event.target.closest('.kitchen-music')) return;
      startOnGesture.current?.();
    };
    window.addEventListener('pointerdown', start, {capture: true});
    window.addEventListener('keydown', start, {capture: true});
    return () => {
      window.removeEventListener('pointerdown', start, {capture: true});
      window.removeEventListener('keydown', start, {capture: true});
    };
  }, []);
  useEffect(() => {
    const audio = audioRef.current;
    const hidden = () => {if (document.hidden) pausePlayback();};
    document.addEventListener('visibilitychange', hidden);
    return () => {
      document.removeEventListener('visibilitychange', hidden);
      ++playRequest.current;audio?.pause();
    };
  }, [pausePlayback]);

  return <aside className={`kitchen-music${playing ? ' kitchen-music--playing' : ''}${!track ? ' kitchen-music--empty' : ''}`}
    aria-label="Kitchen music player" data-current-track={track?.id || track?.title || ''} data-music-playing={playing}
    data-music-provider="audio" data-music-autoplay="true" data-music-error={error} data-disc-switching={discChange.active} data-disc-change={discChange.id}>
    <audio ref={audioRef} src={track?.src || undefined} preload="auto" data-kitchen-music="true"
      onPlay={() => {autoplayPending.current = false;setPlaying(true);}} onPause={() => setPlaying(false)} onEnded={() => skip(1)}
      onError={() => {
        if (!track) return;
        autoplayPending.current = false;wantsPlayback.current = false;setPlaying(false);setError('This audio file could not play.');
      }}/>
    <div className="kitchen-music__shell">
      <button type="button" className="kitchen-music__skip" aria-label="Previous song" disabled={library.length < 2 || paused} onClick={() => skip(-1)}><Icon name="previous"/></button>
      <button type="button" className="kitchen-music__disc-button" onClick={togglePlayback} disabled={!track || paused}
        style={discStyle(track, currentIndex)}
        aria-label={track ? `${playing ? 'Pause' : 'Play'} ${title}` : 'Music is waiting for an audio track'}>
        <span className="kitchen-music__disc-slot" aria-hidden="true">
          {discChange.active && <span key={`outgoing-${discChange.id}`} className="kitchen-music__cartridge kitchen-music__cartridge--outgoing"
            style={discStyle(library[discChange.previousIndex], discChange.previousIndex, discChange.direction)}>
            <span className="kitchen-music__disc"><span className="kitchen-music__disc-ring"/></span>
          </span>}
          <span key={`incoming-${discChange.id}`} className={`kitchen-music__cartridge${discChange.active ? ' kitchen-music__cartridge--incoming' : ''}`}
            style={discStyle(track, currentIndex, discChange.direction)}
            onAnimationEnd={event => {
              if (event.target !== event.currentTarget || event.animationName !== 'kitchen-disc-arrive') return;
              setDiscChange(previous => previous.id === discChange.id ? {...previous, active: false} : previous);
            }}>
            <span className="kitchen-music__disc"><span className="kitchen-music__disc-ring"/></span>
          </span>
        </span>
        <span className="kitchen-music__disc-control"><Icon name={playing ? 'pause' : 'play'}/></span>
      </button>
      <button type="button" className="kitchen-music__skip" aria-label="Next song" disabled={library.length < 2 || paused} onClick={() => skip(1)}><Icon name="next"/></button>
    </div>
    <span className="kitchen-music__status" role="status" aria-live="polite">{error}</span>
  </aside>;
}
