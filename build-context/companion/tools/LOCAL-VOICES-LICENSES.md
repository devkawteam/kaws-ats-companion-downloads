# KAW Local Natural Voices — third-party notices

The optional local voice engine is assembled on the owner's PC by `kaw-local-voices.ps1`. Nothing below is bundled
in the Companion installer or in this repository; packages come from PyPI (hash-pinned) and model files from the
kokoro-onnx GitHub release (size + SHA-256 checked). Read each project's license before redistributing anything.

| Component | Version | License | Source |
|---|---|---|---|
| Kokoro-82M model (`kokoro-v1.0.onnx`, `voices-v1.0.bin`) | v1.0 | Apache-2.0 | hexgrad/Kokoro-82M; ONNX export via thewh1teagle/kokoro-onnx release `model-files-v1.0` |
| kokoro-onnx | 0.6.1 | MIT | github.com/thewh1teagle/kokoro-onnx |
| onnxruntime | 1.30.0 | MIT | Microsoft |
| **phonemizer** | 3.4.0 | **GPL-3.0-or-later** | github.com/bootphon/phonemizer |
| **espeakng-loader** (bundles `espeak-ng.dll`) | 0.2.4 | loader: see project; **espeak-ng: GPL-3.0-or-later** | github.com/thewh1teagle/espeakng-loader, github.com/espeak-ng/espeak-ng |
| numpy | 2.5.3 | BSD-3-Clause (and bundled permissive licenses) | numpy.org |
| soundfile | 0.14.0 | BSD-3-Clause (bundles libsndfile, LGPL-2.1) | github.com/bastibe/python-soundfile |
| protobuf 7.36.2, flatbuffers 25.12.19, cffi 2.1.1, pycparser 3.0, attrs 26.1.0, joblib 1.6.0, cloudpickle 3.1.2, dlinfo 2.0.0, packaging 26.3, typing-extensions 4.16.0 | — | BSD / MIT / Apache-2.0 / PSF (permissive) | PyPI |

**Note on GPL components:** phonemizer and espeak-ng are GPL-3.0-or-later. Installing them on your own PC to run the
engine is fine; if you ever ship them inside an installer or distribute the environment, the GPL's conditions apply
to that distribution. The Companion itself only talks to the engine over HTTP on 127.0.0.1 and does not include them.

Voices: Kokoro voices are synthetic; they are not imitations of any real person or character.
