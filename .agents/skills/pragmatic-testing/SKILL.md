---
name: pragmatic-testing
description: Generate minimal, maintainable tests for existing code.
---

# Pragmatic Testing

## Goal
Create the smallest useful set of tests that protects important behavior.

## Process
1. Inspect the target implementation and existing tests.
2. Identify observable behavior and important failure cases.
3. Reuse the existing test framework and utilities.
4. Add only tests that provide distinct value.
5. Run tests and report results.

## Rules
- Prefer testing behavior over implementation details.
- Avoid testing private functions directly.
- Avoid excessive mocking.
- Do not duplicate existing test coverage.
- Prefer parameterized tests for similar cases.
- Prioritize critical paths and edge cases.
- Do not add tests for trivial getters or setters.
- Do not introduce new test frameworks unnecessarily.
- Keep test setup simple.
- Do not modify production code solely to accommodate tests.

## Output
Report:
- Tests added
- Behaviors covered
- Test execution results
- Remaining risks
