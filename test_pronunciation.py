from __future__ import annotations

import base64, json, time, urllib.error, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent
API_FILE = ROOT / "api.txt"
SAMPLES = ROOT / "stt_samples"
MANIFEST = SAMPLES / "manifest.json"
API_BASE = "https://generativelanguage.googleapis.com/v1beta"
MODELS = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3.6-flash"]
SKIP_KEYS = {4}
TIMEOUT = 45

STRICTNESS = {
    "1": {
        "name": "Easy",
        "max_problems": 2,
        "instruction": (
            "Be encouraging and lenient. Report only pronunciation issues that clearly "
            "hurt intelligibility or make a word noticeably wrong. Do not penalize a harmless accent."
        ),
    },
    "2": {
        "name": "Normal",
        "max_problems": 4,
        "instruction": (
            "Use normal pronunciation-teacher standards. Report clear vowel/consonant, word stress, "
            "rhythm, fluency, or intonation issues, even when the sentence is still understandable."
        ),
    },
    "3": {
        "name": "Strict",
        "max_problems": 6,
        "instruction": (
            "Be a demanding pronunciation coach. Listen critically to every word. Report subtle but "
            "clearly audible vowel quality/length, consonant articulation, consonant clusters, final sounds, "
            "word stress, linking, rhythm, reductions, and intonation issues. Do not give 95-100 unless the "
            "speech is genuinely near-native for this sentence. A clearly non-native but fully understandable "
            "reading should normally score around 70-90, depending on severity. Do not invent errors that are "
            "not audible and do not penalize accent identity by itself."
        ),
    },
}


def keys():
    raw = [x.strip() for x in API_FILE.read_text(encoding="utf-8-sig").splitlines() if x.strip() and not x.strip().startswith("#")]
    return [(i, k) for i, k in enumerate(raw, 1) if i not in SKIP_KEYS]


def mask(k):
    return f"{k[:4]}...{k[-4:]}"


def samples():
    rows = json.loads(MANIFEST.read_text(encoding="utf-8"))["samples"]
    for r in rows:
        if not (SAMPLES / r["file"]).exists():
            raise SystemExit("Run run_stt_test.bat first to prepare sample WAV files.")
    return rows


def choose_strictness():
    print("Teacher strictness:")
    print("  1 = Easy   - only errors that hurt understanding")
    print("  2 = Normal - clear learner pronunciation issues")
    print("  3 = Strict - picky: sounds + stress + rhythm + intonation")
    choice = input("Choose [1/2/3, default=2]: ").strip() or "2"
    if choice not in STRICTNESS:
        print("Invalid choice; using Normal.")
        choice = "2"
    return STRICTNESS[choice]


def prompt(reference, mode):
    return f'''You are an English pronunciation coach for a Japanese learner.
Teacher mode: {mode["name"]}.
Reference sentence: "{reference}"

{mode["instruction"]}

Listen to the audio and judge ONLY what is clearly audible. Do not invent typical Japanese-accent errors.
Assess pronunciation, word stress, fluency/rhythm, and intonation. Do not judge grammar or meaning.
For pronunciation, compare the actual sounds to natural standard English, not merely whether STT recognized the word.
If a word is understood but a sound is noticeably off, you may still report it in Normal/Strict mode.

Return ONLY JSON:
{{"recognized_text":"...","overall_score":0,"pronunciation_score":0,"fluency_score":0,"intonation_score":0,
"problems":[{{"word":"...","severity":"yellow|red","sound":"short issue","heard_like":"...","tip_ja":"short concrete advice in Japanese"}}],
"summary_ja":"short coaching note in Japanese"}}
Use 0-100 scores. List at most {mode["max_problems"]} clearly audible problems. If no clear problem exists, return an empty problems array.'''


def extract(payload):
    c = payload.get("candidates") or []
    if not c:
        return ""
    return "".join(p.get("text", "") for p in c[0].get("content", {}).get("parts", []) if isinstance(p, dict)).strip()


def err(data):
    try:
        e = json.loads(data.decode("utf-8", "replace")).get("error", {})
        return f"{e.get('status','')}: {e.get('message','Unknown error')}".strip(": ")
    except Exception:
        return data.decode("utf-8", "replace")[:300]


