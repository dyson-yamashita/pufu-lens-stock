"""The committed oracle must reflect Lean output; formatting is independent."""

from contextlib import redirect_stdout
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

_spec = importlib.util.spec_from_file_location('phase_export', Path(__file__).parent / 'boundary-verification/export_phase_cases.py')
exporter = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(exporter)
VALUE = {'version': 1, 'cases': [{'id': 'example', 'steps': [{'accepted': True, 'revision': 1}]}]}


class PhaseExportTests(unittest.TestCase):
    def check_fixture(self, actual):
        with tempfile.TemporaryDirectory(prefix='pufu-oracle-drift-') as scratch:
            path = Path(scratch) / 'oracle.json'
            path.write_text(json.dumps(actual, indent=4))
            with patch.object(exporter, 'FIXTURE', path), patch.object(exporter, 'export', return_value=(VALUE, 1, 1)), patch('sys.argv', ['export_phase_cases.py', '--check']), redirect_stdout(io.StringIO()):
                exporter.main()

    def test_matching_data_accepts_formatting_differences(self):
        self.check_fixture(VALUE)

    def test_changed_model_result_is_rejected(self):
        changed = json.loads(json.dumps(VALUE))
        changed['cases'][0]['steps'][0]['revision'] = 2
        with self.assertRaisesRegex(exporter.ExportError, 'fixture drift'):
            self.check_fixture(changed)

    def test_boolean_and_number_are_not_interchangeable(self):
        changed = json.loads(json.dumps(VALUE))
        changed['cases'][0]['steps'][0]['accepted'] = 1
        with self.assertRaisesRegex(exporter.ExportError, 'fixture drift'):
            self.check_fixture(changed)

    def test_missing_fixture_is_rejected(self):
        with tempfile.TemporaryDirectory(prefix='pufu-oracle-missing-') as scratch:
            with patch.object(exporter, 'FIXTURE', Path(scratch) / 'missing.json'), patch.object(exporter, 'export', return_value=(VALUE, 1, 1)), patch('sys.argv', ['export_phase_cases.py']), redirect_stdout(io.StringIO()):
                with self.assertRaisesRegex(exporter.ExportError, 'fixture drift'):
                    exporter.main()

    def test_invalid_or_empty_lean_output_is_rejected(self):
        for output in ('', 'not-json', '{"version":1,"cases":[]}'):
            with self.subTest(output=output), patch.object(exporter, 'run', side_effect=['', output]):
                with self.assertRaises(exporter.ExportError):
                    exporter.export()

    def test_duplicate_or_empty_scenarios_are_rejected(self):
        for cases in ([VALUE['cases'][0], VALUE['cases'][0]], [{'id': 'empty', 'steps': []}]):
            with self.subTest(cases=cases), patch.object(exporter, 'run', side_effect=['', json.dumps({'version': 1, 'cases': cases})]):
                with self.assertRaises(exporter.ExportError):
                    exporter.export()


if __name__ == '__main__':
    unittest.main()
