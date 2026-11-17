#!/usr/bin/env python3
"""Check B04 implementation mutations against the Lean-generated MCP scenarios.

Only disposable project copies are changed. Installed dependencies are reused,
while Vite/Vitest caches and all test data remain in each disposable copy.
"""

import argparse
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent
MANIFEST = Path('formal/phase-implementation-mutations.json')
FIXTURE = Path('tests/fixtures/mcp-add-pufu-phase-model.json')
TEST_FILE = Path('tests/mcp-add-pufu-phase-model.test.ts')
CASE_COUNT = 16
RUN_TIMEOUT = 180
# Copy only project inputs, never local credentials, databases or build outputs.
INPUT_DIRECTORIES = {'server', 'shared', 'src', 'public', 'tests', 'migrations', 'scripts', 'packages', 'patches'}
INPUT_FILES = {
    'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'tsconfig.json',
    'vitest.config.ts', 'vite.config.ts', 'wrangler.jsonc', 'wrangler.json', 'wrangler.toml',
}
MUTABLE_DEPENDENCY_ENTRIES = {'.pnpm-task-run-state-v1', '.pnpm-workspace-state-v1.json'}
ASSERTION = re.compile(r'^AssertionError:')
TIMEOUT = re.compile(r'(?:Test|Hook) timed out|TimeoutError:|timed out in \d+', re.I)
UNHANDLED = re.compile(r'Unhandled (?:Errors?|Rejection)|uncaughtException|unhandledRejection', re.I)


class ImplementationError(RuntimeError):
    def __init__(self, category, message):
        self.category = category
        super().__init__(f'{category}: {message}')


def require(condition, category, message):
    if not condition:
        raise ImplementationError(category, message)


def relative_path(value):
    require(isinstance(value, str) and value, 'invalid_manifest', 'A relative path is required')
    path = Path(value)
    require(not path.is_absolute() and '..' not in path.parts, 'invalid_manifest', f'Unsafe path: {value}')
    return path


def load_cases(root):
    data = json.loads((root / FIXTURE).read_text())
    require(data.get('version') == 1, 'invalid_fixture', 'Unsupported fixture version')
    cases = data.get('cases')
    require(isinstance(cases, list) and len(cases) == CASE_COUNT, 'invalid_fixture', f'Expected {CASE_COUNT} Lean scenarios')
    identities = [case.get('id') if isinstance(case, dict) else None for case in cases]
    require(all(isinstance(identity, str) and re.fullmatch(r'[a-z][a-z0-9-]*', identity) for identity in identities), 'invalid_fixture', 'Invalid scenario ID')
    require(len(set(identities)) == len(identities), 'invalid_fixture', 'Duplicate scenario ID')
    return identities


def load_mutations(root, cases):
    data = json.loads((root / MANIFEST).read_text())
    require(data.get('version') == 1, 'invalid_manifest', 'Unsupported mutation version')
    mutations = data.get('mutations')
    require(isinstance(mutations, list) and mutations, 'invalid_manifest', 'Mutations are required')
    names = set()
    for mutation in mutations:
        require(isinstance(mutation, dict), 'invalid_manifest', 'Mutation must be an object')
        name = mutation.get('name')
        require(isinstance(name, str) and re.fullmatch(r'[a-z][a-z0-9-]*', name), 'invalid_manifest', 'Invalid mutation name')
        require(name not in names, 'invalid_manifest', f'Duplicate mutation: {name}')
        names.add(name)
        require(mutation.get('expectedCase') in cases, 'invalid_manifest', f'{name}: expectedCase is absent from Lean fixture')
        edits = mutation.get('edits')
        require(isinstance(edits, list) and edits, 'invalid_manifest', f'{name}: edits are required')
        for edit in edits:
            require(isinstance(edit, dict), 'invalid_manifest', f'{name}: edit must be an object')
            path = relative_path(edit.get('file'))
            require(path.parts[0] == 'server' and path.suffix == '.ts', 'invalid_manifest', 'Only server TypeScript may be mutated')
            require(isinstance(edit.get('old'), str) and edit['old'], 'invalid_manifest', f'{name}: old text is required')
            require(isinstance(edit.get('new'), str) and edit['new'] != edit['old'], 'invalid_manifest', f'{name}: mutation must change the source')
    return mutations


