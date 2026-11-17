#!/usr/bin/env python3
"""Build real proofs, then require each isolated unsafe model to fail compilation."""

from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent


def build(directory):
    return subprocess.run(
        ["lake", "build"], cwd=directory, text=True, capture_output=True, timeout=120
    )


baseline = build(ROOT)
print(baseline.stdout + baseline.stderr, end="")
if baseline.returncode:
    raise SystemExit(baseline.returncode)

# Change the actual definitions; reuse the unchanged universal theorems.
# Each mutation gets a clean project so no baseline .olean can mask a failure.
mutations = [
    ("authentication-bypass", "Access", "a.authenticated && ", "", "Access"),
    ("scope-bypass", "Access", "a.writeScope && ", "", "Access"),
    ("ownership-bypass", "Access", "a.ownsPufu && ", "", "Access"),
    ("project-bypass", "Access", "&& projectAllowed a", "&& true", "Access"),
    ("revision-conflict-bypass", "State", "decide (u.revision = s.revision)", "true", "Proofs"),
    ("denied-write", "State", "else ⟨false, s⟩", "else ⟨false, commit s u⟩", "Proofs"),
    ("wrong-revision", "State", "revision := s.revision + 1", "revision := s.revision + 2", "Proofs"),
]
for name, module, old, new, proof_module in mutations:
    with tempfile.TemporaryDirectory(prefix="mcp-verification-") as scratch:
        target = Path(scratch)
        for filename in ("lean-toolchain", "lakefile.toml", "McpVerification.lean"):
            shutil.copy2(ROOT / filename, target)
        shutil.copytree(ROOT / "McpVerification", target / "McpVerification")
        source = target / "McpVerification" / f"{module}.lean"
        content = source.read_text()
        if content.count(old) != 1:
            raise SystemExit(f"Mutation {name}: expected exactly one replacement")
        # A removed guard may leave an unused parameter. Disable only that
        # linter in the mutant so it must reach the actual failed theorem.
        content = content.replace(old, new).replace(
            "namespace McpVerification",
            "set_option linter.unusedVariables false\n\nnamespace McpVerification",
            1,
        )
        source.write_text(content)
        result = build(target)
        output = result.stdout + result.stderr
        # An installation/download failure must never count as a proof failure.
        if result.returncode == 0 or f"error: McpVerification/{proof_module}.lean:" not in output:
            print(output)
            raise SystemExit(f"Mutation {name}: expected a theorem compilation failure")
        print(f"PASS: {name} rejected by Lean")