def analyze(key, model, wav, reference, mode):
    body = {
        "contents": [{"role": "user", "parts": [
            {"text": prompt(reference, mode)},
            {"inlineData": {"mimeType": "audio/wav", "data": base64.b64encode(wav.read_bytes()).decode("ascii")}},
        ]}],
        "generationConfig": {"temperature": 0.1, "maxOutputTokens": 900, "responseMimeType": "application/json"},
    }
    url = f"{API_BASE}/models/{urllib.parse.quote(model, safe='')}:generateContent?key={urllib.parse.quote(key)}"
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"Content-Type": "application/json"}, method="POST")
    t = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as r:
            payload = json.loads(r.read().decode("utf-8", "replace"))
    except urllib.error.HTTPError as e:
        return None, time.perf_counter() - t, f"HTTP {e.code} - {err(e.read())}"
    except Exception as e:
        return None, time.perf_counter() - t, str(e)
    dt = time.perf_counter() - t
    text = extract(payload).strip()
    if text.startswith("```"):
        text = "\n".join(text.splitlines()[1:-1]).strip()
    try:
        obj = json.loads(text)
    except Exception:
        return None, dt, f"invalid/empty JSON: {text[:120]!r}"
    return obj, dt, ""


def score(v):
    try:
        return max(0, min(100, int(round(float(v)))))
    except Exception:
        return 0


def main():
    mode = choose_strictness()
    ks, rows = keys(), samples()
    print("\n" + "=" * 86)
    print("E-KAIWA - PRONUNCIATION TEST (ELSA-LIKE PROTOTYPE)")
    print("=" * 86)
    print("Models : " + ", ".join(MODELS))
    print(f"Teacher: {mode['name']}")
    print(f"Keys   : {len(ks)} active / key #4 skipped")
    print("Note   : smoke test, not true phoneme-level scoring.\n")

    ok_count, total_times, wins = 0, [], {}
    for i, row in enumerate(rows, 1):
        kn, key = ks[(i - 1) % len(ks)]
        wav, ref = SAMPLES / row["file"], row["expected"]
        print(f"[{i}/{len(rows)}] {wav.name}  key={kn} [{mask(key)}]")
        print(f"  Reference: {ref}")
        result = used = None
        total = 0.0
        for model in MODELS:
            obj, dt, error = analyze(key, model, wav, ref, mode)
            total += dt
            if obj is not None:
                result, used = obj, model
                print(f"  [OK] {model} {dt:.2f}s")
                break
            print(f"  [FAIL] {model} {dt:.2f}s - {error[:160]}")

        if result is None:
            print("  RESULT: failed\n")
            continue

        ok_count += 1
        total_times.append(total)
        wins[used] = wins.get(used, 0) + 1
        print(f"  Heard    : {result.get('recognized_text','')}")
        print(f"  Scores   : overall={score(result.get('overall_score'))}  pronunciation={score(result.get('pronunciation_score'))}  fluency={score(result.get('fluency_score'))}  intonation={score(result.get('intonation_score'))}")
        probs = result.get("problems") or []
        if not probs:
            print("  Problems : none clearly detected")
        else:
            print("  Problems :")
            for p in probs[:mode["max_problems"]]:
                heard = f" heard≈{p.get('heard_like')}" if p.get('heard_like') else ""
                print(f"    [{str(p.get('severity','yellow')).upper()}] {p.get('word','?')} [{p.get('sound','')}]" + heard)
                if p.get("tip_ja"):
                    print(f"             -> {p['tip_ja']}")
        print(f"  Coach JA : {result.get('summary_ja','')}")
        print(f"  Used     : {used}")
        print(f"  Total    : {total:.2f}s\n")

    print("-" * 86)
    print(f"Success        : {ok_count}/{len(rows)}")
    if total_times:
        print(f"Average latency: {sum(total_times) / len(total_times):.2f}s")
    print("Model wins     :")
    for m, c in sorted(wins.items(), key=lambda x: (-x[1], x[0])):
        print(f"  {m}: {c}")
    print("\nUse this to judge whether Gemini feedback is useful/stable; do not treat numeric scores as authoritative yet.")
    return 0 if ok_count else 1


if __name__ == "__main__":
    raise SystemExit(main())
