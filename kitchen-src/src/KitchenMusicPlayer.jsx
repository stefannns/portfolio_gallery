import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {createMusicVolumeFade} from './music-volume-fade.js';

const BACKGROUND_VOLUME = .13;

/** Quiet background audio. Mobile availability is controlled by the scene. */
export default function KitchenMusicPlayer({tracks = [], paused = false, ducked = false}) {
  const track = useMemo(() => tracks.find(candidate => candidate?.id === 'bgm1'
    && candidate.provider !== 'youtube' && typeof candidate.src === 'string' && candidate.src.trim()), [tracks]);
  const src = track?.src;
  const [playing, setPlaying] = useState(false), [error, setError] = useState('');
  const audioRef = useRef(null), wantsPlayback = useRef(true), playRequest = useRef(0);
  const autoplayPending = useRef(true), previousDuck = useRef(ducked);
  const playbackFlags = useRef({paused, ducked}), volumeFade = useRef(null);
  playbackFlags.current = {paused, ducked};
  if (!volumeFade.current) volumeFade.current = createMusicVolumeFade();

  const pausePlayback = useCallback(() => {
    volumeFade.current.cancel();
    autoplayPending.current = false;
    wantsPlayback.current = false;
    ++playRequest.current;
    audioRef.current?.pause();
    if (audioRef.current) audioRef.current.volume = BACKGROUND_VOLUME;
    setPlaying(false);
  }, []);

  const playAudio = useCallback((audio, {fadeIn = false} = {}) => {
    const flags = playbackFlags.current;
    if (!audio || !src || flags.paused || flags.ducked || document.hidden) return;
    const request = ++playRequest.current;
    volumeFade.current.cancel();
    setError('');
    if (!fadeIn) audio.volume = BACKGROUND_VOLUME;
    else if (audio.paused) audio.volume = 0;
    Promise.resolve(audio.play()).then(() => {
      if (request !== playRequest.current) return;
      const current = playbackFlags.current;
      if (current.paused || current.ducked || document.hidden || !wantsPlayback.current) {audio.pause();return;}
      if (fadeIn) volumeFade.current.fade(audio, BACKGROUND_VOLUME);
    }).catch(cause => {
      if (request !== playRequest.current || cause?.name === 'AbortError') return;
      wantsPlayback.current = false;
      setPlaying(false);
      // Autoplay restrictions are normal: retry from the next real gesture.
      if (cause?.name === 'NotAllowedError') {autoplayPending.current = true;return;}
      autoplayPending.current = false;
      setError('This audio file could not play.');
    });
  }, [src]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    volumeFade.current.cancel();
    ++playRequest.current;
    audio.pause();setPlaying(false);
    const flags = playbackFlags.current;
    audio.volume = flags.ducked ? 0 : BACKGROUND_VOLUME;
    if (!src) wantsPlayback.current = false;
    if (src && (wantsPlayback.current || autoplayPending.current) && !flags.paused && !flags.ducked && !document.hidden) {
      wantsPlayback.current = true;playAudio(audio);
    }
  }, [src, playAudio]);
  useEffect(() => {if (paused) pausePlayback();}, [paused, pausePlayback]);

  useEffect(() => {
    const wasDucked = previousDuck.current;
    previousDuck.current = ducked;
    if (!ducked && !wasDucked) return;
    const audio = audioRef.current;
    ++playRequest.current;volumeFade.current.cancel();
    if (!audio) return;
    if (ducked) {
      // Video silence is temporary; keep the background playback intention.
      if (audio.paused) {audio.volume = 0;setPlaying(false);}
      else volumeFade.current.fade(audio, 0, {onComplete: () => {
        if (playbackFlags.current.ducked) {audio.pause();setPlaying(false);}
      }});
    } else if (!playbackFlags.current.paused && !document.hidden && (wantsPlayback.current || autoplayPending.current)) {
      wantsPlayback.current = true;playAudio(audio, {fadeIn: true});
    } else if (audio.paused) audio.volume = BACKGROUND_VOLUME;
  }, [ducked, playAudio]);

  useEffect(() => {
    const start = event => {
      if (!event.isTrusted || !autoplayPending.current) return;
      const flags = playbackFlags.current;
      if (!src || flags.paused || flags.ducked || document.hidden) return;
      wantsPlayback.current = true;playAudio(audioRef.current);
    };
    window.addEventListener('pointerdown', start, {capture: true});
    window.addEventListener('keydown', start, {capture: true});
    return () => {
      window.removeEventListener('pointerdown', start, {capture: true});
      window.removeEventListener('keydown', start, {capture: true});
    };
  }, [src, playAudio]);

  useEffect(() => {
    const audio = audioRef.current;
    const visibilityChanged = () => {
      const flags = playbackFlags.current;
      if (document.hidden) {
        volumeFade.current.cancel();++playRequest.current;
        audio?.pause();setPlaying(false);
        if (audio) audio.volume = flags.ducked ? 0 : BACKGROUND_VOLUME;
      } else if (!flags.paused && !flags.ducked && (wantsPlayback.current || autoplayPending.current)) {
        wantsPlayback.current = true;playAudio(audio, {fadeIn: true});
      }
    };
    document.addEventListener('visibilitychange', visibilityChanged);
    return () => {
      document.removeEventListener('visibilitychange', visibilityChanged);
      volumeFade.current.cancel();++playRequest.current;audio?.pause();
    };
  }, [playAudio]);

  return <audio ref={audioRef} src={src || undefined} preload="auto" loop hidden aria-hidden="true"
    data-kitchen-music="true" data-current-track={track?.id || ''} data-music-playing={playing}
    data-music-provider="audio" data-music-autoplay="true" data-music-ducked={ducked} data-music-error={error}
    onPlay={event => {
      const flags = playbackFlags.current;
      if (flags.paused || flags.ducked || document.hidden || !wantsPlayback.current) {event.currentTarget.pause();setPlaying(false);return;}
      autoplayPending.current = false;setPlaying(true);
    }} onPause={() => setPlaying(false)}
    onError={() => {
      if (!src) return;
      volumeFade.current.cancel();++playRequest.current;
      autoplayPending.current = false;wantsPlayback.current = false;setPlaying(false);setError('This audio file could not play.');
    }}/>;
}
