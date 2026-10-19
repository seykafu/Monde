#!/usr/bin/env python3
"""Original procedural Monde ambience; no recordings, speech engines or external assets.

Requires numpy, scipy and ffmpeg/libmp3lame. Seeds and all scheduling are fixed.
Noise/filter/reverb operations are circular; finite events wrap modulo N. MP3 is
lossy, so preview reports both the source seam and the decoded delivery seam.
"""
import argparse
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tempfile

# Universal macOS Python can start under Rosetta while its wheels are ARM-only.
try:
    import numpy as np
except ImportError as exc:
    if sys.platform == 'darwin' and platform.machine() == 'x86_64' and 'incompatible architecture' in str(exc) and not os.environ.get('MONDE_ARM'):
        os.environ['MONDE_ARM'] = '1'
        os.execv('/usr/bin/arch', ['arch', '-arm64', sys.executable, *sys.argv])
    raise
from scipy import signal
from scipy.io import wavfile

SR = 44100
BEDS = {'surf': (60, 1701), 'rigging': (60, 1702), 'gulls': (90, 1703),
        'rain_on_tin': (60, 1704), 'weir': (60, 1705), 'station_wind': (60, 1706),
        'pub_murmur': (75, 1707), 'market_chatter': (75, 1708)}
FFMPEG = shutil.which('ffmpeg') or '/usr/local/bin/ffmpeg'


def noise(rng, n, low=40, high=2000):
    """Smooth band-shaped random spectrum, periodic in exactly n samples."""
    f = np.fft.rfftfreq(n, 1 / SR)
    shape = (f / np.maximum(f, low)) ** 2 / np.sqrt(1 + (f / high) ** 6)
    shape[0] = 0
    z = (rng.normal(size=len(f)) + 1j * rng.normal(size=len(f))) * shape
    x = np.fft.irfft(z, n=n)
    return x / max(np.std(x), 1e-12)


def filter_loop(x, cutoff):
    f = np.fft.rfftfreq(len(x), 1 / SR)
    return np.fft.irfft(np.fft.rfft(x, axis=0) / np.sqrt(1 + (f[:, None] / cutoff) ** 8), n=len(x), axis=0)


def modulation(rng, n, seconds, floor=0.1):
    t = np.arange(n) / n
    cycles = max(1, round(n / SR / seconds))
    wave = (1 + np.sin(2 * np.pi * cycles * t + rng.uniform(0, 2 * np.pi))) / 2
    wave = 0.8 * wave + 0.2 * (1 + np.sin(2 * np.pi * (cycles + 1) * t + rng.uniform(0, 6))) / 2
    return floor + (1 - floor) * wave ** 2


def air(rng, n, low, high, level):
    common = noise(rng, n, low, high)
    return level * np.column_stack([0.65 * common + 0.55 * noise(rng, n, low, high) for _ in range(2)])


def add(out, event, when, pan=0, gain=1):
    """Equal-power panning limited to the inner stereo field; wrap event tails."""
    angle = (np.clip(pan, -0.8, 0.8) + 1) * np.pi / 4
    indices = (int(when * SR) + np.arange(len(event))) % len(out)
    for channel, level in enumerate((np.cos(angle), np.sin(angle))):
        np.add.at(out[:, channel], indices, event * gain * level)


def envelope(n, attack=0.03):
    t = np.arange(n) / SR
    return (1 - np.exp(-t / attack)) * np.minimum(1, (n / SR - t) / 0.03) ** 2


def impact(rng, duration, frequencies, decay=0.08):
    t = np.arange(int(duration * SR)) / SR
    x = sum(np.sin(2 * np.pi * f * t) * np.exp(-t / (decay * rng.uniform(0.6, 1.4))) for f in frequencies)
    x += 0.15 * noise(rng, len(t), 300, 3500) * np.exp(-t / 0.015)
    return x * envelope(len(t), 0.001) * np.minimum(1, (duration - t) / 0.04)


