#!/usr/bin/env python3
"""Validate the registry, build every registered module, and audit kernel axioms."""

import argparse
import json
from pathlib import Path
import re
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent


class VerificationError(RuntimeError):
    pass


def require(condition, message):
    if not condition:
        raise VerificationError(message)


def source_files(root):
    return {
        p.resolve()
        for p in root.rglob('*.lean')
        if '.lake' not in p.relative_to(root).parts and p.name != 'lakefile.lean'
    }


def load_targets(root=ROOT):
    data = json.loads((root / 'targets.json').read_text())
    require(data.get('version') == 1, 'Unsupported registry version')
    toolchain = data.get('toolchain', '')
    require(re.fullmatch(r'leanprover/lean4:v\d+\.\d+\.\d+', toolchain), 'Pin a stable Lean version')
    targets = data.get('targets')
    require(isinstance(targets, list) and targets, 'Register at least one target')
    ids, directories, registered = set(), set(), set()
    for target in targets:
        target_ids = target.get('ids')
        require(isinstance(target_ids, list) and target_ids, 'Target IDs are required')
        for identity in target_ids:
            require(isinstance(identity, str) and re.fullmatch(r'B\d{2,}', identity), 'Invalid target ID')
            require(identity not in ids, f'Duplicate target ID: {identity}')
            ids.add(identity)
        relative = Path(target['directory'])
        require(not relative.is_absolute() and '..' not in relative.parts, 'Invalid project path')
        directory = (root / relative).resolve()
        require(directory != root.resolve() and directory.is_relative_to(root.resolve()), 'Project must be below formal/')
        require(directory not in directories and directory.is_dir(), 'Missing or duplicate project directory')
        directories.add(directory)
        require((directory / 'lean-toolchain').read_text().strip() == toolchain, f'Toolchain mismatch: {relative}')
        require((directory / 'lakefile.toml').is_file() or (directory / 'lakefile.lean').is_file(), 'Lake configuration is required')
        require(target.get('build') == ['lake', 'build'], 'Build must use lake build')
        conformance = target.get('conformance')
        require(conformance is None or (isinstance(conformance, list) and conformance and all(isinstance(x, str) and x for x in conformance)), 'Conformance must be a nonempty command')
        command = target.get('mutations')
        require(isinstance(command, list) and command and all(isinstance(x, str) and x for x in command), 'Mutation command is required')
        modules = target.get('modules')
        require(isinstance(modules, list) and modules and len(modules) == len(set(modules)), 'Register unique modules')
        for module in modules:
            require(isinstance(module, str) and re.fullmatch(r'[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*', module), 'Invalid module name')
            source = directory.joinpath(*module.split('.')).with_suffix('.lean').resolve()
            require(source.is_relative_to(directory) and source.is_file(), f'Missing module: {module}')
            require(source not in registered, f'Duplicate source ownership: {module}')
            registered.add(source)
        tests = target.get('tests')
        require(isinstance(tests, list) and tests, 'Register implementation tests')
        for test in tests:
            require(isinstance(test, str) and test.startswith('tests/') and test.endswith('.test.ts'), 'Tests must be in the existing Vitest include range')
            path = (root.parent / test).resolve()
            require(path.is_relative_to((root.parent / 'tests').resolve()) and path.is_file(), f'Missing test: {test}')
    discovered = {
        p.parent.resolve()
        for name in ('lean-toolchain', 'lakefile.toml', 'lakefile.lean')
        for p in root.rglob(name)
        if '.lake' not in p.relative_to(root).parts
    }
    require(discovered == directories, 'Unregistered Lean project or missing configuration')
    require(source_files(root) == registered, 'Unregistered Lean source or duplicate source ownership')
    return targets


def run(command, directory, timeout=180):
    result = subprocess.run(command, cwd=directory, text=True, capture_output=True, timeout=timeout)
    output = result.stdout + result.stderr
    if result.returncode:
        raise VerificationError(output)
    return output


def build(directory, modules):
    # Build modules explicitly, including registered files not imported by the root.
    return run(['lake', 'build', *modules], directory)


def audit_axioms(directory, modules):
    # Filter by the module of origin, not the declaration namespace: an out-of-
    # namespace helper in a registered source must not escape the audit.
    imports = '\n'.join(f'import {module}' for module in modules)
    names = ', '.join('`' + module for module in modules)
    audit = '''import Lean
IMPORTS
open Lean Elab Command in
run_cmd do
  let env ← getEnv
  let modules : Array Name := #[MODULES]
  let allowed : Array Name := #[`propext, `Classical.choice, `Quot.sound]
  let mut count : Nat := 0
  for (name, info) in env.constants.toList do
    let some idx := env.getModuleIdxFor? name | continue
    if modules.contains env.header.moduleNames[idx.toNat]! && (info.isTheorem || info.isAxiom) then
      for axiomName in (← Lean.collectAxioms name) do
        unless allowed.contains axiomName do
          throwError "UNAPPROVED_AXIOM: {name} depends on {axiomName}"
      if info.isTheorem then count := count + 1
  if count == 0 then throwError "AXIOM_AUDIT_EMPTY: no project theorems were checked"
  logInfo m!"AXIOM_AUDIT_OK: {count} project theorems"
'''.replace('IMPORTS', imports).replace('MODULES', names)
    with tempfile.TemporaryDirectory(prefix='pufu-axiom-audit-') as scratch:
        source = Path(scratch) / 'Audit.lean'
        source.write_text(audit)
        output = run(['lake', 'env', 'lean', str(source)], directory)
        require('AXIOM_AUDIT_OK:' in output, 'Axiom audit did not complete')
        return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check-only', action='store_true', help='Validate registration without running Lean')
    parser.add_argument('--tests', action='store_true', help='Also run registered Vitest files locally')
    args = parser.parse_args()
    targets = load_targets()
    print('Registry OK:', ', '.join(identity for target in targets for identity in target['ids']), flush=True)
    if args.check_only:
        return
    for target in targets:
        directory = ROOT / target['directory']
        print(build(directory, target['modules']), end='', flush=True)
        print(audit_axioms(directory, target['modules']), end='', flush=True)
        if target.get('conformance'):
            print(run(target['conformance'], directory), end='', flush=True)
        # A project may now contain dozens of independent mutation compiles.
        print(run(target['mutations'], directory, timeout=300), end='', flush=True)
    if args.tests:
        tests = sorted({test for target in targets for test in target['tests']})
        print(run(['pnpm', 'exec', 'vitest', 'run', *tests, '--maxWorkers=2'], ROOT.parent, timeout=1800), end='', flush=True)


if __name__ == '__main__':
    try:
        main()
    except (VerificationError, OSError, ValueError, subprocess.TimeoutExpired) as error:
        raise SystemExit(str(error))
