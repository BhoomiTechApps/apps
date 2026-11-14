"""
Convert a VITS text-to-speech voice into a voice folder that OCR Studio can
load in the browser. Two kinds of voice are supported:

  Hugging Face VITS voices, such as Meta's MMS Bengali voice
      pip install torch transformers onnx onnxruntime onnxscript
      python convert_voice.py --repo facebook/mms-tts-ben --out ben-mms

  Coqui TTS VITS voices (a config.json and a .pth checkpoint), such as the
  SYSPIN Bengali female voice
      pip install "coqui-tts[codec]" "transformers>=4.57,<5" onnx onnxruntime onnxscript
      python convert_voice.py --repo SYSPIN/vits_Bengali_Female --out ben-syspin-f \\
          --name "Bengali female (SYSPIN)" --licence MIT --credit "SYSPIN project, vits_Bengali_Female"

The kind is detected from the files in --repo (a Hugging Face id or a local
folder); --kind hf|coqui overrides it.

Result: a folder (and a .zip of it) containing
    voice.json     name, licence, credit, sample rate and the letter table
    model.onnx.part1, .part2 …
                   the voice. By default its weights are stored at half
                   precision (about 60 MB): the browser expands them once when
                   the voice loads, so it speaks as fast and as well as the
                   full-size model. --precision full keeps 32-bit weights;
                   --precision int8 is smaller but several times slower, so it
                   is not recommended.
and <out>-test.wav, a test sentence to listen to before installing.

Copy the folder into OCR Studio's  vendor/tts/voices/  and add its name to
vendor/tts/voices/voices.json.

The same script converts a Bishnupriya Manipuri voice fine-tuned later from
volunteer recordings: point --repo at that model folder instead.
"""
import argparse, glob, json, os, shutil, sys

import numpy as np
import torch

SUBSTITUTIONS = {"ৰ": "র", "ৱ": "ব"}   # used only for letters a voice does not know


def half_weights(src, dst):
    """Store float weights at half precision, each followed by a Cast back to
    32-bit. ONNX Runtime folds the casts when the voice loads, so it runs at
    full speed; the difference in sound is far below hearing."""
    import onnx
    from onnx import TensorProto, helper, numpy_helper
    m = onnx.load(src)
    g = m.graph
    halves, casts = [], []
    for init in list(g.initializer):
        if init.data_type == TensorProto.FLOAT and int(np.prod(init.dims)) >= 16:
            h = numpy_helper.from_array(numpy_helper.to_array(init).astype(np.float16), init.name + "__fp16")
            halves.append(h)
            casts.append(helper.make_node("Cast", [h.name], [init.name], to=TensorProto.FLOAT, name=init.name + "__cast"))
            g.initializer.remove(init)
    g.initializer.extend(halves)
    for n in reversed(casts):
        g.node.insert(0, n)
    onnx.save(m, dst)


# ── Hugging Face VITS (transformers) ────────────────────────────────────────

class SpeakHF(torch.nn.Module):
    def __init__(self, model):
        super().__init__()
        self.model = model

    def forward(self, input_ids):
        return self.model(input_ids=input_ids).waveform


def load_hf(repo):
    from transformers import AutoTokenizer, VitsModel
    tok = AutoTokenizer.from_pretrained(repo)
    model = VitsModel.from_pretrained(repo).eval()
    if getattr(tok, "is_uroman", False):
        sys.exit("This voice expects romanised (uroman) input, which OCR Studio does not provide. Choose another voice.")
    if getattr(tok, "phonemize", False):
        sys.exit("This voice expects phonemes (espeak), which OCR Studio does not provide. Choose another voice.")
    if not any("ঀ" <= k <= "৿" for k in tok.get_vocab()):
        sys.exit("This voice's alphabet has no Eastern Nagari letters, so it cannot read OCR Studio's text.")
    encode = lambda text: tok(text, return_tensors="pt").input_ids
    rules = {
        "rules": "hf",
        "add_blank": bool(tok.add_blank),
        "normalize": bool(tok.normalize),
        "blank_id": 0,
        "vocab": tok.get_vocab(),
    }
    return SpeakHF(model).eval(), encode, model.config.sampling_rate, rules


# ── Coqui TTS VITS ──────────────────────────────────────────────────────────

