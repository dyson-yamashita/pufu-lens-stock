#!/usr/bin/env python3
"""Compile each intact model, then require failures inside designated theorem proofs."""

import json
from pathlib import Path
import re
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent
DECLARATION = re.compile(
    r'(?m)^(?:(?:private|protected|noncomputable)\s+)*'
    r'(theorem|lemma|def|abbrev|structure|inductive|example|end|namespace)\b(?:\s+([^\s(:]+))?'
)


class MutationError(RuntimeError):
    pass


def require(condition, message):
    if not condition:
        raise MutationError(message)


def theorem_spans(source):
    declarations = list(DECLARATION.finditer(source))
    spans = {}
    for index, declaration in enumerate(declarations):
        if declaration.group(1) not in ('theorem', 'lemma'):
            continue
        name = declaration.group(2)
        require(name not in spans, f'Ambiguous theorem: {name}')
        start = source.count('\n', 0, declaration.start()) + 1
        end = source.count('\n', 0, declarations[index + 1].start()) if index + 1 < len(declarations) else len(source.splitlines())
        spans[name] = (start, end)
    return spans


def load_cases(root=ROOT):
    modules, names, cases = set(), set(), []
    configs = sorted((root / 'mutations').glob('*.json'))
    require(configs, 'No mutation specifications')
    for config in configs:
        data = json.loads(config.read_text())
        module = data.get('module', '')
        require(re.fullmatch(r'BoundaryVerification(?:\.[A-Za-z][A-Za-z0-9_]*)+', module), f'Invalid module in {config.name}')
        require(module not in modules, f'Duplicate mutation module: {module}')
        modules.add(module)
        path = root.joinpath(*module.split('.')).with_suffix('.lean')
        require(path.is_file(), f'Missing mutation source: {module}')
        source = path.read_text()
        spans = theorem_spans(source)
        mutations = data.get('mutations')
        require(isinstance(mutations, list) and len(mutations) >= 2, f'At least two mutations required: {module}')
        for mutation in mutations:
            name, old, new, theorem = (mutation.get(key) for key in ('name', 'old', 'new', 'theorem'))
            require(isinstance(name, str) and re.fullmatch(r'B\d{2}-[a-z0-9-]+', name), 'Name must identify the target')
            require(name not in names, f'Duplicate mutation: {name}')
            names.add(name)
            require(isinstance(old, str) and old and isinstance(new, str) and old != new, f'Invalid replacement: {name}')
            require(source.count(old) == 1, f'Mutation must match exactly once: {name}')
            require(theorem in spans, f'Missing designated theorem: {name}: {theorem}')
            # Change the transition/guard, not the theorem we are testing.
            position = source.index(old)
            start_line = source.count('\n', 0, position) + 1
            end_line = start_line + old.count('\n')
            require(not any(start_line <= end and end_line >= start for start, end in spans.values()), f'Do not mutate theorem proofs: {name}')
            cases.append((module, source, mutation))
    sources = {'.'.join(p.relative_to(root).with_suffix('').parts) for p in (root / 'BoundaryVerification').rglob('*.lean')}
    require(sources == modules, 'Every boundary model must have mutation specifications')
    imports = (root / 'BoundaryVerification.lean').read_text()
    require(re.fullmatch(r'(?:\s*import BoundaryVerification(?:\.[A-Za-z][A-Za-z0-9_]*)+\s*)*', imports), 'Root module must contain only boundary imports')
    require(set(re.findall(r'import (\S+)', imports)) == modules, 'Root imports must match mutation modules')
    return cases


def compile_source(directory, source, path):
    path.write_text(source)
    result = subprocess.run(
        ['lake', 'env', 'lean', '-DwarningAsError=true', '-Dlinter.unusedVariables=false', str(path)],
        cwd=directory, capture_output=True, text=True, timeout=60,
    )
    return result.returncode, result.stdout + result.stderr


def verify_failure(path, source, mutation, returncode, output):
    name = mutation['name']
    require(returncode != 0, f'Mutation survived: {name}')
    spans = theorem_spans(source)
    required = spans[mutation['theorem']]
    diagnostics = re.findall(re.escape(str(path)) + r':(\d+):\d+: error(?:\([^)]*\))?:', output)
    lines = [int(line) for line in diagnostics]
    require(lines, f'No Lean proof diagnostics: {name}\n{output}')
    require(all(any(start <= line <= end for start, end in spans.values()) for line in lines), f'Failure outside theorem proofs: {name}\n{output}')
    require(any(required[0] <= line <= required[1] for line in lines), f'Designated theorem did not fail: {name}\n{output}')
    require('declaration uses `sorry`' not in output, f'Unexpected placeholder: {name}')


def main():
    cases = load_cases()
    checked = set()
    with tempfile.TemporaryDirectory(prefix='pufu-boundary-mutations-') as scratch:
        path = Path(scratch) / 'Mutation.lean'
        for module, source, mutation in cases:
            if module not in checked:
                code, output = compile_source(ROOT, source, path)
                require(code == 0, f'Intact model failed: {module}\n{output}')
                checked.add(module)
            changed = source.replace(mutation['old'], mutation['new'], 1)
            code, output = compile_source(ROOT, changed, path)
            verify_failure(path, changed, mutation, code, output)
            print(f'DETECTED {mutation["name"]}: {module}.{mutation["theorem"]}', flush=True)
    print(f'Boundary mutation checks passed: {len(cases)} mutations / {len(checked)} models')


if __name__ == '__main__':
    try:
        main()
    except (MutationError, OSError, ValueError, subprocess.TimeoutExpired) as error:
        raise SystemExit(str(error))