def reverb(rng, out, seconds, wet):
    """Synthetic decaying noise IR, circular convolution (including tail at start)."""
    count = int(seconds * SR)
    for c in range(2):
        ir = rng.normal(size=count) * np.exp(-np.arange(count) / (SR * seconds / 7))
        ir[:int(0.018 * SR)] = 0
        ir /= np.linalg.norm(ir)
        padded = np.zeros(len(out)); padded[:count] = ir
        out[:, c] += wet * np.fft.irfft(np.fft.rfft(out[:, c]) * np.fft.rfft(padded), n=len(out))
    return out


def surf(rng, n):
    swell = modulation(rng, n, 7.5, 0.16)
    out = air(rng, n, 65, 650, 0.32) * swell[:, None]
    out += air(rng, n, 600, 2600, 0.07) * np.roll(swell, SR)[:, None]
    for when in rng.uniform(0, n / SR, 42):
        d = rng.uniform(0.3, 1.2); t = np.arange(int(d * SR)) / SR
        slap = noise(rng, len(t), 130, 1100) * envelope(len(t), 0.018) * np.exp(-t / 0.18)
        add(out, slap, when, rng.uniform(-0.7, 0.7), 0.12)
    return out


def rigging(rng, n):
    out = air(rng, n, 90, 500, 0.006)
    for when in rng.uniform(0, n / SR, 24):
        # One halyard per cluster keeps its own pitch; clusters differ (a fixed partial rang as one note, +25 dB).
        base, pan = rng.uniform(1100, 1800), rng.uniform(-0.7, 0.7)
        partial = base * rng.uniform(1.45, 2.05)
        for offset in np.cumsum(rng.uniform(0.12, 0.5, rng.integers(2, 5))):
            add(out, impact(rng, 0.5, [base, partial], 0.07), when + offset, pan, 0.08 * rng.uniform(0.7, 1.1))
    for when in rng.uniform(0, n / SR, 19):
        d = rng.uniform(0.7, 2.2); t = np.arange(int(d * SR)) / SR
        friction = noise(rng, len(t), 90, 800)
        pulses = (0.5 + 0.5 * np.sin(2 * np.pi * (16 * t + 9 * t ** 2))) ** 6
        creak = friction * pulses + 0.3 * np.sin(2 * np.pi * (180 * t + 25 * np.sin(3 * t)))
        add(out, creak * np.sin(np.pi * t / d) ** 2, when, rng.uniform(-0.7, 0.7), 0.09)
    for when in rng.uniform(0, n / SR, 9):
        add(out, impact(rng, 0.5, [95, 173, 310], 0.07), when, rng.uniform(-0.6, 0.6), 0.1)
    return reverb(rng, out, 0.3, 0.08)


def gull_call(rng, duration, laughing=False):
    t = np.arange(int(duration * SR)) / SR; u = t / duration
    pitch = rng.uniform(620, 850) * (0.8 + 0.5 * np.exp(-((u - 0.22) / 0.16) ** 2) - 0.23 * u)
    pitch += 22 * np.sin(2 * np.pi * 26 * t)
    phase = 2 * np.pi * np.cumsum(pitch) / SR
    x = sum(np.sin(h * phase) / h ** 1.25 for h in range(1, 9))
    x += 0.1 * noise(rng, len(t), 700, 2600)
    env = np.sin(np.pi * u) ** 1.5
    if laughing: env *= (0.5 + 0.5 * np.sin(2 * np.pi * 4.8 * t)) ** 3
    return x * env


def gulls(rng, n):
    out = air(rng, n, 100, 550, 0.002)
    when = 0.8
    while when < n / SR:
        far = rng.random() < 0.6
        call = gull_call(rng, rng.uniform(0.5, 1.2) if rng.random() < 0.7 else 2.1, rng.random() < 0.3)
        if far: call = filter_loop(call[:, None], 1500)[:, 0]
        add(out, call, when, rng.uniform(-0.75, 0.75), 0.055 if far else 0.13)
        if rng.random() < 0.25:
            add(out, gull_call(rng, 0.65), when + 1.1, rng.uniform(-0.7, 0.7), 0.045)
        when += rng.uniform(2, 6)
    for when in rng.uniform(0, n / SR, 6):
        t = np.arange(int(0.8 * SR)) / SR
        add(out, noise(rng, len(t), 140, 900) * np.sin(np.pi * t / 0.8) ** 2 * (0.5 + 0.5 * np.sin(2 * np.pi * 8 * t)) ** 4, when, 0.3, 0.025)
    return reverb(rng, out, 0.65, 0.14)