class SpeakCoqui(torch.nn.Module):
    def __init__(self, model):
        super().__init__()
        self.model = model

    def forward(self, input_ids):
        lengths = ( input_ids >= 0 ).sum( dim=1 )
        out = self.model.inference(input_ids, aux_input={
            "x_lengths": lengths, "d_vectors": None, "speaker_ids": None, "language_ids": None, "durations": None,
        })["model_outputs"]
        return out.reshape(out.shape[0], -1)


CLEANERS = {"multilingual_cleaners": "multilingual", "basic_cleaners": "basic"}


def coqui_files(repo):
    folder = repo
    if not os.path.isdir(repo):
        from huggingface_hub import snapshot_download
        print("Downloading", repo, "(the checkpoint can be large) …")
        folder = snapshot_download(repo, allow_patterns=["*.json", "*.pth"])
    config = os.path.join(folder, "config.json")
    ckpts = sorted(glob.glob(os.path.join(folder, "*.pth")), key=lambda p: (os.path.basename(p) != "best_model.pth", p))
    if not os.path.exists(config) or not ckpts:
        sys.exit("A Coqui voice needs config.json and a .pth checkpoint.")
    return config, ckpts[0]


def load_coqui(repo):
    from TTS.config import load_config
    from TTS.tts.models.vits import Vits
    config_path, ckpt = coqui_files(repo)
    config = load_config(config_path)
    if config.model != "vits":
        sys.exit(f"Only Coqui VITS voices are supported (this is '{config.model}').")
    if config.use_phonemes:
        sys.exit("This voice reads phonemes, which OCR Studio does not provide. Choose another voice.")
    cleaner = CLEANERS.get(config.text_cleaner)
    if cleaner is None:
        sys.exit(f"This voice uses the text cleaner '{config.text_cleaner}', which OCR Studio does not reproduce.")
    if config.model_args.num_speakers > 1 or config.model_args.use_language_embedding:
        sys.exit("Only single-speaker, single-language Coqui voices are supported.")
    model = Vits.init_from_config(config)

    try:
        state = torch.load(ckpt, map_location="cpu", weights_only=True)
    except Exception:
        # Older checkpoints also store training objects; load them in full.
        state = torch.load(ckpt, map_location="cpu", weights_only=False)
    weights = state.get("model", state)
    weights = {k: v for k, v in weights.items() if "speaker_encoder" not in k}
    missing, unexpected = model.load_state_dict(weights, strict=False)
    missing = [k for k in missing if not k.startswith("disc.")]
    if missing:
        sys.exit(f"The checkpoint does not match its config ({len(missing)} missing weights, e.g. {missing[0]}).")
    model.disc = None
    model.eval()

    tk = model.tokenizer
    chars = tk.characters
    vocab = {c: i for c, i in chars._char_to_id.items() if len(c) == 1}
    rules = {
        "rules": "coqui",
        "cleaner": cleaner,
        "add_blank": bool(tk.add_blank),
        "blank_id": chars.blank_id if tk.add_blank else None,
        "bos_id": chars.bos_id if tk.use_eos_bos else None,
        "eos_id": chars.eos_id if tk.use_eos_bos else None,
        "vocab": vocab,
    }
    if not any("ঀ" <= k <= "৿" for k in vocab):
        sys.exit("This voice's alphabet has no Eastern Nagari letters, so it cannot read OCR Studio's text.")
    encode = lambda text: torch.LongTensor([tk.text_to_ids(text)])
    return SpeakCoqui(model).eval(), encode, config.audio.sample_rate, rules


def detect_kind(repo):
    if os.path.isdir(repo):
        names = os.listdir(repo)
    else:
        from huggingface_hub import list_repo_files
        names = list_repo_files(repo)
    if any(n.endswith(".pth") for n in names) and "config.json" in names and "tokenizer_config.json" not in names:
        return "coqui"
    return "hf"


