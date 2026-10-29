import React, { useRef, useState, useEffect } from 'react';
import { Play, Pause, RotateCcw, Download, Volume2, Sparkles, AudioLines } from 'lucide-react';
import { SupportedLanguage } from '../types';

interface WaveformPlayerProps {
  audioUrl: string | null;
  durationSeconds: number;
  sampleRate: number;
  voiceName: string;
  languageLabel: string;
  text?: string;
  language?: SupportedLanguage;
  speed?: number;
  pitch?: number;
  gender?: 'female' | 'male';
  onDownloadWav: () => void;
}

export const WaveformPlayer: React.FC<WaveformPlayerProps> = ({
  audioUrl,
  durationSeconds,
  sampleRate,
  voiceName,
  languageLabel,
  text,
  language = 'bn-IN',
  speed = 1.0,
  pitch = 1.0,
  gender = 'female',
  onDownloadWav
}) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const progressTimerRef = useRef<number | null>(null);

  // Stop speech when audioUrl changes
  useEffect(() => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
    }
    setIsPlaying(false);
    setCurrentTime(0);
  }, [audioUrl, text]);

  // Draw simulated waveform bars
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    const barCount = 72;
    const barWidth = width / barCount - 2;
    const currentProgress = durationSeconds > 0 ? currentTime / durationSeconds : 0;

    for (let i = 0; i < barCount; i++) {
      const progress = i / barCount;
      // Procedural waveform envelope simulating speech cadence
      const wave = Math.sin(progress * Math.PI * 5) * 0.4 +
                   Math.sin(progress * Math.PI * 14) * 0.35 +
                   Math.cos(progress * Math.PI * 22) * 0.25;
      const barHeight = Math.max(4, Math.abs(wave) * (height * 0.8));

      const isPlayed = progress <= currentProgress;
      ctx.fillStyle = isPlayed ? '#F59E0B' : '#334155';

      const x = i * (barWidth + 2);
      const y = (height - barHeight) / 2;

      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, barHeight, 2);
      ctx.fill();
    }
  }, [currentTime, durationSeconds, audioUrl]);

  const togglePlay = () => {
    if (!audioUrl) return;

    if (isPlaying) {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      if (audioRef.current) {
        audioRef.current.pause();
      }
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current);
      }
      setIsPlaying(false);
      return;
    }

    // Play real spoken text using native browser speech synthesis
    if ('speechSynthesis' in window && text && text.trim().length > 0) {
      window.speechSynthesis.cancel();

      const utterance = new SpeechSynthesisUtterance(text);
      
      // Map proper BCP-47 language tag
      if (language === 'bn-IN') {
        utterance.lang = 'bn-IN';
      } else if (language === 'hi-IN') {
        utterance.lang = 'hi-IN';
      } else {
        utterance.lang = 'en-IN';
      }

      utterance.rate = playbackRate * Math.max(0.6, Math.min(1.6, speed));
      utterance.pitch = Math.max(0.7, Math.min(1.4, pitch));

      // Attempt to find best voice
      const voices = window.speechSynthesis.getVoices();
      const targetLangPrefix = utterance.lang.split('-')[0].toLowerCase();
      const matchedVoice = voices.find(v => v.lang.toLowerCase() === utterance.lang.toLowerCase()) ||
                           voices.find(v => v.lang.toLowerCase().startsWith(targetLangPrefix)) ||
                           voices.find(v => v.lang.toLowerCase().includes('in'));
      if (matchedVoice) {
        utterance.voice = matchedVoice;
      }

      utterance.onstart = () => {
        setIsPlaying(true);
        const startTime = Date.now() - (currentTime * 1000);
        if (progressTimerRef.current) clearInterval(progressTimerRef.current);
        progressTimerRef.current = window.setInterval(() => {
          const elapsed = (Date.now() - startTime) / 1000;
          if (elapsed >= durationSeconds) {
            setIsPlaying(false);
            setCurrentTime(0);
            if (progressTimerRef.current) clearInterval(progressTimerRef.current);
          } else {
            setCurrentTime(elapsed);
          }
        }, 80);
      };

      utterance.onend = () => {
        setIsPlaying(false);
        setCurrentTime(0);
        if (progressTimerRef.current) clearInterval(progressTimerRef.current);
      };

      utterance.onerror = () => {
        // Fallback to HTML audio element if speech synthesis fails
        if (audioRef.current) {
          audioRef.current.play();
        }
      };

      window.speechSynthesis.speak(utterance);
      setIsPlaying(true);
    } else if (audioRef.current) {
      audioRef.current.play();
      setIsPlaying(true);
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current && !isPlaying) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const handleEnded = () => {
    setIsPlaying(false);
    setCurrentTime(0);
    if (progressTimerRef.current) clearInterval(progressTimerRef.current);
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio = Math.max(0, Math.min(1, clickX / rect.width));
    const targetTime = ratio * durationSeconds;
    setCurrentTime(targetTime);
    if (audioRef.current) {
      audioRef.current.currentTime = targetTime;
    }
  };

  const changeRate = (rate: number) => {
    setPlaybackRate(rate);
    if (audioRef.current) {
      audioRef.current.playbackRate = rate;
    }
    if (isPlaying && 'speechSynthesis' in window) {
      togglePlay(); // stop
      setTimeout(() => togglePlay(), 100); // restart at new speed
    }
  };

  if (!audioUrl) {
    return (
      <div className="h-44 border border-dashed border-slate-800 rounded-lg flex flex-col items-center justify-center p-6 text-center bg-slate-900/30">
        <AudioLines className="w-8 h-8 text-slate-600 mb-2" />
        <p className="text-sm text-slate-400 font-medium">Ready for synthesis</p>
        <p className="text-xs text-slate-500 mt-1 max-w-sm">
          Select a voice preset, type your text in Bengali, Hindi, or Indian English, and click "Synthesize Audio" to render high-fidelity speech.
        </p>
      </div>
    );
  }

  return (
    <div className="border border-slate-800 rounded-lg p-5 bg-[#121927]">
      <audio
        ref={audioRef}
        src={audioUrl}
        onTimeUpdate={handleTimeUpdate}
        onEnded={handleEnded}
      />

      {/* Track Header & Metadata */}
      <div className="flex items-center justify-between gap-4 mb-4 pb-3 border-b border-slate-800/80">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
            <Volume2 className="w-3.5 h-3.5" />
          </div>
          <div>
            <div className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <span>{voiceName}</span>
              <span className="text-slate-500 text-xs font-normal">·</span>
              <span className="text-xs text-slate-400 font-normal">{languageLabel}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs text-slate-400 font-mono tabular-nums">
          <span>{sampleRate.toLocaleString()} Hz</span>
          <span className="text-slate-600">·</span>
          <span>PCM 16-bit WAV</span>
          <span className="text-slate-600">·</span>
          <span>{durationSeconds.toFixed(2)}s</span>
        </div>
      </div>

      {/* Interactive Waveform Canvas */}
      <div
        onClick={handleSeek}
        className="w-full h-16 bg-slate-950/70 border border-slate-800/60 rounded px-2 flex items-center cursor-pointer hover:border-slate-700 transition-colors relative"
        title="Click to seek"
      >
        <canvas
          ref={canvasRef}
          width={640}
          height={64}
          className="w-full h-full block"
        />
      </div>

      {/* Scrubber & Controls */}
      <div className="flex items-center justify-between gap-4 mt-4 pt-1">
        <div className="flex items-center gap-3">
          <button
            onClick={togglePlay}
            className="w-9 h-9 rounded-full bg-amber-500 hover:bg-amber-400 text-slate-950 flex items-center justify-center transition-colors cursor-pointer"
            aria-label={isPlaying ? 'Pause' : 'Play'}
          >
            {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
          </button>

          <button
            onClick={() => {
              if (audioRef.current) {
                audioRef.current.currentTime = 0;
                setCurrentTime(0);
              }
            }}
            className="w-8 h-8 rounded-full border border-slate-700 hover:border-slate-600 text-slate-300 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
            aria-label="Restart"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>

          <div className="text-xs font-mono tabular-nums text-slate-300 ml-1">
            <span>{currentTime.toFixed(1)}s</span>
            <span className="text-slate-600 mx-1">/</span>
            <span>{durationSeconds.toFixed(1)}s</span>
          </div>
        </div>

        {/* Speed Controls & Download */}
        <div className="flex items-center gap-2">
          <div className="flex items-center p-0.5 bg-slate-900 border border-slate-800 rounded text-xs font-mono">
            {[0.75, 1.0, 1.25, 1.5].map((rate) => (
              <button
                key={rate}
                onClick={() => changeRate(rate)}
                className={`px-2 py-0.5 rounded text-[11px] transition-colors cursor-pointer ${
                  playbackRate === rate
                    ? 'bg-amber-500/20 text-amber-300 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {rate}x
              </button>
            ))}
          </div>

          <button
            onClick={onDownloadWav}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors border border-slate-700 cursor-pointer"
          >
            <Download className="w-3.5 h-3.5" />
            Download WAV
          </button>
        </div>
      </div>
    </div>
  );
};
