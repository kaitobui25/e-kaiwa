# e-kaiwa

MVP preflight test truoc khi code flow:

`USER SPEAK -> STT -> LLM -> reply + correction -> TTS -> continue`

## Chay tren Windows

Yeu cau duy nhat ban dau: **Python 3.10+** da duoc cai va co trong PATH.

```bat
git clone https://github.com/kaitobui25/e-kaiwa.git
cd e-kaiwa
run.bat
```

Hoac double-click `run.bat`.

`run.bat` se tu:

- tao `.venv`
- cai `numpy` + `sounddevice`
- chay `preflight.py`
- cho ban thu microphone 3 giay va phat lai qua speaker

## Preflight kiem tra gi?

- Python >= 3.10
- Internet
- FFmpeg
- microphone
- speaker
- audio device/default device

FFmpeg chua co khong chan viec test ban dau, nhung nen cai truoc khi noi STT/TTS that.

Muc tieu la giu MVP don gian, chua can Docker, database, Redis, GPU hay local LLM.
