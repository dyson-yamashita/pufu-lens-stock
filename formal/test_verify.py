"""Regression checks for registration gaps and transitive proof dependencies."""

import json
from pathlib import Path
import shutil
import tempfile
import unittest

from verify import ROOT, VerificationError, audit_axioms, build, load_targets


class RegistryTests(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory(prefix='pufu-registry-test-')
        self.addCleanup(self.scratch.cleanup)
        self.root = Path(self.scratch.name) / 'formal'
        self.root.mkdir()
        project = self.root / 'example'
        project.mkdir()
        (project / 'lean-toolchain').write_text('leanprover/lean4:v4.36.0\n')
        (project / 'lakefile.toml').write_text('name = "example"\n')
        (project / 'Model.lean').write_text('theorem identity (p : Prop) (h : p) : p := h\n')
        tests = self.root.parent / 'tests'
        tests.mkdir()
        (tests / 'example.test.ts').write_text('// Dummy test path for registry validation\n')
        self.config = {
            'version': 1,
            'toolchain': 'leanprover/lean4:v4.36.0',
            'targets': [{
                'ids': ['B00'], 'directory': 'example', 'modules': ['Model'],
                'build': ['lake', 'build'], 'mutations': ['python3', 'check.py'],
                'tests': ['tests/example.test.ts'],
            }],
        }
        self.save()

    def save(self):
        (self.root / 'targets.json').write_text(json.dumps(self.config))

    def test_registered_project(self):
        self.assertEqual(load_targets(self.root)[0]['ids'], ['B00'])

    def test_conformance_command_is_registered(self):
        self.config['targets'][0]['conformance'] = ['python3', 'export.py', '--check']
        self.save()
        self.assertEqual(load_targets(self.root)[0]['conformance'], ['python3', 'export.py', '--check'])

    def test_invalid_conformance_command_is_rejected(self):
        for value in ([], 'python3 export.py', ['python3', '']):
            with self.subTest(value=value):
                self.config['targets'][0]['conformance'] = value
                self.save()
                with self.assertRaisesRegex(VerificationError, 'Conformance'):
                    load_targets(self.root)

    def test_unregistered_source_is_rejected(self):
        (self.root / 'example' / 'Forgotten.lean').write_text('theorem omitted : True := True.intro\n')
        with self.assertRaisesRegex(VerificationError, 'Unregistered Lean source'):
            load_targets(self.root)

    def test_unregistered_project_is_rejected(self):
        other = self.root / 'other'
        other.mkdir()
        (other / 'lean-toolchain').write_text('leanprover/lean4:v4.36.0\n')
        with self.assertRaisesRegex(VerificationError, 'Unregistered Lean project'):
            load_targets(self.root)

    def test_missing_test_is_rejected(self):
        (self.root.parent / 'tests' / 'example.test.ts').unlink()
        with self.assertRaisesRegex(VerificationError, 'Missing test'):
            load_targets(self.root)

    def test_toolchain_drift_is_rejected(self):
        (self.root / 'example' / 'lean-toolchain').write_text('leanprover/lean4:v4.24.0\n')
        with self.assertRaisesRegex(VerificationError, 'Toolchain mismatch'):
            load_targets(self.root)


class AxiomAuditTests(unittest.TestCase):
    def test_indirect_custom_axiom_and_native_decide_are_rejected(self):
        target = next(target for target in load_targets() if "B00" in target["ids"])
        # All fixtures are deliberately valid Lean. A build failure is not evidence
        # that our axiom gate caught the prohibited dependency.
        cases = {
            'indirect-axiom': 'theorem indirect_dependency : True := False.elim Untrusted.intermediate\n',
            'indirect-sorry': 'theorem indirect_dependency : True := False.elim Untrusted.intermediate\n',
            'private-module': '',
            'native-decide': '''
theorem compiler_dependency : (1 + 1 : Nat) = 2 := by native_decide
''',
        }
        for name, addition in cases.items():
            with self.subTest(name=name), tempfile.TemporaryDirectory(prefix='pufu-axiom-test-') as scratch:
                project = Path(scratch) / 'project'
                shutil.copytree(ROOT / target['directory'], project, ignore=shutil.ignore_patterns('.lake', '__pycache__'))
                modules = list(target['modules'])
                if name == 'private-module':
                    (project / 'McpVerification' / 'PrivateTrap.lean').write_text(
                        'module\nprivate axiom hiddenBad : False\nprivate theorem hidden : False := hiddenBad\n')
                    modules.append('McpVerification.PrivateTrap')
                extra_import = ''
                if name.startswith('indirect-'):
                    # Simulate an imported dependency not owned by the audited
                    # modules. Only transitive dependency collection can catch it.
                    helper = ('axiom bad : False\ntheorem intermediate : False := bad\n'
                              if name == 'indirect-axiom' else
                              'theorem intermediate : False := by sorry\n')
                    (project / 'Untrusted.lean').write_text('namespace Untrusted\n' + helper + 'end Untrusted\n')
                    with (project / 'lakefile.toml').open('a') as config:
                        config.write('\n[[lean_lib]]\nname = "Untrusted"\n')
                    extra_import = 'import Untrusted\n'
                proofs = project / 'McpVerification' / 'Proofs.lean'
                # Deliberately outside the McpVerification namespace: the audit
                # selects declaration origins, so helper namespaces cannot evade it.
                proofs.write_text('import Lean\n' + extra_import + proofs.read_text() + addition)
                build(project, modules)
                with self.assertRaisesRegex(VerificationError, 'UNAPPROVED_AXIOM') as caught:
                    audit_axioms(project, modules)
                expected = {'indirect-axiom': 'Untrusted.bad', 'indirect-sorry': 'sorryAx', 'native-decide': 'compiler_dependency', 'private-module': 'hiddenBad'}
                self.assertIn(expected[name], str(caught.exception))


if __name__ == '__main__':
    unittest.main()
