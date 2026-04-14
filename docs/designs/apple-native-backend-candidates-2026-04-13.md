# Apple-Native Backend Candidates Comparison

Date: 2026-04-13

Related research bead: `minutes-ty6k`

## Question

If Minutes wants a genuinely stronger Apple Silicon backend, what is the best next implementation target?

Not the safest target.
Not the one that is already half-wired.
The best one.

Candidates evaluated:
- **A. WhisperKit** (`argmaxinc/WhisperKit`)
- **B. parakeet-mlx** (`senstella/parakeet-mlx`)
- **C. whisper.cpp CoreML**

Baseline:
- current helper-backed Parakeet path in Minutes
- sample: the same 20 second speech-heavy clip used in the earlier spike

## Current baseline

Helper-backed Parakeet (`tdt-600m`) on the same 20 second sample:

- direct benchmark time: `1791 ms`
- helper benchmark time: `1310 ms`
- helper repeated runs:
  - run 1: `1.79s`
  - run 2: `1.37s`
  - run 3: `1.43s`
- helper repeated transcripts: identical across all three runs
- helper repeated segment payloads: identical across all three runs
- helper process RSS: about `5.1 GB`
- privileged `powermetrics` sample:
  - CPU: `5216 mW`
  - GPU: `2648 mW`
  - ANE: `0 mW`
  - combined: `7864 mW`

This matters because any winner should justify itself against a backend that is already stable and reasonably fast.

## Candidate table

| Candidate | Ran end-to-end here? | Cold start | Warm run | Peak RSS | Timestamp output | ANE evidence | Integration shape | Notes |
|---|---:|---:|---:|---:|---|---|---|---|
| WhisperKit | Yes | `71.88s` | `5.32s` | about `1.1 GB` cold, `204 MB` warm | Yes, word-level JSON/SRT | Not directly measured in this session | Swift package or local server | Strongest native Apple story and the best practical non-Swift integration path |
| parakeet-mlx | Yes | `95.98s` | `1.37s` | about `3.2 GB` max RSS, `3.9-5.0 GB` peak footprint | Yes, JSON with sentence and token timestamps | Not verified | Python CLI via MLX | Very strong warm latency, but colder start and weaker evidence about ANE usage |
| whisper.cpp CoreML | Not truly | N/A | N/A | N/A | Would use existing Whisper output shape | Upstream docs explicitly target ANE | Existing Rust path, but only encoder-side CoreML | The current selector here still falls back because the `.mlmodelc` asset pipeline is missing |

## Candidate notes

### A. WhisperKit

Primary-source facts:
- upstream describes it as on-device speech recognition for Apple Silicon
- supports Swift Package Manager integration
- ships a CLI
- ships a local server that implements the OpenAI Audio API
- documents model generation/download flows and local serving

What we ran:
- `whisperkit-cli transcribe` on the same 20 second sample

Observed behavior:
- produced transcript output successfully
- wrote JSON and SRT reports
- warm run on the same local model cache was much faster than the first run

Observed transcript:

```text
What's happening Matt? How you doing Wesley? Doing good man. Right on. How have things been since we last talked? Good. Good. How you been? Been well. Ready to get some- Nothing to do, just hanging out and you know.
```

Why it matters:
- this is the only candidate here that gives us a real Apple-native stack and a realistic non-Swift integration path at the same time
- the local server option is especially important because Minutes is not a Swift app

Caveat:
- we did **not** capture a privileged `powermetrics` sample during the WhisperKit run in this session, so we do not have the ANE mW number yet

### B. parakeet-mlx

Primary-source facts:
- installs as a Python CLI
- runs Parakeet on Apple’s MLX stack
- exposes chunking and decoding controls directly in the CLI
- produces structured JSON output with sentence and token timing

What we ran:
- `parakeet-mlx` on the same 20 second sample

Observed behavior:
- ran successfully end to end
- first run was dominated by model load/download
- warm run was very fast
- transcript output was stable across repeated runs

Observed transcript text:

```text
What's happening Matt? How you doing, Wesley? Doing good man. Right on. How have things been since we last talked? Good. Good. How you been? Been well. Ready to get just just hanging out and you know
```

Why it matters:
- this is the most direct “keep Parakeet, upgrade runtime” path
- the warm latency result is impressive

Caveat:
- the user hypothesis was “MLX auto-routes to ANE/GPU”
- I did **not** verify ANE usage from source docs or from privileged power sampling here
- that means I am not willing to claim the ANE story is proven yet

### C. whisper.cpp CoreML

Primary-source facts from upstream:
- Core ML support is official in `whisper.cpp`
- the README explicitly says encoder inference can run on the Apple Neural Engine via Core ML
- upstream documents `generate-coreml-model.sh`
- the expected runtime artifact is a compiled encoder bundle like `ggml-base.en-encoder.mlmodelc`

What we ran:
- we exercised the current `whisper-coreml` selector shape locally

Observed behavior:
- the path attempted to load a CoreML encoder bundle
- it failed because the expected `.mlmodelc` asset was missing
- it then fell back to standard Whisper

Key finding:
- this is **not** yet a real backend in Minutes
- it is currently scaffolding plus fallback behavior

Why it matters:
- this remains the safest route from the current architecture
- but it is also the most incremental route, and only accelerates the encoder side

## Recommendation

**Pick WhisperKit as the winner.**

Why WhisperKit wins:
- It is the strongest Apple-native option that is both mature and practical.
- It already has a CLI and a local server, which lowers the integration cost for a non-Swift product like Minutes.
- It gives us a real path to an Apple-first runtime without pretending the rest of the app has to become Swift.
- It looks more likely than `whisper.cpp` CoreML to become a true backend rather than a half-accelerated stopgap.

Why not `whisper.cpp` CoreML:
- it is still only partially accelerated
- it is currently only a selector with fallback in Minutes, not a finished backend
- even if fully wired, it is still the most incremental option, not the highest-upside option

Why not `parakeet-mlx` as the winner:
- it is the strongest direct Parakeet-upgrade candidate
- but the ANE story is still unproven in this research pass
- and the integration story for Minutes is weaker than WhisperKit’s local-server story unless we are willing to lean into Python more heavily

If ANE/GPU behavior for `parakeet-mlx` is later proven to be materially better than WhisperKit on this machine, that recommendation can change. Right now, WhisperKit is the better balanced bet.

## What we could not fully prove

- We did **not** gather privileged `powermetrics` samples for WhisperKit or `parakeet-mlx` in this session.
- We therefore do **not** have candidate-vs-candidate ANE mW numbers yet.
- We did **not** run a real end-to-end `whisper.cpp` CoreML backend because the model asset pipeline for `.mlmodelc` bundles does not exist in Minutes yet.

These are not reasons to disqualify WhisperKit or `parakeet-mlx`.
They are reasons to be explicit about what is known and what is not.

## Decision quality

This recommendation is based on:
- actual local runs for WhisperKit and `parakeet-mlx`
- actual baseline measurements for current helper-backed Parakeet
- upstream primary-source docs for all three candidates

It is **not** based on:
- architectural inertia
- “already half-wired” bias
- pretending the current `whisper-coreml` path is more mature than it is

## Chosen implementation follow-up

The winner is **WhisperKit**.

Follow-on implementation bead:
- `minutes-ty6k-a`