def project_files(root):
    result = subprocess.run(
        ['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
        cwd=root, capture_output=True, check=True, timeout=30, shell=False,
    )
    paths = set()
    for value in os.fsdecode(result.stdout).split('\0'):
        if not value:
            continue
        path = relative_path(value)
        # An explicitly tracked private artifact must not bypass this filter.
        if any(part.startswith(('.env', '.dev.vars')) or part in {
            'node_modules', '.git', 'dist', '.wrangler', '.cache', '.vite',
            'secrets', '.secrets', 'backups', 'dumps', 'coverage',
        } for part in path.parts):
            continue
        if path.suffix in {'.db', '.sqlite', '.sqlite3', '.pem', '.key', '.p12', '.pfx', '.har', '.log'}:
            continue
        if path.parts[0] in INPUT_DIRECTORIES or path.as_posix() in INPUT_FILES:
            if (root / path).is_file():
                paths.add(path)
    return sorted(paths)


def copy_project(root, destination, paths):
    destination.mkdir(parents=True)
    for path in paths:
        source = root / path
        require(not source.is_symlink(), 'unsafe_copy', f'Project input must be a regular file: {path}')
        target = destination / path
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)
    dependencies = root / 'node_modules'
    require(dependencies.is_dir(), 'missing_dependencies', 'Install dependencies before running this check')
    target_dependencies = destination / 'node_modules'
    target_dependencies.mkdir()
    for entry in dependencies.iterdir():
        if entry.name.startswith(('.vite', '.cache', '.vitest')) or entry.name in MUTABLE_DEPENDENCY_ENTRIES:
            continue
        (target_dependencies / entry.name).symlink_to(entry.absolute(), target_is_directory=entry.is_dir())


def apply_mutation(directory, mutation):
    # Validate every edit before writing any file, including multi-edit mutants.
    changed = {}
    for edit in mutation['edits']:
        path = directory / relative_path(edit['file'])
        source = changed.get(path, path.read_text())
        count = source.count(edit['old'])
        require(count == 1, 'stale_mutation', f"{mutation['name']}: expected one occurrence in {edit['file']}, found {count}")
        changed[path] = source.replace(edit['old'], edit['new'], 1)
    for path, source in changed.items():
        path.write_text(source)


class RunResult:
    def __init__(self, code, output='', report=None, timed_out=False):
        self.code = code
        self.output = output
        self.report = report
        self.timed_out = timed_out


def run_vitest(directory, expected_case=None):
    report_path = directory / 'phase-vitest-report.json'
    command = [
        'pnpm', 'exec', 'vitest', 'run', str(TEST_FILE), '--maxWorkers=1',
        '--reporter=json', f'--outputFile={report_path}',
    ]
    if expected_case is not None:
        command.append(f'--testNamePattern=^B04 model: {re.escape(expected_case)}$')
    environment = os.environ.copy()
    # pnpm 11 otherwise auto-installs when the disposable workspace state differs.
    # Reuse installed packages only; neither this check nor pnpm may install.
    environment['npm_config_verify_deps_before_run'] = 'false'
    environment['pnpm_config_verify_deps_before_run'] = 'false'
    for variable, name in [('XDG_CACHE_HOME', '.cache'), ('TMPDIR', '.tmp')]:
        path = directory / name
        path.mkdir()
        environment[variable] = str(path)
    process = subprocess.Popen(
        command, cwd=directory, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, env=environment, shell=False, start_new_session=True,
    )
    timed_out = False
    try:
        output, _ = process.communicate(timeout=RUN_TIMEOUT)
    except subprocess.TimeoutExpired:
        timed_out = True
        # Kill pnpm, Vitest workers and workerd together; none may outlive cleanup.
        os.killpg(process.pid, signal.SIGKILL)
        output, _ = process.communicate(timeout=10)
    report = None
    if report_path.is_file():
        try:
            report = json.loads(report_path.read_text())
        except (ValueError, OSError):
            report = 'invalid JSON'
    return RunResult(process.returncode, output, report, timed_out)


def report_assertions(result, cases):
    require(not result.timed_out, 'timeout', f'Vitest exceeded {RUN_TIMEOUT}s')
    require(result.report is not None, 'missing_report', 'Vitest did not produce a JSON report')
    report = result.report
    require(isinstance(report, dict), 'invalid_report', 'Vitest report is not a JSON object')
    require(not UNHANDLED.search(result.output), 'environment_failure', 'Vitest reported an unhandled error')
    suites = report.get('testResults')
    require(isinstance(suites, list) and len(suites) == 1, 'collection_failure', 'Expected exactly one collected test file')
    suite = suites[0]
    require(isinstance(suite, dict), 'invalid_report', 'Invalid test file result')
    require(str(suite.get('name', '')).replace('\\', '/').endswith('/' + TEST_FILE.as_posix()), 'collection_failure', 'Report belongs to another test file')
    require(not suite.get('message'), 'collection_failure', f"File import/collection failed: {suite.get('message', '')[:300]}")
    assertions = suite.get('assertionResults')
    require(isinstance(assertions, list) and assertions, 'collection_failure', 'No test assertions were collected')
    titles = [assertion.get('title') if isinstance(assertion, dict) else None for assertion in assertions]
    require(len(titles) == len(cases) and set(titles) == {f'B04 model: {case}' for case in cases}, 'collection_failure', 'Report scenario IDs differ from the Lean fixture')
    require(report.get('numTotalTests') == len(cases), 'invalid_report', 'Incorrect total test count')
    for assertion in assertions:
        messages = assertion.get('failureMessages')
        require(isinstance(messages, list) and all(isinstance(message, str) for message in messages), 'invalid_report', 'Invalid assertion failure messages')
        require(not any(TIMEOUT.search(message) for message in messages), 'timeout', 'A test or hook timed out')
    return suite, assertions