def rain_on_tin(rng, n):
    out = air(rng, n, 450, 3500, 0.045)
    # Hundreds of small drops per second, with varied roof resonances.
    # Forty roof notes, not five: a few fixed drop pitches summed into a faint chord.
    drops = [impact(rng, 0.12, [f, f * rng.uniform(1.5, 1.9)], 0.015) for f in rng.uniform(650, 2500, 40)]
    for when in rng.uniform(0, n / SR, int(n / SR * 105)):
        add(out, drops[rng.integers(len(drops))], when, rng.uniform(-0.75, 0.75), rng.uniform(0.008, 0.033))
    for when in rng.uniform(0, n / SR, 30):
        add(out, impact(rng, 0.24, [680, 1120], 0.055), when, -0.45, 0.05)
    return out * modulation(rng, n, 15, 0.8)[:, None]


def weir(rng, n):
    out = air(rng, n, 80, 1100, 0.23)
    out += air(rng, n, 600, 2600, 0.045)
    out *= modulation(rng, n, 12, 0.75)[:, None]
    for when in rng.uniform(0, n / SR, 360):
        d = rng.uniform(0.05, 0.24); t = np.arange(int(d * SR)) / SR
        bubble = np.sin(2 * np.pi * (rng.uniform(180, 550) * t + 700 * t ** 2)) * np.sin(np.pi * t / d) ** 2
        add(out, bubble, when, rng.uniform(-0.7, 0.7), 0.055)
    return out


def station_wind(rng, n):
    gust = modulation(rng, n, 15, 0.06)
    out = air(rng, n, 35, 330, 0.3) * gust[:, None]
    out += air(rng, n, 700, 2100, 0.035) * gust[:, None] ** 2
    t = np.arange(n) / SR
    whistle = np.sin(2 * np.pi * (420 * t + 3 * np.sin(2 * np.pi * 3 * t / (n / SR))))
    out += whistle[:, None] * modulation(rng, n, 20, 0)[:, None] ** 8 * 0.008
    return out


VOWELS = np.array([[730, 1090, 2440], [530, 1840, 2480], [270, 2290, 3010], [570, 840, 2410], [300, 870, 2240]])


def voice(rng, duration, base):
    """Jittered glottal pulses and moving formants; intentionally no words.

    Resonator coefficients follow vowel targets at syllable rate, interpolated
    across 10 ms blocks. Filter state is retained across coefficient changes.
    """
    n = int(duration * SR); t = np.arange(n) / SR
    knots = np.arange(0, duration + 0.3, 0.16)
    pitch = base * np.interp(t, knots, rng.uniform(0.78, 1.25, len(knots)))
    pitch *= 1 + 0.018 * np.sin(2 * np.pi * rng.uniform(8, 13) * t)
    phase = np.cumsum(pitch) / SR
    pulses = np.maximum(0, np.sin(2 * np.pi * phase)) ** 10
    pulses -= np.mean(pulses)
    syllables = np.interp(t, knots, rng.uniform(0.05, 1, len(knots)))
    syllables *= (0.55 + 0.45 * np.sin(2 * np.pi * rng.uniform(3.2, 5.8) * t)) ** 0.7
    syllables *= np.interp(t, knots, (rng.random(len(knots)) > 0.2).astype(float))
    excitation = pulses * syllables
    targets = VOWELS[rng.integers(0, len(VOWELS), len(knots))] * rng.uniform(0.85, 1.15)
    out = np.zeros(n)
    for formant, bandwidth, weight in zip(range(3), (100, 140, 190), (1, 0.65, 0.3)):
        state = np.zeros(2)
        r = np.exp(-np.pi * bandwidth / SR)
        for start in range(0, n, 441):
            f = np.interp(start / SR, knots, targets[:, formant])
            end = min(n, start + 441)
            chunk, state = signal.lfilter([1 - r], [1, -2 * r * np.cos(2 * np.pi * f / SR), r * r], excitation[start:end], zi=state)
            out[start:end] += weight * chunk
    consonants = noise(rng, n, 1500, 4500) * np.maximum(0, 0.3 - syllables) * 0.045
    out = (out + consonants) * np.sin(np.pi * t / duration) ** 2
    return out / max(np.std(out), 1e-8) * 0.08


