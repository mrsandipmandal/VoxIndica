import React, { useState } from 'react';
import { X, Copy, Check, Terminal, FileCode, ExternalLink, Sparkles } from 'lucide-react';

interface WorkerScriptModalProps {
  isOpen: boolean;
  onClose: () => void;
  platform: 'kaggle' | 'colab';
}

export const WorkerScriptModal: React.FC<WorkerScriptModalProps> = ({
  isOpen,
  onClose,
  platform
}) => {
  const [copied, setCopied] = useState(false);

  if (!isOpen) return null;

  const scriptCode = `# ==============================================================================
# VoxIndica Studio — VoxCPM-2 Zero-Shot Voice Cloning Worker (${platform === 'kaggle' ? 'Kaggle' : 'Google Colab'})
# ==============================================================================
# 1. Enable GPU:
#    - Kaggle: Settings -> Accelerator -> GPU T4 x2 or P100
#    - Colab:  Runtime -> Change runtime type -> T4 GPU
# 2. Paste & Run this entire cell.
# ==============================================================================

!pip install -q fastapi uvicorn pydantic torch torchaudio soundfile voxcpm
!wget -q -nc https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
!chmod +x cloudflared-linux-amd64

import os
import io
import base64
import secrets
import subprocess
import time
import threading
import torch
import soundfile as sf
import uvicorn
from fastapi import FastAPI, HTTPException, Security, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# Generate cryptographically secure session Bearer Token
BEARER_TOKEN = secrets.token_hex(16)

app = FastAPI(title="VoxIndica VoxCPM-2 Worker")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

security = HTTPBearer()

def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)):
    if credentials.credentials != BEARER_TOKEN:
        raise HTTPException(status_code=401, detail="Invalid worker token")
    return credentials.credentials

# Query GPU hardware
has_cuda = torch.cuda.is_available()
device_name = torch.cuda.get_device_name(0) if has_cuda else "CPU Host"
vram_total = round(torch.cuda.get_device_properties(0).total_memory / (1024**2)) if has_cuda else 0

# Pre-load VoxCPM-2 Model
vox_model = None
try:
    from voxcpm import VoxCPM
    print("⏳ Loading OpenBMB VoxCPM-2 model onto " + device_name + "...")
    vox_model = VoxCPM.from_pretrained("openbmb/VoxCPM2", load_denoiser=False)
    print("✅ VoxCPM-2 loaded successfully!")
except Exception as e:
    print("⚠️ VoxCPM load notice:", e)

@app.get("/health")
def health(token: str = Depends(verify_token)):
    vram_used = round(torch.cuda.memory_allocated(0) / (1024**2)) if has_cuda else 0
    return {
        "status": "online",
        "gpu_device": device_name,
        "vram_used": vram_used,
        "vram_total": vram_total,
        "model": "VoxCPM-2 (OpenBMB)",
        "timestamp": time.time()
    }

class CloneRequest(BaseModel):
    text: str
    language: str = "bn-IN"
    reference_audio: str = ""
    prompt_text: str = ""
    speed: float = 1.0
    pitch: float = 1.0

@app.post("/clone_voice")
@app.post("/synthesize")
def process_speech(req: CloneRequest, token: str = Depends(verify_token)):
    if not req.text.strip():
        raise HTTPException(status_code=400, detail="Text is required")

    ref_wav_path = "/tmp/vox_reference.wav"
    if req.reference_audio:
        raw_b64 = req.reference_audio.split(",")[-1]
        with open(ref_wav_path, "wb") as f:
            f.write(base64.b64decode(raw_b64))

    out_wav_path = "/tmp/vox_output.wav"
    sample_rate = 24000

    if vox_model is not None and os.path.exists(ref_wav_path):
        wav = vox_model.generate(
            text=req.text,
            prompt_wav_path=ref_wav_path,
            prompt_text=req.prompt_text if req.prompt_text else req.text[:40],
            reference_wav_path=ref_wav_path,
            cfg_value=2.0,
            inference_timesteps=10
        )
        sample_rate = getattr(vox_model, "sample_rate", 24000)
        sf.write(out_wav_path, wav, sample_rate)
    else:
        # Fallback harmonic synthesis
        t = torch.linspace(0, max(2.0, len(req.text)/14.0), int(sample_rate * max(2.0, len(req.text)/14.0)))
        f0 = 136.0 * req.pitch
        tone = 0.4 * torch.sin(2 * 3.14159 * f0 * t) + 0.2 * torch.sin(4 * 3.14159 * f0 * t)
        sf.write(out_wav_path, tone.numpy(), sample_rate)

    with open(out_wav_path, "rb") as f:
        audio_b64 = base64.b64encode(f.read()).decode("utf-8")

    return {
        "status": "success",
        "audio_base64": audio_b64,
        "sample_rate": sample_rate,
        "gpu": device_name
    }

# Start Uvicorn in background thread
def start_server():
    uvicorn.run(app, host="127.0.0.1", port=8000, log_level="warning")

server_thread = threading.Thread(target=start_server, daemon=True)
server_thread.start()
time.sleep(2)

# Start Cloudflare Tunnel
tunnel_proc = subprocess.Popen(
    ["./cloudflared-linux-amd64", "tunnel", "--url", "http://127.0.0.1:8000"],
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,
    text=True
)

print("\\n" + "="*60)
print("🚀 VOXINDICA VOXCPM-2 WORKER READY...")
print("="*60)

for line in iter(tunnel_proc.stdout.readline, ''):
    if "trycloudflare.com" in line:
        for part in line.split():
            if "trycloudflare.com" in part:
                url = part.strip()
                if not url.startswith("http"):
                    url = "https://" + url
                print("\\n" + "*"*60)
                print(f"👉 1. TUNNEL URL:  {url}")
                print(f"👉 2. BEARER TOKEN: {BEARER_TOKEN}")
                print("*"*60 + "\\n")
                print("Copy both into VoxIndica Studio Configure panel!")
                break
        break
`;

  const handleCopy = () => {
    navigator.clipboard.writeText(scriptCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-[#121927] border border-slate-800 rounded-xl w-full max-w-2xl shadow-2xl overflow-hidden my-6 flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 shrink-0">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-amber-400" />
            <h3 className="text-base font-semibold text-slate-100">
              {platform === 'kaggle' ? 'Kaggle GPU Worker' : 'Google Colab Worker'} 1-Click Setup Script
            </h3>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Instructions */}
        <div className="p-6 space-y-4 overflow-y-auto flex-1 text-xs">
          <div className="p-3 bg-slate-900 border border-slate-800 rounded-lg text-slate-300 space-y-1.5">
            <span className="font-semibold text-amber-300 block">কীভাবে চালাবেন (3 Simple Steps):</span>
            <ol className="list-decimal list-inside space-y-1 text-slate-400">
              <li>{platform === 'kaggle' ? 'Kaggle' : 'Google Colab'}-এ গিয়ে একটি নতুন নোটবুক খুলুন এবং GPU চালু করুন (Tesla T4)।</li>
              <li>নিচের কোডটি কপি করে নোটবুকের একটি সেলে পেস্ট করুন এবং <strong>Run Cell (Ctrl + Enter)</strong> চাপুন।</li>
              <li>আউটপুটে আসা <strong>TUNNEL URL</strong> এবং <strong>BEARER TOKEN</strong> কপি করে VoxIndica Studio-তে বসিয়ে দিন।</li>
            </ol>
          </div>

          <div className="relative">
            <div className="flex items-center justify-between pb-1.5 text-[11px] text-slate-400">
              <span className="font-mono">python_worker_setup.py</span>
              <button
                onClick={handleCopy}
                className="px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold flex items-center gap-1 transition-colors cursor-pointer"
              >
                {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                {copied ? 'Copied to Clipboard!' : 'Copy Code'}
              </button>
            </div>
            <pre className="p-4 bg-slate-950 border border-slate-800 rounded-lg text-[11px] font-mono text-slate-300 overflow-x-auto max-h-72 leading-relaxed selection:bg-amber-500/30">
              {scriptCode}
            </pre>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end px-6 py-4 bg-slate-900/90 border-t border-slate-800 shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-colors cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
