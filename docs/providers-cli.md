# Optional CLI paths

The Studio never requires a CLI. Everything here duplicates an HTTP call documented in
[`api/providers.md`](./api/providers.md) — use it only if you prefer typing commands.

## Kaggle CLI

Docs: <https://github.com/Kaggle/kaggle-api> · API keys: <https://www.kaggle.com/settings>

```bash
# 1. Install
python -m pip install --upgrade kaggle

# 2. Put your token in place (download "kaggle.json" from kaggle.com/settings -> Create New Token)
mkdir -p ~/.kaggle
mv ~/Downloads/kaggle.json ~/.kaggle/kaggle.json
chmod 600 ~/.kaggle/kaggle.json

# or use environment variables instead of the file
export KAGGLE_USERNAME="your-username"
export KAGGLE_KEY="your-api-key"

# 3. Check it works
kaggle datasets list -s speech

# 4. Download the reference dataset used by the notebooks
kaggle datasets download -d mrsandipmandal/sample-file -p ./reference --unzip

# 5. Push the worker notebook (generates a new kernel version and starts it)
cd notebooks/kaggle
# edit kernel-metadata.json -> set "id" to "YOUR_USERNAME/voxindica-worker"
kaggle kernels push -p .

# 6. Watch it
kaggle kernels status YOUR_USERNAME/voxindica-worker

# 7. Fetch logs/output (only after the kernel finishes)
kaggle kernels output YOUR_USERNAME/voxindica-worker -p ./worker-output
```

Notes:

- `enable_gpu` / `enable_internet` belong in `kernel-metadata.json`; both are already `true` there.
- GPU kernels stop after roughly 12 hours. A worker kernel stays "running" for its whole life, so
  `kaggle kernels output` usually refuses until it stops — copy the tunnel URL from the kernel's live log
  in the browser instead.
- `scripts/api/kaggle_launch_worker.py` does the same push over HTTP and tries to extract the tunnel URL
  from the output zip, so it can succeed where the CLI cannot.

## Hugging Face CLI

Docs: <https://huggingface.co/docs/huggingface_hub/guides/cli>

```bash
python -m pip install -U "huggingface_hub[cli]"
hf auth login                       # paste your hf_... token
hf auth whoami

# download the model weights for a fully local install
hf download openbmb/VoxCPM2 --local-dir ./models/VoxCPM2

# run a one-off TTS request
curl -s -X POST https://api-inference.huggingface.co/models/facebook/mms-tts-ben \
  -H "Authorization: Bearer $HF_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"inputs":"নমস্কার"}' -o out.wav
```

## Google Colab

There is no official Colab CLI or runtime API. `pip install google-colab-cli` style packages are
unofficial and talk to internal endpoints that break without notice — do not put your account behind them.

Supported options: open the notebook in the browser and *Run all*; or run a local Jupyter kernel with the
`google.colab` package and connect Colab to it; or use Colab Enterprise on Vertex AI, which does have a
Google Cloud API.
