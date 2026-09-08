import os
import platform
import shutil
import socket
import subprocess
import sys


def ok(message):
    print(f"[OK] {message}")


def warn(message):
    print(f"[WARN] {message}")


def fail(message):
    print(f"[FAIL] {message}")


def section(title):
    print(f"\n=== {title} ===")


def check_python():
    section("Python")
    version = platform.python_version()
    print(f"Version: {version}")
    print(f"OS: {platform.system()} {platform.release()} ({platform.machine()})")

    if sys.version_info >= (3, 10):
        ok("Python >= 3.10")
        return True

    fail("Can Python >= 3.10")
    return False


def check_ffmpeg():
    section("FFmpeg")
    ffmpeg = shutil.which("ffmpeg")
    if not ffmpeg:
        warn("Khong tim thay FFmpeg. STT/TTS sau nay co the can no.")
        return False

    try:
        result = subprocess.run(
            [ffmpeg, "-version"],
            capture_output=True,
            text=True,
            timeout=5,
        )
        first_line = result.stdout.splitlines()[0] if result.stdout else ffmpeg
        ok(first_line)
        return True
    except Exception as exc:
        warn(f"Tim thay FFmpeg nhung khong chay duoc: {exc}")
        return False


def check_internet():
    section("Internet")
    targets = [
        ("1.1.1.1", 443),
        ("api.openai.com", 443),
    ]

    for host, port in targets:
        try:
            with socket.create_connection((host, port), timeout=4):
                ok(f"Ket noi duoc {host}:{port}")
                return True
        except OSError:
            pass

    fail("Khong ket noi duoc Internet qua HTTPS")
    return False


def load_audio_libs():
    section("Audio library")
    try:
        import numpy as np
        import sounddevice as sd
    except ImportError as exc:
        fail(f"Thieu package: {exc.name}")
        print("Chay: python -m pip install -r requirements.txt")
        return None, None

    ok("numpy + sounddevice")
    return np, sd


def check_audio_devices(sd):
    section("Audio devices")
    try:
        devices = sd.query_devices()
        default_input, default_output = sd.default.device

        print(f"Default input : {default_input}")
        print(f"Default output: {default_output}")

        input_ok = default_input is not None and int(default_input) >= 0
        output_ok = default_output is not None and int(default_output) >= 0

        if input_ok:
            info = sd.query_devices(default_input)
            ok(f"Microphone: {info['name']}")
        else:
            fail("Khong co default microphone")

        if output_ok:
            info = sd.query_devices(default_output)
            ok(f"Speaker: {info['name']}")
        else:
            fail("Khong co default speaker")

        if not input_ok or not output_ok:
            print("\nDanh sach audio devices:")
            print(devices)

        return input_ok and output_ok
    except Exception as exc:
        fail(f"Khong doc duoc audio devices: {exc}")
        return False


def test_microphone_and_speaker(np, sd):
    section("Microphone + speaker test")
    answer = input("Thu am 3 giay va phat lai? [Y/n]: ").strip().lower()
    if answer not in ("", "y", "yes"):
        warn("Bo qua test thu/phat audio")
        return None

    samplerate = 16000
    duration = 3

    try:
        print("Noi vao microphone trong 3 giay...")
        audio = sd.rec(
            int(duration * samplerate),
            samplerate=samplerate,
            channels=1,
            dtype="float32",
        )
        sd.wait()

        mean_volume = float(np.abs(audio).mean())
        peak_volume = float(np.abs(audio).max())
        print(f"Mean volume: {mean_volume:.6f}")
        print(f"Peak volume: {peak_volume:.6f}")

        if peak_volume < 0.001:
            fail("Tin hieu microphone qua nho / khong co tieng")
            return False

        ok("Microphone thu duoc tin hieu")

        print("Dang phat lai ban thu...")
        sd.play(audio, samplerate)
        sd.wait()
        ok("Playback hoan tat")

        heard = input("Ban co nghe thay giong minh? [Y/n]: ").strip().lower()
        if heard in ("", "y", "yes"):
            ok("Speaker OK")
            return True

        fail("Ban khong nghe thay playback")
        return False
    except Exception as exc:
        fail(f"Audio test loi: {exc}")
        return False


def main():
    print("=" * 56)
    print("E-KAIWA - PC PREFLIGHT")
    print("Test toi thieu truoc khi code STT -> LLM -> TTS")
    print("=" * 56)

    results = {
        "Python": check_python(),
        "FFmpeg": check_ffmpeg(),
        "Internet": check_internet(),
    }

    np, sd = load_audio_libs()
    if np is None or sd is None:
        results["Audio devices"] = False
        results["Mic/Speaker"] = False
    else:
        results["Audio devices"] = check_audio_devices(sd)
        results["Mic/Speaker"] = test_microphone_and_speaker(np, sd)

    section("Summary")
    for name, value in results.items():
        if value is True:
            status = "OK"
        elif value is None:
            status = "SKIP"
        else:
            status = "CHECK"
        print(f"{name:<15} {status}")

    required = [
        results.get("Python") is True,
        results.get("Internet") is True,
        results.get("Audio devices") is True,
    ]

    print()
    if all(required):
        ok("PC du dieu kien co ban de bat dau lam MVP e-kaiwa.")
        if not results.get("FFmpeg"):
            warn("Nen cai FFmpeg truoc khi noi STT/TTS that.")
    else:
        fail("Can sua cac muc CHECK truoc khi bat dau MVP.")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nDa dung test.")
