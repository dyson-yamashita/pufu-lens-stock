#!/usr/bin/env python3
"""Export McpWrites.Oracle.fixture; the Lean model is the only expected-state source."""

import argparse
import json
from pathlib import Path
import subprocess
import tempfile

PROJECT = Path(__file__).resolve().parent
REPOSITORY = PROJECT.parent.parent
FIXTURE = REPOSITORY / 'tests/fixtures/mcp-add-pufu-phase-model.json'
EVALUATION = '''import BoundaryVerification.McpWrites
#eval IO.print BoundaryVerification.McpWrites.Oracle.json
'''


class ExportError(RuntimeError):
    pass


def run(command):
    result = subprocess.run(
        command, cwd=PROJECT, capture_output=True, text=True, timeout=180,
    )
    if result.returncode != 0:
        raise ExportError(
            f'Command failed ({result.returncode}): {" ".join(map(str, command))}\n'
            f'{result.stdout}{result.stderr}'
        )
    return result.stdout


def export():
    # Lake rebuilds stale imports before #eval, including Auth and McpWrites.
    run(['lake', 'build', 'BoundaryVerification.McpWrites'])
    # Keep the evaluator outside the registered source tree. Its only work is
    # importing the registered model and printing that model's serialized value.
    with tempfile.TemporaryDirectory(prefix='pufu-phase-oracle-') as scratch:
        evaluator = Path(scratch) / 'Export.lean'
        evaluator.write_text(EVALUATION, encoding='utf-8')
        stdout = run(['lake', 'env', 'lean', str(evaluator)])
    try:
        data = json.loads(stdout)
    except json.JSONDecodeError as error:
        raise ExportError(f'Lean did not emit a single JSON fixture: {error}') from error
    if not isinstance(data, dict) or data.get('version') != 1:
        raise ExportError('Lean emitted an unsupported fixture version')
    cases = data.get('cases')
    if not isinstance(cases, list) or not cases:
        raise ExportError('Lean emitted no oracle cases')
    ids = [case.get('id') for case in cases if isinstance(case, dict)]
    if (
        len(ids) != len(cases)
        or not all(isinstance(case_id, str) and case_id for case_id in ids)
        or len(set(ids)) != len(ids)
        or not all(isinstance(case.get('steps'), list) and case['steps'] for case in cases)
    ):
        raise ExportError('Lean emitted invalid, duplicate, or empty oracle cases')
    return data, len(cases), sum(len(case['steps']) for case in cases)


def canonical(data):
    # Compare serialized JSON so Python's True == 1 does not hide type drift.
    # Formatting is checked separately by the repository's existing quality job.
    return json.dumps(
        data, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False,
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument('--write', action='store_true', help='regenerate the checked-in fixture')
    mode.add_argument('--check', action='store_true', help='reject fixture drift (default)')
    args = parser.parse_args()
    data, case_count, step_count = export()
    if args.write:
        FIXTURE.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        action = 'Wrote'
    else:
        if not FIXTURE.is_file() or canonical(
            json.loads(FIXTURE.read_text(encoding='utf-8'))
        ) != canonical(data):
            raise ExportError(
                'Lean phase fixture drift: run '
                'python3 formal/boundary-verification/export_phase_cases.py --write'
            )
        action = 'Checked'
    print(f'{action} Lean phase oracle: {case_count} cases / {step_count} steps')
    if args.write:
        print('Format with: pnpm exec prettier --write tests/fixtures/mcp-add-pufu-phase-model.json')


if __name__ == '__main__':
    try:
        main()
    except (ExportError, OSError, ValueError, subprocess.TimeoutExpired) as error:
        raise SystemExit(str(error))