def verify_baseline(result, cases):
    suite, assertions = report_assertions(result, cases)
    require(result.code == 0 and result.report.get('success') is True, 'baseline_failure', 'Unmodified implementation failed')
    require(suite.get('status') == 'passed' and all(assertion.get('status') == 'passed' and not assertion['failureMessages'] for assertion in assertions), 'baseline_failure', 'Every Lean scenario must pass before mutation testing')
    require(result.report.get('numPassedTests') == len(cases) and result.report.get('numFailedTests') == 0 and result.report.get('numPendingTests') == 0 and result.report.get('numTodoTests') == 0, 'baseline_failure', 'Baseline contains failed, skipped or incomplete tests')


def verify_mutation(result, cases, expected_case):
    suite, assertions = report_assertions(result, cases)
    target = next(assertion for assertion in assertions if assertion['title'] == f'B04 model: {expected_case}')
    if target.get('status') == 'passed' and result.code == 0:
        raise ImplementationError('survived', f'{expected_case}: mutated implementation still passed')
    failed = [assertion for assertion in assertions if assertion.get('status') == 'failed']
    require(not any(assertion is not target for assertion in failed), 'unrelated_failure', 'A scenario other than expectedCase failed')
    require(target.get('status') == 'failed', 'target_not_failed', f'{expected_case}: designated scenario did not fail')
    require(target['failureMessages'] and all(ASSERTION.search(message) for message in target['failureMessages']), 'non_assertion_failure', 'Designated scenario failed without an AssertionError (import, runtime or environment error)')
    require(all(assertion is target or assertion.get('status') == 'skipped' for assertion in assertions), 'unexpected_execution', 'Mutation must run only its designated scenario')
    require(result.code == 1 and result.report.get('success') is False and suite.get('status') == 'failed', 'invalid_exit', 'Expected a normal Vitest assertion-failure exit')
    require(result.report.get('numFailedTests') == 1 and result.report.get('numPassedTests') == 0 and result.report.get('numPendingTests') == len(cases) - 1 and result.report.get('numTodoTests') == 0, 'invalid_report', 'Inconsistent mutation result counts')


def check_implementation(root=ROOT):
    cases = load_cases(root)
    mutations = load_mutations(root, cases)
    paths = project_files(root)
    required = {FIXTURE, TEST_FILE, Path('package.json'), Path('vitest.config.ts')}
    required.update(Path(edit['file']) for mutation in mutations for edit in mutation['edits'])
    require(required.issubset(paths), 'missing_input', 'Required project source/config/test/fixture is absent from the Git input list')
    current = None
    try:
        with tempfile.TemporaryDirectory(prefix='pufu-phase-implementation-') as temporary:
            scratch = Path(temporary)
            baseline = scratch / 'baseline'
            copy_project(root, baseline, paths)
            current = run_vitest(baseline)
            verify_baseline(current, cases)
            print(f'Baseline OK: {len(cases)}/{len(cases)} Lean scenarios', flush=True)
            for index, mutation in enumerate(mutations):
                directory = scratch / f'mutation-{index}'
                copy_project(root, directory, paths)
                apply_mutation(directory, mutation)
                current = run_vitest(directory, mutation['expectedCase'])
                verify_mutation(current, cases, mutation['expectedCase'])
                print(f"Detected {mutation['name']}: B04 model: {mutation['expectedCase']} (AssertionError)", flush=True)
                shutil.rmtree(directory)
            print(f'Implementation mutations OK: {len(mutations)}/{len(mutations)}', flush=True)
    except ImplementationError:
        if current is not None and current.output:
            # Diagnostics only, never use a generic nonzero exit as detection.
            print(current.output[-3000:], flush=True)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check-only', action='store_true', help='Validate the fixture, manifest and exact source edits without running Node')
    args = parser.parse_args()
    if args.check_only:
        cases = load_cases(ROOT)
        mutations = load_mutations(ROOT, cases)
        with tempfile.TemporaryDirectory(prefix='pufu-phase-manifest-') as temporary:
            for index, mutation in enumerate(mutations):
                directory = Path(temporary) / str(index)
                for edit in mutation['edits']:
                    target = directory / edit['file']
                    target.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(ROOT / edit['file'], target)
                apply_mutation(directory, mutation)
        print(f'Manifest OK: {len(mutations)} mutations, {sum(len(mutation["edits"]) for mutation in mutations)} exact edits')
    else:
        check_implementation()


if __name__ == '__main__':
    try:
        main()
    except (ImplementationError, OSError, ValueError, subprocess.SubprocessError) as error:
        raise SystemExit(str(error))