def crowd(rng, n, indoors):
    out = air(rng, n, 120, 700, 0.012)
    for _ in range(14 if indoors else 18):
        base = rng.uniform(95, 240); pan = rng.uniform(-0.75, 0.75)
        when = rng.uniform(-4, 1); distance = rng.uniform(0.25, 0.8)
        while when < n / SR:
            duration = rng.uniform(1.3, 4.5)
            phrase = voice(rng, duration, base)
            add(out, phrase, when, pan, distance)
            when += duration + rng.uniform(0.3, 2.5)
    for when in rng.uniform(0, n / SR, 12 if indoors else 5):
        # Laugh-like syllabic bursts / distant, pitched vendor phrases.
        d = rng.uniform(1.2, 2.3); x = voice(rng, d, rng.uniform(150, 230))
        if indoors: x *= (0.5 + 0.5 * np.sin(2 * np.pi * 4.5 * np.arange(len(x)) / SR)) ** 2
        add(out, x, when, rng.uniform(-0.6, 0.6), 0.8)
    for when in rng.uniform(0, n / SR, 22 if indoors else 90):
        # Every glass and every step a little different (one fixed chord stood out of the pub by 17 dB).
        scale = rng.uniform(0.8, 1.25)
        frequencies = [f * scale * rng.uniform(0.96, 1.04) for f in ([2100, 3230, 4510] if indoors else [95, 180, 380])]
        add(out, impact(rng, 0.22, frequencies, 0.045), when, rng.uniform(-0.7, 0.7), 0.03 if indoors else 0.06)
    for when in rng.uniform(0, n / SR, 6):
        d = rng.uniform(0.6, 1.6); t = np.arange(int(d * SR)) / SR
        scrape = noise(rng, len(t), 180, 1600) * np.sin(np.pi * t / d) ** 2
        if not indoors: scrape *= (0.5 + 0.5 * np.sin(2 * np.pi * 18 * t)) ** 4
        add(out, scrape, when, rng.uniform(-0.6, 0.6), 0.035)
    return filter_loop(reverb(rng, out, 0.65 if indoors else 0.22, 0.23 if indoors else 0.09), 750 if indoors else 3600)


def pub_murmur(rng, n):
    return crowd(rng, n, True)


def market_chatter(rng, n):
    return crowd(rng, n, False)


def measure(path):
    result = subprocess.run([FFMPEG, '-hide_banner', '-i', str(path), '-af', 'loudnorm=I=-18:TP=-1:print_format=json', '-f', 'null', '-'], capture_output=True, text=True, check=True)
    data = json.JSONDecoder().raw_decode(result.stderr[result.stderr.rfind('{'):])[0]
    return float(data['input_i']), float(data['input_tp'])


def encode(wav, destination):
    subprocess.run([FFMPEG, '-v', 'error', '-y', '-i', str(wav), '-map_metadata', '-1', '-c:a', 'libmp3lame', '-q:a', '4', '-ar', str(SR), str(destination)], check=True)


def normalise(x, wav, destination):
    """Static gain, with smooth saturation only if crest factor needs reducing.

    Measure the delivered MP3, allowing headroom for codec overshoot. No dynamic
    loudnorm processing: its start/end state would break the circular timeline.
    """
    x -= x.mean(axis=0)
    x /= max(np.max(np.abs(x)), 1e-12)
    for _ in range(8):
        wavfile.write(wav, SR, x.astype(np.float32))
        loudness, peak = measure(wav)
        gain = 10 ** ((-18 - loudness) / 20)
        if peak + 20 * np.log10(gain) > -1.7:
            x = np.tanh(x * 1.7)
            continue
        x *= gain
        wavfile.write(wav, SR, x.astype(np.float32))
        encode(wav, destination)
        loudness, peak = measure(destination)
        if peak < -1 and abs(loudness + 18) < 0.35:
            return x, loudness, peak
        if peak >= -1: x = np.tanh(x * 2)
        else: x *= 10 ** ((-18 - loudness) / 20)
    raise RuntimeError(f'Unable to meet loudness/peak target: {destination}')


