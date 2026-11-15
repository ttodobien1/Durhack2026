"""Stage 0 (free-midi-chords): download a pinned release into data/raw/free-midi-chords/.

Source:  https://github.com/ldrolez/free-midi-chords (MIT, Copyright (c) 2019 Ludovic Drolez)
Release: pinned below, so the pieces can always be traced back to the exact zip.

Writes data/raw/free-midi-chords/_download.json with the URL, release tag, sha256
and date of the zip; stage 1 copies that into every record's provenance.
Re-runnable: skips the download if the zip is already there with the same sha256.
"""

import datetime as dt
import hashlib
import io
import json
import subprocess
import zipfile

from common import RAW_DIR

RELEASE_TAG = "v0.20260914"
ZIP_NAME = "free-midi-chords-20260914.zip"
URL = f"https://github.com/ldrolez/free-midi-chords/releases/download/{RELEASE_TAG}/{ZIP_NAME}"
LICENSE_URL = f"https://github.com/ldrolez/free-midi-chords/blob/{RELEASE_TAG}/LICENSE"
OUT_DIR = RAW_DIR / "free-midi-chords"


def main() -> None:
    meta_path = OUT_DIR / "_download.json"
    zip_path = OUT_DIR / ZIP_NAME
    if meta_path.exists() and zip_path.exists():
        meta = json.loads(meta_path.read_text())
        if hashlib.sha256(zip_path.read_bytes()).hexdigest() == meta["sha256"]:
            print(f"{ZIP_NAME} already present (sha256 ok), skipping download.")
            return report(meta)

    print(f"Downloading {URL} ...")
    payload = subprocess.run(["curl", "-fsSL", URL], check=True, capture_output=True).stdout
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    zip_path.write_bytes(payload)

    extract_dir = (OUT_DIR / "extracted").resolve()
    with zipfile.ZipFile(io.BytesIO(payload)) as zf:
        for member in zf.infolist():
            target = (extract_dir / member.filename).resolve()
            if extract_dir not in target.parents and target != extract_dir:
                print(f"  skipping unsafe path: {member.filename}")
                continue
            if member.is_dir():
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(zf.read(member))

    meta = {
        "source": "free-midi-chords",
        "repository": "https://github.com/ldrolez/free-midi-chords",
        "release": RELEASE_TAG,
        "url": URL,
        "sha256": hashlib.sha256(payload).hexdigest(),
        "bytes": len(payload),
        "downloaded": dt.date.today().isoformat(),
        "license": "MIT",
        "license_url": LICENSE_URL,
        "copyright": "Copyright (c) 2019 Ludovic Drolez",
    }
    meta_path.write_text(json.dumps(meta, indent=1) + "\n")
    report(meta)


def report(meta: dict) -> None:
    midis = list((OUT_DIR / "extracted").rglob("*.mid"))
    print("\n=== Report: stage 0 (free-midi-chords) ===")
    print(f"release: {meta['release']}  zip sha256: {meta['sha256'][:16]}…  ({meta['bytes'] / 1e6:.1f} MB)")
    print(f"MIDI files extracted: {len(midis)}")


if __name__ == "__main__":
    main()
