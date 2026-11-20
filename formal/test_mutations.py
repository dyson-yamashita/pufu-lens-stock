"""Regression tests for distinguishing theorem failures from broken fixtures."""

import importlib.util
from pathlib import Path
import tempfile
import unittest

from verify import load_targets

_spec = importlib.util.spec_from_file_location('mutation_check', Path(__file__).parent / 'verification/check.py')
check = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(check)

SOURCE = '''import Std
namespace Fixture

def allowed (authenticated : Bool) : Bool := authenticated

theorem unauthenticated_denied : allowed false = false := by rfl

theorem other : True := by trivial

end Fixture
'''
MUTATION = {'name': 'B01-fixture', 'theorem': 'unauthenticated_denied'}


class MutationTests(unittest.TestCase):
    def compile_fixture(self, source):
        scratch = tempfile.TemporaryDirectory(prefix='pufu-mutation-selftest-')
        self.addCleanup(scratch.cleanup)
        path = Path(scratch.name) / 'Mutation.lean'
        code, output = check.compile_source(check.ROOT, source, path)
        return path, code, output

    def test_guard_removal_fails_designated_theorem(self):
        _, code, output = self.compile_fixture(SOURCE)
        self.assertEqual(code, 0, output)
        changed = SOURCE.replace(': Bool := authenticated', ': Bool := true')
        path, code, output = self.compile_fixture(changed)
        check.verify_failure(path, changed, MUTATION, code, output)

    def test_surviving_mutation_is_not_detection(self):
        changed = SOURCE.replace(': Bool := authenticated', ': Bool := id authenticated')
        path, code, output = self.compile_fixture(changed)
        with self.assertRaisesRegex(check.MutationError, 'Mutation survived'):
            check.verify_failure(path, changed, MUTATION, code, output)

    def test_definition_error_is_not_detection(self):
        changed = SOURCE.replace(': Bool := authenticated', ': Bool := unknownIdentifier')
        path, code, output = self.compile_fixture(changed)
        with self.assertRaisesRegex(check.MutationError, 'Failure outside theorem proofs'):
            check.verify_failure(path, changed, MUTATION, code, output)

    def test_unrelated_theorem_failure_is_not_detection(self):
        changed = SOURCE.replace('theorem other : True := by trivial', 'theorem other : False := by trivial')
        path, code, output = self.compile_fixture(changed)
        with self.assertRaisesRegex(check.MutationError, 'Designated theorem did not fail'):
            check.verify_failure(path, changed, MUTATION, code, output)

    def test_nested_model_without_mutations_is_rejected(self):
        with tempfile.TemporaryDirectory(prefix='pufu-missing-mutations-') as scratch:
            root = Path(scratch)
            (root / 'Verification/Nested').mkdir(parents=True)
            (root / 'mutations').mkdir()
            (root / 'Verification/Auth.lean').write_text((check.ROOT / 'Verification/Auth.lean').read_text())
            (root / 'mutations/auth.json').write_text((check.ROOT / 'mutations/auth.json').read_text())
            (root / 'Verification/Nested/Helper.lean').write_text('theorem extra : True := by trivial\n')
            with self.assertRaisesRegex(check.MutationError, 'Every verification model'):
                check.load_cases(root)

    def test_all_models_have_valid_mutations(self):
        cases = check.load_cases()
        target = next(target for target in load_targets() if target['directory'] == 'verification')
        self.assertEqual(
            {module for module, _, _ in cases},
            set(target['modules']) - {'Verification'},
        )
        self.assertEqual({case['name'][:3] for _, _, case in cases}, set(target['ids']))


if __name__ == '__main__':
    unittest.main()
