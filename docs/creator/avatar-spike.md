# Avatar spike — SadTalker vs MuseTalk on a T4

Phase 4.2 is a measurement, not an integration. The studio will only gain a
presenter stage after one of these engines produces a real clip on real
hardware. Both notebooks are generated templates and are **unverified**: this
repository has no GPU and cannot run them.

## What is produced

```bash
python workers/build_video_notebooks.py
```

```
notebooks/kaggle/sadtalker_spike/
  voxindica_sadtalker_spike.ipynb
  kernel-metadata.json
notebooks/kaggle/musetalk_spike/
  voxindica_musetalk_spike.ipynb
  kernel-metadata.json
```

The builder is the source of truth. Edit `workers/build_video_notebooks.py`,
regenerate, and commit both generator and notebooks — never hand-edit a
notebook that the generator would overwrite.

## Inputs

Create one **private** Kaggle dataset containing:

| File | Requirement |
| --- | --- |
| presenter photo | front-facing, eyes visible, at least 512×512, JPG/PNG/WebP |
| narration clip | WAV, 3–30 seconds, mono or stereo |

The person in the photo and the voice clip must have explicitly consented to an
AI likeness and synthetic voice. Do not use a public figure or a scraped photo.

Attach the dataset to each kernel (Kaggle UI → Add Input → Your datasets), or
add its slug to `dataset_sources` in the relevant `kernel-metadata.json`.

## Run

1. Replace `__KAGGLE_USERNAME__` in both `kernel-metadata.json` files with your
   Kaggle username.
2. Push each kernel separately:

```bash
kaggle kernels push -p notebooks/kaggle/sadtalker_spike
kaggle kernels push -p notebooks/kaggle/musetalk_spike
```

3. Watch the kernels in the Kaggle UI. A T4 is selected by
   `"enable_gpu": "true"`; internet is required for cloning and weights.
4. If automatic input discovery picks the wrong file, set `IMAGE_OVERRIDE` and
   `AUDIO_OVERRIDE` in the inputs cell and re-run.
5. Download the output (`avatar_spike.mp4`) with
   `kaggle kernels output <username>/<kernel-slug> -p ./spike-output`.

## What the notebooks measure

Both engines run one clip and sample `nvidia-smi` every 0.5s:

- wall time for the whole inference call
- peak total GPU memory in MB (an upper bound, not isolated model usage)
- output duration and resolution via `ffprobe`
- the real error and log tail if anything fails

MuseTalk is driven by a **video**, not a still image. The notebook loops the
photo into a 10s 25fps clip, so head motion and realism are artificially low.
Record that limitation; do not compare its realism against SadTalker's as if the
inputs were equivalent.

## Report

Fill this in for each engine:

| Field | SadTalker | MuseTalk |
| --- | --- | --- |
| Commit | | |
| Wall time (s) | | |
| Peak GPU memory (MB) | | |
| Output duration / resolution | | |
| Lip-sync (1–5) | | |
| Identity retention (1–5) | | |
| Artifacts / failure | | |

A failing notebook is a valid result. A fabricated pass is not, and no stage of
the studio may consume a clip that was never produced.

## Integration gate

Only after a real MP4 exists:

- **SadTalker** fits the `presenter` and `hybrid` modes: one consented photo plus
  the scene WAV yields a talking-head clip.
- **MuseTalk** needs a driving video, so it fits only if the studio can supply
  one (for example a generated idle loop). It is not a photo-to-video engine.

The chosen engine becomes the Phase 4.4 presenter job, gated by the existing
consent record and checkpointed per scene like the voice stage.
