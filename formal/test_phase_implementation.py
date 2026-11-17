"""Pure Python checks for the implementation mutation runner (no Node/Lean)."""

import contextlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

_spec = importlib.util.spec_from_file_location('phase_implementation', Path(__file__).parent / 'check_phase_implementation.py')
check = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(check)

CASES = ['scope-denied'] + [f'case-{index}' for index in range(check.CASE_COUNT - 1)]
SOURCE = Path('server/guard.ts')
MUTATION = {
    'name': 'remove-guard', 'expectedCase': CASES[0],
    'edits': [{'file': str(SOURCE), 'old': 'if (allowed)', 'new': 'if (true)'}],
}


def report(target=None, failure=None):
    assertions = []
    for case in CASES:
        status = 'passed' if target is None or case == target else 'skipped'
        messages = []
        if case == target and failure:
            status, messages = 'failed', [failure]
        assertions.append({'title': f'B04 model: {case}', 'status': status, 'failureMessages': messages})
    failed = sum(assertion['status'] == 'failed' for assertion in assertions)
    passed = sum(assertion['status'] == 'passed' for assertion in assertions)
    return {
        'success': failed == 0,
        'numTotalTests': len(CASES), 'numFailedTests': failed, 'numPassedTests': passed,
        'numPendingTests': len(CASES) - failed - passed, 'numTodoTests': 0,
        'testResults': [{
            'name': '/scratch/' + str(check.TEST_FILE),
            'status': 'failed' if failed else 'passed', 'message': '',
            'assertionResults': assertions,
        }],
    }


class ReportClassificationTests(unittest.TestCase):
    def valid_mutant(self):
        return check.RunResult(1, report=report(CASES[0], 'AssertionError: expected state to equal Lean oracle\n    at test.ts:12:3'))

    def reject(self, category, result):
        with self.assertRaises(check.ImplementationError) as raised:
            check.verify_mutation(result, CASES, CASES[0])
        self.assertEqual(raised.exception.category, category)

    def test_only_designated_assertion_failure_is_detection(self):
        check.verify_mutation(self.valid_mutant(), CASES, CASES[0])

    def test_survived_mutation_is_rejected(self):
        self.reject('survived', check.RunResult(0, report=report(CASES[0])))

    def test_syntax_and_import_errors_are_rejected(self):
        for message in ['SyntaxError: Unexpected token', 'Failed to import ../missing.ts']:
            with self.subTest(message=message):
                result = self.valid_mutant()
                result.report['testResults'][0]['message'] = message
                result.report['testResults'][0]['assertionResults'] = []
                self.reject('collection_failure', result)

    def test_target_runtime_error_is_rejected(self):
        self.reject('non_assertion_failure', check.RunResult(1, report=report(CASES[0], 'Error: workerd failed to start')))

    def test_assertion_word_inside_runtime_error_is_not_detection(self):
        for message in ['Error: import AssertionError: failed', 'Error: import failed\nAssertionError: from another cause']:
            with self.subTest(message=message):
                self.reject('non_assertion_failure', check.RunResult(1, report=report(CASES[0], message)))

    def test_runner_and_test_timeouts_are_rejected(self):
        result = self.valid_mutant()
        result.timed_out = True
        self.reject('timeout', result)
        self.reject('timeout', check.RunResult(1, report=report(CASES[0], 'Error: Test timed out in 20000ms.')))

    def test_unrelated_case_failure_is_rejected(self):
        self.reject('unrelated_failure', check.RunResult(1, report=report(CASES[1], 'AssertionError: wrong state')))

    def test_missing_and_invalid_reports_are_rejected(self):
        for invalid, category in [(None, 'missing_report'), ('invalid JSON', 'invalid_report'), ({}, 'collection_failure')]:
            with self.subTest(invalid=invalid):
                self.reject(category, check.RunResult(1, report=invalid))

    def test_empty_collection_and_duplicate_case_are_rejected(self):
        for assertions in [[], [self.valid_mutant().report['testResults'][0]['assertionResults'][0]] * len(CASES)]:
            result = self.valid_mutant()
            result.report['testResults'][0]['assertionResults'] = assertions
            self.reject('collection_failure', result)

    def test_unhandled_environment_error_and_signal_exit_are_rejected(self):
        result = self.valid_mutant()
        result.output = 'Unhandled Rejection: workerd terminated'
        self.reject('environment_failure', result)
        result = self.valid_mutant()
        result.code = -9
        self.reject('invalid_exit', result)

    def test_baseline_requires_all_scenarios_to_pass(self):
        check.verify_baseline(check.RunResult(0, report=report()), CASES)
        for result in [self.valid_mutant(), check.RunResult(0, report=report(CASES[0])), check.RunResult(1, report=report())]:
            with self.subTest(result=result.report):
                with self.assertRaises(check.ImplementationError):
                    check.verify_baseline(result, CASES)


class IsolationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='pufu-phase-python-test-')
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)
        self.root = self.directory / 'original'
        self.root.mkdir()
        self.paths = [SOURCE, check.FIXTURE, check.TEST_FILE, Path('package.json'), Path('vitest.config.ts')]
        for path in self.paths:
            destination = self.root / path
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_text('if (allowed) action();\n' if path == SOURCE else '{}')
        (self.root / check.FIXTURE).write_text(json.dumps({'version': 1, 'cases': [{'id': case} for case in CASES]}))
        manifest = self.root / check.MANIFEST
        manifest.parent.mkdir()
        manifest.write_text(json.dumps({'version': 1, 'mutations': [MUTATION]}))
        dependencies = self.root / 'node_modules'
        dependencies.mkdir()
        for name in ['package', '.bin', '.pnpm', '.vite', '.vite-temp', '.vitest-cache', '.cache']:
            (dependencies / name).mkdir()
            (dependencies / name / 'sentinel').write_text('original')
        (dependencies / '.pnpm-task-run-state-v1').write_text('mutable')

    def test_copy_and_mutation_leave_original_source_and_caches_unchanged(self):
        copy = self.directory / 'copy'
        check.copy_project(self.root, copy, self.paths)
        check.apply_mutation(copy, MUTATION)
        self.assertIn('if (true)', (copy / SOURCE).read_text())
        self.assertIn('if (allowed)', (self.root / SOURCE).read_text())
        self.assertFalse((copy / 'node_modules').is_symlink())
        self.assertTrue((copy / 'node_modules/package').is_symlink())
        for name in ['.vite', '.vite-temp', '.vitest-cache', '.cache']:
            target = copy / 'node_modules' / name
            self.assertFalse(target.exists())
            target.mkdir()
            (target / 'sentinel').write_text('scratch')
            self.assertEqual((self.root / 'node_modules' / name / 'sentinel').read_text(), 'original')
        self.assertFalse((copy / 'node_modules/.pnpm-task-run-state-v1').exists())

    def test_git_input_copy_includes_untracked_fixture_but_excludes_private_inputs(self):
        values = self.paths + [Path('server/.dev.vars'), Path('server/.env.test'), Path('tests/private.key'), Path('dist/generated.js'), Path('node_modules/module.js')]
        for path in values:
            target = self.root / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.touch()
        completed = subprocess.CompletedProcess([], 0, stdout='\0'.join(str(path) for path in values).encode() + b'\0')
        with patch.object(check.subprocess, 'run', return_value=completed) as run:
            self.assertEqual(set(check.project_files(self.root)), set(self.paths))
        self.assertEqual(run.call_args.args[0], ['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z'])
        self.assertIs(run.call_args.kwargs['shell'], False)

    def test_edit_must_match_exactly_once_and_multiedit_is_atomic(self):
        mutation = json.loads(json.dumps(MUTATION))
        mutation['edits'].append({'file': str(SOURCE), 'old': 'missing', 'new': 'changed'})
        before = (self.root / SOURCE).read_bytes()
        with self.assertRaisesRegex(check.ImplementationError, 'stale_mutation'):
            check.apply_mutation(self.root, mutation)
        self.assertEqual((self.root / SOURCE).read_bytes(), before)
        (self.root / SOURCE).write_bytes(before * 2)
        with self.assertRaisesRegex(check.ImplementationError, 'found 2'):
            check.apply_mutation(self.root, MUTATION)

    def test_bad_manifest_cases_paths_and_noops_are_rejected(self):
        for change in [
            lambda value: value.update(expectedCase='absent'),
            lambda value: value['edits'][0].update(file='../guard.ts'),
            lambda value: value['edits'][0].update(file='tests/guard.ts'),
            lambda value: value['edits'][0].update(new='if (allowed)'),
        ]:
            mutation = json.loads(json.dumps(MUTATION))
            change(mutation)
            (self.root / check.MANIFEST).write_text(json.dumps({'version': 1, 'mutations': [mutation]}))
            with self.assertRaisesRegex(check.ImplementationError, 'invalid_manifest'):
                check.load_mutations(self.root, CASES)

    def test_failed_baseline_never_runs_a_mutant(self):
        with patch.object(check, 'project_files', return_value=self.paths), patch.object(check, 'run_vitest', return_value=check.RunResult(1, report=report())) as run:
            with self.assertRaisesRegex(check.ImplementationError, 'baseline_failure'):
                check.check_implementation(self.root)
        self.assertEqual(run.call_count, 1)
        self.assertIsNone(run.call_args.args[1] if len(run.call_args.args) > 1 else None)
        self.assertFalse(run.call_args.args[0].exists(), 'Temporary copy must be cleaned after failure')
        self.assertIn('if (allowed)', (self.root / SOURCE).read_text())

    def test_baseline_then_mutant_use_disposable_copies(self):
        runs = []

        def execute(directory, expected_case=None):
            runs.append(directory)
            text = (directory / SOURCE).read_text()
            if expected_case is None:
                self.assertIn('if (allowed)', text)
                return check.RunResult(0, report=report())
            self.assertIn('if (true)', text)
            return check.RunResult(1, report=report(expected_case, 'AssertionError: state differs'))

        with patch.object(check, 'project_files', return_value=self.paths), patch.object(check, 'run_vitest', side_effect=execute), contextlib.redirect_stdout(io.StringIO()):
            check.check_implementation(self.root)
        self.assertEqual(len(runs), 2)
        self.assertTrue(all(not path.exists() for path in runs))
        self.assertIn('if (allowed)', (self.root / SOURCE).read_text())

    def test_vitest_command_is_bounded_and_filters_only_the_target(self):
        for index, case in enumerate([None, CASES[0]]):
            with self.subTest(case=case):
                directory = self.directory / f'execution-{index}'
                directory.mkdir()
                with patch.object(check.subprocess, 'Popen') as popen:
                    process = popen.return_value
                    process.communicate.return_value = ('output', None)
                    process.returncode = 0
                    check.run_vitest(directory, case)
                command = popen.call_args.args[0]
                self.assertEqual(command[:6], ['pnpm', 'exec', 'vitest', 'run', str(check.TEST_FILE), '--maxWorkers=1'])
                self.assertEqual(any(argument.startswith('--testNamePattern=') for argument in command), case is not None)
                self.assertFalse(any(argument.startswith('--testTimeout') for argument in command))
                self.assertIs(popen.call_args.kwargs['shell'], False)
                self.assertIs(popen.call_args.kwargs['start_new_session'], True)
                self.assertEqual(popen.call_args.kwargs['env']['npm_config_verify_deps_before_run'], 'false')
                self.assertEqual(popen.call_args.kwargs['env']['pnpm_config_verify_deps_before_run'], 'false')
                process.communicate.assert_called_once_with(timeout=check.RUN_TIMEOUT)

    def test_timeout_kills_child_process_group_before_cleanup(self):
        directory = self.directory / 'timeout-execution'
        directory.mkdir()
        with patch.object(check.subprocess, 'Popen') as popen, patch.object(check.os, 'killpg') as killpg:
            process = popen.return_value
            process.pid, process.returncode = 12345, -9
            process.communicate.side_effect = [subprocess.TimeoutExpired([], check.RUN_TIMEOUT), ('partial output', None)]
            result = check.run_vitest(directory)
        self.assertTrue(result.timed_out)
        killpg.assert_called_once_with(12345, check.signal.SIGKILL)
        self.assertEqual(process.communicate.call_args.kwargs['timeout'], 10)


if __name__ == '__main__':
    unittest.main()
