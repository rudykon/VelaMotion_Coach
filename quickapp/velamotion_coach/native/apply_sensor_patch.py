#!/usr/bin/env python3
"""Apply the pinned VelaMotion six-axis Feature patch to an openvela workspace."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('workspace', type=Path)
parser.add_argument('--check', action='store_true', help='validate without editing upstream')
args = parser.parse_args()
base = Path(__file__).resolve().parent
feature = args.workspace.resolve() / 'frameworks/runtimes/feature'
patch = base / 'sensor-six-axis.patch'
if not feature.is_dir():
    parser.error('Expected frameworks/runtimes/feature in the openvela workspace')
metadata = json.loads((base / 'upstream.json').read_text())
reverse = subprocess.run(['git', 'apply', '--reverse', '--check', str(patch)], cwd=feature, capture_output=True)
if reverse.returncode == 0:
    print('Six-axis patch is already applied.'); raise SystemExit(0)
for name, expected in metadata['files'].items():
    path = feature / name
    if not path.is_file() or hashlib.sha256(path.read_bytes()).hexdigest() != expected:
        parser.error(f'{name} differs from the reviewed upstream baseline; review/rebase the patch instead of overwriting it')
subprocess.run(['git', 'apply', '--check', '--whitespace=error', str(patch)], cwd=feature, check=True)
if args.check:
    print('Patch and upstream hashes verified; no files changed.')
else:
    subprocess.run(['git', 'apply', str(patch)], cwd=feature, check=True)
    print('Patch applied. Rebuild the firmware to regenerate sensor JIDL bindings.')
