#!/usr/bin/env python3
"""検証用の音声（macOS の say + ffmpeg）とアイコンを生成する。"""
import struct
import subprocess
import tempfile
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
AUDIO_DIR = ROOT / "audio"
PUBLIC_DIR = ROOT / "public"
SENTENCES = 8


def script(label: str) -> str:
    body = "".join(f"これは項目{label}の{i + 1}番目の文です。画面を消したまま、次の項目に進むかを確認しています。" for i in range(SENTENCES))
    return f"項目{label}を開始します。{body}項目{label}を終わります。"


def synthesize(item_id: str, label: str) -> None:
    with tempfile.TemporaryDirectory() as tmp:
        aiff = Path(tmp) / "speech.aiff"
        subprocess.run(["say", "-v", "Kyoko", "-o", str(aiff), script(label)], check=True)
        subprocess.run(
            [
                "ffmpeg", "-y", "-loglevel", "error", "-i", str(aiff),
                "-ac", "1", "-ar", "24000", "-c:a", "libmp3lame", "-b:a", "64k",
                "-write_xing", "0", "-id3v2_version", "0", "-f", "mp3",
                str(AUDIO_DIR / f"{item_id}.mp3"),
            ],
            check=True,
        )


def png(size: int, path: Path) -> None:
    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data))

    row = b"\x00" + bytes([0x14, 0x21, 0x3d]) * size
    data = zlib.compress(row * size)
    header = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", data) + chunk(b"IEND", b""))


def main() -> None:
    AUDIO_DIR.mkdir(exist_ok=True)
    for item_id, label in [("a", "エー"), ("b", "ビー"), ("c", "シー")]:
        synthesize(item_id, label)
    png(192, PUBLIC_DIR / "icon-192.png")
    png(512, PUBLIC_DIR / "icon-512.png")


if __name__ == "__main__":
    main()