# ── Main ────────────────────────────────────────────────────────────────────

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--repo", default="facebook/mms-tts-ben", help="Hugging Face model id or a local folder")
    ap.add_argument("--kind", choices=["auto", "hf", "coqui"], default="auto")
    ap.add_argument("--out", default="ben-mms", help="output folder name (also the voice id)")
    ap.add_argument("--name", default="Bengali (Meta MMS)", help="name shown in OCR Studio")
    ap.add_argument("--language", default="ben")
    ap.add_argument("--licence", default="CC-BY-NC 4.0")
    ap.add_argument("--credit", default="Meta AI, Massively Multilingual Speech (MMS) text-to-speech")
    ap.add_argument("--precision", choices=["half", "full", "int8"], default="half",
                    help="half (default, full speed), full or int8 (smaller, much slower)")
    ap.add_argument("--part-mb", type=int, default=45, help="split files larger than this (GitHub Pages limit is 100 MB)")
    ap.add_argument("--test-text", default="বিষ্ণুপ্রিয়া মণিপুরি ভাষা-সাহিত্যই নিরলে তিনহান দিকেৎত ইতিহাসে অভিলেখ সৃষ্টি করল।")
    a = ap.parse_args()

    kind = detect_kind(a.repo) if a.kind == "auto" else a.kind
    print(f"Loading {a.repo} ({'Coqui TTS' if kind == 'coqui' else 'Hugging Face'} voice) …")
    speak, encode, sr, rules = (load_coqui if kind == "coqui" else load_hf)(a.repo)

    os.makedirs(a.out, exist_ok=True)
    tmp = os.path.join(a.out, "_fp32.onnx")
    ids = encode(a.test_text)
    if ids.shape[1] < 3:
        sys.exit("The test text produced no tokens; is this voice for the Eastern Nagari script?")

    print("Exporting to ONNX …")
    torch.onnx.export(
        speak, (ids,), tmp,
        input_names=["input_ids"], output_names=["waveform"],
        dynamic_axes={"input_ids": {1: "tokens"}, "waveform": {1: "samples"}},
        opset_version=17, do_constant_folding=True, dynamo=False,
    )

    final = os.path.join(a.out, "model.onnx")
    precision = a.precision
    if precision == "full":
        shutil.move(tmp, final)
    elif precision == "half":
        print("Storing weights at half precision …")
        half_weights(tmp, final)
        os.remove(tmp)
    else:
        print("Compressing to 8-bit (smaller but slower) …")
        from onnxruntime.quantization import QuantType, quantize_dynamic
        quantize_dynamic(tmp, final, weight_type=QuantType.QUInt8)
        os.remove(tmp)

    # Check that the browser-format file speaks.
    import time
    import onnxruntime as ort
    opts = ort.SessionOptions()
    opts.intra_op_num_threads = 1
    sess = ort.InferenceSession(final, opts, providers=["CPUExecutionProvider"])
    t0 = time.time()
    wav = sess.run(None, {"input_ids": ids.numpy().astype(np.int64)})[0]
    secs = time.time() - t0
    print(f"Test sentence: {wav.shape[1] / sr:.2f} s of audio made in {secs:.2f} s on one processor core")
    if wav.shape[1] < sr * 0.1 or not np.isfinite(wav).all():
        sys.exit("The converted voice produced no usable audio.")
    import wave
    with wave.open(a.out + "-test.wav", "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes((np.clip(wav[0], -1, 1) * 32767).astype(np.int16).tobytes())
    print(f"Listen to {a.out}-test.wav to check the voice before installing it.")

    # Split large files so they fit static hosts such as GitHub Pages.
    size = os.path.getsize(final)
    part = a.part_mb * 1024 * 1024
    files = ["model.onnx"]
    if size > part:
        files = []
        with open(final, "rb") as f:
            i = 1
            while True:
                chunk = f.read(part)
                if not chunk:
                    break
                name = f"model.onnx.part{i}"
                with open(os.path.join(a.out, name), "wb") as g:
                    g.write(chunk)
                files.append(name)
                i += 1
        os.remove(final)

    voice = {
        "id": a.out,
        "name": a.name,
        "language": a.language,
        "licence": a.licence,
        "credit": a.credit,
        "source": a.repo,
        "precision": precision,
        "sampling_rate": sr,
        **rules,
        "substitutions": SUBSTITUTIONS,
        "files": files,
        "bytes": size,
    }
    with open(os.path.join(a.out, "voice.json"), "w", encoding="utf-8") as f:
        json.dump(voice, f, ensure_ascii=False, indent=1)

    shutil.make_archive(a.out, "zip", ".", a.out)
    print(f"Done: {a.out}/ and {a.out}.zip ({size / 1e6:.0f} MB, {precision}, {len(files)} file(s))")


if __name__ == "__main__":
    main()
