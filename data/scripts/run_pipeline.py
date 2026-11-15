"""Run every stage of one collection, in order, stopping at the first failure.

    .venv/bin/python data/scripts/run_pipeline.py --source groove
    .venv/bin/python data/scripts/run_pipeline.py --source fmc
    .venv/bin/python data/scripts/run_pipeline.py --source team

Stage 0 (download) is not run here: it needs the network and is pinned per
collection (00_download.py, 00_download_fmc.py). Team MIDI lives in data/team/.
"""

import subprocess
import sys
from pathlib import Path

from common import source_from_args

HERE = Path(__file__).resolve().parent
INGEST = {"groove": "01_ingest.py", "fmc": "01_ingest_fmc.py", "team": "01_ingest_team.py"}
STAGES = ["02_license.py", "03_content_filter.py", "04_split_by_type.py", "05_slice.py",
          "06_normalize.py", "07_metadata.py", "08_dedupe.py", "09_validate.py", "10_export.py"]


def main() -> None:
    source = source_from_args(__doc__)
    for script in [INGEST[source], *STAGES]:
        print(f"\n##### {script} --source {source}")
        args = [sys.executable, str(HERE / script)]
        if script != INGEST[source]:
            args += ["--source", source]
        if subprocess.run(args).returncode != 0:
            raise SystemExit(f"FAILED at {script}")


if __name__ == "__main__":
    main()