def seam(x):
    edge = int(0.05 * SR)
    first = np.sqrt(np.mean(x[:edge] ** 2)); last = np.sqrt(np.mean(x[-edge:] ** 2))
    jump = np.sqrt(np.mean((x[0] - x[-1]) ** 2))
    step = np.sqrt(np.mean(np.diff(x, axis=0) ** 2))
    return f'{first:.6f}/{last:.6f}; jump {jump:.6f}, step {step:.6f}, ratio {jump / max(step, 1e-12):.3f}'


def spectrogram(x, destination):
    """Dependency-free PNG: log-frequency/time spectrogram using stdlib zlib."""
    import struct
    import zlib
    f, _, power = signal.spectrogram(x.mean(axis=1), SR, nperseg=2048, noverlap=1024)
    rows = np.geomspace(40, 16000, 256)
    columns = np.linspace(0, power.shape[1] - 1, 900).astype(int)
    db = 10 * np.log10(np.maximum(power[:, columns], 1e-14))
    grid = np.array([np.interp(rows, f, db[:, i]) for i in range(len(columns))]).T[::-1]
    v = np.clip((grid + 90) / 65, 0, 1)
    rgb = (255 * np.stack([v ** 0.6, v ** 1.4, v ** 3], axis=-1)).astype(np.uint8)
    def chunk(kind, data):
        return struct.pack('!I', len(data)) + kind + data + struct.pack('!I', zlib.crc32(kind + data))
    raw = b''.join(b'\x00' + row.tobytes() for row in rgb)
    destination.write_bytes(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('!2I5B', 900, 256, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b''))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--only', help='Comma-separated bed names, e.g. surf,gulls')
    parser.add_argument('--out', type=Path, default=Path('client/public/audio/ambience'))
    parser.add_argument('--preview', type=Path)
    args = parser.parse_args()
    names = args.only.split(',') if args.only else list(BEDS)
    if any(name not in BEDS for name in names): parser.error('Unknown bed name')
    args.out.mkdir(parents=True, exist_ok=True)
    if args.preview: args.preview.mkdir(parents=True, exist_ok=True)
    report = ['Monde procedural ambience — 44100 Hz stereo, fixed per-bed seeds.',
              'Seam: first/last 50ms RMS; boundary jump and typical adjacent-step RMS (linear full scale).',
              'PNG axes: time left→right, log frequency 40Hz bottom→16kHz top; colour -90→-25 dB/Hz.',
              'MP3 decoded sample count must equal the exact circular source count.']
    with tempfile.TemporaryDirectory(prefix='monde-ambience-') as tmp:
        wav = Path(tmp) / 'source.wav'
        for name in names:
            duration, seed = BEDS[name]; n = duration * SR
            print(f'Rendering {name} ({duration}s)…', flush=True)
            x = globals()[name](np.random.default_rng(seed), n)
            destination = args.out / f'{name}.mp3'
            x, loudness, peak = normalise(x, wav, destination)
            decoded = subprocess.run([FFMPEG, '-v', 'error', '-i', str(destination), '-f', 'f32le', '-acodec', 'pcm_f32le', '-'], capture_output=True, check=True)
            y = np.frombuffer(decoded.stdout, dtype='<f4').reshape(-1, 2)
            if len(y) != n: raise RuntimeError(f'{name}: decoder retained padding: {len(y)} != {n}')
            line = f'{name}: {duration}s; {loudness:.2f} LUFS; {peak:.2f} dBTP; {destination.stat().st_size} bytes\n  source: {seam(x)}\n  decoded: {seam(y)}'
            print(line, flush=True); report.append(line)
            if args.preview: spectrogram(y, args.preview / f'{name}.png')
    if args.preview: (args.preview / 'report.txt').write_text('\n\n'.join(report) + '\n')


if __name__ == '__main__':
    main()
