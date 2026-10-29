import React, { useState, useRef } from 'react';
import { X, Mic, MicOff, Upload, CheckCircle2, AlertTriangle, ShieldCheck, Play, Pause, FileAudio, Activity, Cpu } from 'lucide-react';
import { VoiceRecorder, analyzeAudioCharacteristics, blobToBase64 } from '../utils/audio';
import { VoicePreset, SupportedLanguage } from '../types';

interface VoiceCloneModalProps {
  isOpen: boolean;
  onClose: () => void;
  onVoiceCreated: (newVoice: VoicePreset) => void;
}

export const VoiceCloneModal: React.FC<VoiceCloneModalProps> = ({
  isOpen,
  onClose,
  onVoiceCreated
}) => {
  const [voiceName, setVoiceName] = useState('');
  const [selectedLanguage, setSelectedLanguage] = useState<SupportedLanguage>('bn-IN');
  const [gender, setGender] = useState<'female' | 'male'>('female');
  const [isRecording, setIsRecording] = useState(false);
  const [recordingLevel, setRecordingLevel] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [audioDuration, setAudioDuration] = useState<number>(0);
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Acoustic profile states
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [measuredPitchHz, setMeasuredPitchHz] = useState<number | undefined>(undefined);
  const [pitchCategory, setPitchCategory] = useState<string | undefined>(undefined);
  const [timbreDescription, setTimbreDescription] = useState<string | undefined>(undefined);
  const [tempoDescription, setTempoDescription] = useState<string | undefined>(undefined);
  const [audioBase64, setAudioBase64] = useState<string | undefined>(undefined);
  const [promptText, setPromptText] = useState('');

  const recorderRef = useRef<VoiceRecorder | null>(null);
  const audioPreviewRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (!isOpen) return null;

  const processCapturedAudio = async (blob: Blob, duration: number, targetGender: 'female' | 'male' = gender) => {
    setAudioBlob(blob);
    setAudioDuration(duration);
    setIsAnalyzing(true);
    try {
      const [base64, analysis] = await Promise.all([
        blobToBase64(blob),
        analyzeAudioCharacteristics(blob, targetGender)
      ]);
      setAudioBase64(base64);
      setMeasuredPitchHz(analysis.pitchHz);
      setPitchCategory(analysis.pitchCategory);
      setTimbreDescription(analysis.timbreDescription);
      setTempoDescription(analysis.tempoDescription);
    } catch {
      // fallback
    } finally {
      setIsAnalyzing(false);
    }
  };

  const startRecording = async () => {
    try {
      setErrorMsg(null);
      const recorder = new VoiceRecorder();
      recorderRef.current = recorder;
      await recorder.start((level) => {
        setRecordingLevel(level);
      });
      setIsRecording(true);
    } catch {
      setErrorMsg('Microphone permission denied or audio input device not detected.');
    }
  };

  const stopRecording = async () => {
    if (!recorderRef.current) return;
    try {
      const result = await recorderRef.current.stop();
      setIsRecording(false);
      setRecordingLevel(0);
      if (result.durationSeconds < 3.0) {
        setErrorMsg('Sample is too short (min 3.0 seconds required for stable acoustic embedding).');
      }
      await processCapturedAudio(result.blob, result.durationSeconds);
    } catch {
      setIsRecording(false);
      setErrorMsg('Error capturing microphone audio.');
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('audio/')) {
      setErrorMsg('Please select a valid audio file (.wav, .mp3, .m4a, .webm).');
      return;
    }

    if (file.size > 25 * 1024 * 1024) {
      setErrorMsg('Audio file exceeds 25MB limit.');
      return;
    }

    setErrorMsg(null);
    const audioUrl = URL.createObjectURL(file);
    const tempAudio = new Audio(audioUrl);
    tempAudio.onloadedmetadata = () => {
      const duration = tempAudio.duration;
      if (duration < 3.0) {
        setErrorMsg('Sample is too short (minimum 3 seconds required).');
      } else if (duration > 300.0) {
        setErrorMsg('Audio exceeds maximum recommended length of 5 minutes (300 seconds).');
      } else {
        setErrorMsg(null);
      }
      processCapturedAudio(file, duration);
    };
  };

  const handleGenderChange = (newGender: 'female' | 'male') => {
    setGender(newGender);
    if (audioBlob) {
      processCapturedAudio(audioBlob, audioDuration, newGender);
    }
  };

  const togglePreview = () => {
    if (!audioBlob) return;
    if (!audioPreviewRef.current) {
      const url = URL.createObjectURL(audioBlob);
      const audio = new Audio(url);
      audio.onended = () => setPreviewPlaying(false);
      audioPreviewRef.current = audio;
    }

    if (previewPlaying) {
      audioPreviewRef.current.pause();
      setPreviewPlaying(false);
    } else {
      audioPreviewRef.current.play();
      setPreviewPlaying(true);
    }
  };

  const handleSaveVoice = () => {
    if (!voiceName.trim()) {
      setErrorMsg('Please provide a name for this cloned voice profile.');
      return;
    }
    if (!audioBlob) {
      setErrorMsg('Reference audio sample is required.');
      return;
    }
    if (audioDuration < 3.0) {
      setErrorMsg('Audio duration must be at least 3.0 seconds.');
      return;
    }
    if (!consentConfirmed) {
      setErrorMsg('You must confirm explicit authorization and consent to proceed.');
      return;
    }

    const cleanName = voiceName.trim();
    const newVoice: VoicePreset = {
      id: `cloned-${Date.now()}`,
      name: `${cleanName} (Cloned)`,
      nativeName: cleanName,
      language: selectedLanguage,
      accent: selectedLanguage === 'bn-IN' ? 'West Bengal Cloned Accent' : selectedLanguage === 'hi-IN' ? 'Hindi Cloned Accent' : 'Indian English Cloned',
      gender,
      tag: 'Custom Cloned Voice',
      samplePrompt: 'This is my custom cloned voice synthesized through VoxIndica Studio.',
      speedDefault: 1.0,
      pitchDefault: 1.0,
      isCloned: true,
      consentTimestamp: new Date().toISOString(),
      referenceAudioUrl: URL.createObjectURL(audioBlob),
      referenceAudioBase64: audioBase64,
      referenceAudioMimeType: audioBlob.type || 'audio/wav',
      promptText: promptText.trim() || undefined,
      measuredPitchHz: measuredPitchHz || (gender === 'male' ? 125 : 215),
      timbreDescription: timbreDescription || (gender === 'male' ? 'Warm grounded baritone with natural vocal texture' : 'Clear melodic vocal timbre with balanced upper harmonics'),
      tempoDescription: tempoDescription || 'natural conversational prosody'
    };

    onVoiceCreated(newVoice);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-[#121927] border border-slate-800 rounded-xl w-full max-w-xl shadow-2xl overflow-hidden my-8">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800">
          <div>
            <h3 className="text-base font-semibold text-slate-100 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-amber-400" />
              Few-Shot Voice Cloning Studio
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Clone voice characteristics from a 5–15 second clean speech sample.
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-5">
          {errorMsg && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-300 text-xs flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Voice Details */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Voice Profile Name
              </label>
              <input
                type="text"
                placeholder="e.g. Suman Roy (Bengali)"
                value={voiceName}
                onChange={(e) => setVoiceName(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-600 focus:outline-none focus:border-amber-400"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Primary Target Language
              </label>
              <select
                value={selectedLanguage}
                onChange={(e) => setSelectedLanguage(e.target.value as SupportedLanguage)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-amber-400"
              >
                <option value="bn-IN">Bengali (West Bengal / বাংলা)</option>
                <option value="hi-IN">Hindi (Indian Standard / हिन्दी)</option>
                <option value="en-IN">Indian English</option>
              </select>
            </div>
          </div>

          {/* Gender */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Voice Gender & Pitch Profile
            </label>
            <div className="flex gap-3">
              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="radio"
                  name="gender"
                  checked={gender === 'female'}
                  onChange={() => handleGenderChange('female')}
                  className="accent-amber-500"
                />
                Female (F0 ~ 210–240 Hz)
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="radio"
                  name="gender"
                  checked={gender === 'male'}
                  onChange={() => handleGenderChange('male')}
                  className="accent-amber-500"
                />
                Male (F0 ~ 110–140 Hz)
              </label>
            </div>
          </div>

          {/* Audio Input Options: Record or Upload */}
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5">
              Reference Audio Sample (5 to 15 seconds)
            </label>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Record via Mic */}
              <div className="border border-slate-800 bg-slate-900/60 rounded-lg p-4 flex flex-col items-center justify-center text-center">
                <button
                  type="button"
                  onClick={isRecording ? stopRecording : startRecording}
                  className={`w-12 h-12 rounded-full flex items-center justify-center mb-2 transition-all cursor-pointer ${
                    isRecording
                      ? 'bg-rose-500 text-white animate-pulse'
                      : 'bg-slate-800 hover:bg-slate-700 text-amber-400 border border-slate-700'
                  }`}
                >
                  {isRecording ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                </button>
                <span className="text-xs font-medium text-slate-200">
                  {isRecording ? 'Click to Stop Recording' : 'Record Microphone'}
                </span>
                {isRecording && (
                  <div className="w-full mt-2 bg-slate-800 rounded-full h-1.5 overflow-hidden">
                    <div
                      className="bg-amber-400 h-full transition-all duration-75"
                      style={{ width: `${Math.min(100, recordingLevel * 250)}%` }}
                    />
                  </div>
                )}
              </div>

              {/* Upload File */}
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border border-dashed border-slate-700 hover:border-slate-500 bg-slate-900/40 rounded-lg p-4 flex flex-col items-center justify-center text-center cursor-pointer transition-colors"
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/*"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <Upload className="w-6 h-6 text-slate-400 mb-2" />
                <span className="text-xs font-medium text-slate-200">Upload Clean Audio File</span>
                <span className="text-[11px] text-slate-500 mt-0.5">WAV, MP3 or WebM (Max 25MB)</span>
              </div>
            </div>

            {/* Captured Audio Preview Card */}
            {audioBlob && (
              <div className="mt-3 space-y-2">
                <div className="p-3 bg-slate-900 border border-slate-700/80 rounded-lg flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <FileAudio className="w-4 h-4 text-amber-400" />
                    <div className="text-xs">
                      <span className="text-slate-200 font-medium">Reference Audio Captured</span>
                      <span className="text-slate-500 mx-1.5">·</span>
                      <span className="text-slate-400 font-mono tabular-nums">{audioDuration.toFixed(1)}s duration</span>
                    </div>
                  </div>
                  <button
                    onClick={togglePreview}
                    className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 flex items-center gap-1.5 transition-colors cursor-pointer"
                  >
                    {previewPlaying ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                    {previewPlaying ? 'Pause' : 'Listen'}
                  </button>
                </div>

                {isAnalyzing ? (
                  <div className="p-3 bg-slate-900/90 border border-amber-500/30 rounded-lg flex items-center gap-2.5 text-xs text-amber-300">
                    <Activity className="w-4 h-4 text-amber-400 animate-spin" />
                    <span>Analyzing acoustic waveform & computing neural speaker embedding...</span>
                  </div>
                ) : pitchCategory ? (
                  <div className="p-3 bg-slate-900 border border-slate-700/80 rounded-lg space-y-1.5 text-xs">
                    <div className="flex items-center justify-between text-slate-300 font-medium border-b border-slate-800 pb-1.5">
                      <span className="flex items-center gap-1.5 text-amber-400">
                        <Cpu className="w-3.5 h-3.5" />
                        Neural Voiceprint Extracted
                      </span>
                      <span className="text-[11px] text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" />
                        Acoustic Vector Calibrated
                      </span>
                    </div>
                    <div className="text-slate-300">
                      <span className="text-slate-400">Pitch Profile (F0):</span>{' '}
                      <span className="font-semibold text-slate-200">{pitchCategory}</span>
                    </div>
                    <div className="text-slate-300">
                      <span className="text-slate-400">Timbre & Resonance:</span>{' '}
                      <span className="text-slate-300">{timbreDescription}</span>
                    </div>
                  </div>
                ) : null}

                {/* Optional Transcript Input for VoxCPM-2 Verbatim Phoneme Alignment */}
                <div className="pt-1">
                  <label className="block text-[11px] font-medium text-slate-300 mb-1">
                    Reference Audio Transcript / স্ক্রিপ্ট (VoxCPM-2 Verbatim Alignment — ঐচ্ছিক)
                  </label>
                  <input
                    type="text"
                    value={promptText}
                    onChange={(e) => setPromptText(e.target.value)}
                    placeholder="নমস্কার, আমি সন্দীপ... (অডিওতে বলা কথাটি লিখলে ক্লোনিং নিখুঁত হয়)"
                    className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500 transition-colors"
                  />
                  <p className="text-[10px] text-slate-500 mt-1">
                    VoxCPM-2 uses this transcript to compute acoustic-phoneme alignment for zero-shot speaker replication.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Mandatory Ethical & Legal Consent Checkpoint */}
          <div className="p-4 bg-amber-500/5 border border-amber-500/25 rounded-lg space-y-2">
            <div className="flex items-start gap-2.5">
              <input
                id="consentCheck"
                type="checkbox"
                checked={consentConfirmed}
                onChange={(e) => setConsentConfirmed(e.target.checked)}
                className="mt-1 w-4 h-4 rounded border-slate-700 accent-amber-500 cursor-pointer"
              />
              <label htmlFor="consentCheck" className="text-xs text-slate-300 leading-relaxed cursor-pointer select-none">
                <strong className="text-amber-400 font-semibold block mb-0.5">
                  Mandatory Consent & Legal Certification
                </strong>
                I explicitly confirm and certify that I hold the lawful right, direct authorization, and consent from the voice owner to clone and synthesize this voice. I agree never to use VoxIndica Studio to generate unauthorized voice replicas, malicious deepfakes, or misleading impersonations.
              </label>
            </div>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 bg-slate-900/80 border-t border-slate-800">
          <button
            onClick={onClose}
            className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleSaveVoice}
            disabled={!consentConfirmed || !audioBlob || audioDuration < 3.0}
            className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all ${
              consentConfirmed && audioBlob && audioDuration >= 3.0
                ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 cursor-pointer shadow-lg shadow-amber-500/20'
                : 'bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700/50'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
            Save Cloned Voice Profile
          </button>
        </div>
      </div>
    </div>
  );
};
