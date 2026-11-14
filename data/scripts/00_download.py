"""Stage 0: download the Groove MIDI Dataset (MIDI-only) into data/raw/groove/.

Source: https://magenta.tensorflow.org/datasets/groove (CC BY 4.0).
Re-runnable: skips the download if info.csv is already there.
"""

import csv
import io
import ssl
import subprocess
import sys
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

URL = "https://storage.googleapis.com/magentadata/datasets/groove/groove-v1.0.0-midionly.zip"
DATA_DIR = Path(__file__).resolve().parent.parent
RAW_DIR = DATA_DIR / "raw" / "groove"


def download(url: str) -> bytes:
    """Download with urllib; fall back to curl (system certificates) if the
    Python install has no CA bundle (common with python.org builds on macOS)."""
    try:
        with urllib.request.urlopen(url) as resp:
            return resp.read()
    except urllib.error.URLError as err:
        if not isinstance(err.reason, ssl.SSLError):
            raise
        print("  urllib has no SSL certificates, falling back to curl")
        result = subprocess.run(
            ["curl", "-fsSL", url], check=True, capture_output=True
        )
        return result.stdout


def main() -> None:
    info = RAW_DIR / "info.csv"
    if not info.exists():
        print(f"Downloading {URL} ...")
        payload = download(URL)
        print(f"  {len(payload) / 1e6:.1f} MB downloaded")

        RAW_DIR.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(io.BytesIO(payload)) as zf:
            for member in zf.infolist():
                # The zip has a top-level "groove/" folder; strip it.
                parts = Path(member.filename).parts
                if not parts or member.is_dir():
                    continue
                rel = Path(*parts[1:]) if parts[0] == "groove" else Path(*parts)
                # Guard against path traversal.
                target = (RAW_DIR / rel).resolve()
                if RAW_DIR.resolve() not in target.parents:
                    print(f"  skipping unsafe path: {member.filename}")
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(zf.read(member))
    else:
        print("info.csv already present, skipping download.")

    if not info.exists():
        sys.exit("ERROR: info.csv not found after extraction.")

    with info.open(newline="") as f:
        rows = list(csv.DictReader(f))
    midis = list(RAW_DIR.rglob("*.mid"))
    print("\n=== Report: stage 0 ===")
    print(f"info.csv rows: {len(rows)}")
    print(f"MIDI files on disk: {len(midis)}")
    print(f"Columns: {list(rows[0].keys()) if rows else []}")


if __name__ == "__main__":
    main()
