# Test code style

Disclosed from [`docs/code-style.md`](../code-style.md).

All of docs/code-style.md applies to test code as-is.

## Outcomes over calls

The settled rule in `docs/code-style.md` asks a test to assert what a caller can observe: a return value, the state a fake is left in, a message shown. A test that asserts which calls were made, how many, or with what arguments is coupled to the route the code takes, so it breaks when an internal refactor keeps the behaviour and passes when the calls are right but the outcome is wrong. A call count is the contract only when the count is what a caller pays for, such as round trips to a rate-limited API, and such a test says so in its name ("costs one read").

## Test speed

The whole suite runs before every change is called done, so a cost in one test is paid on every run, and a suite gets slow one reasonable-looking test at a time.

### A test starts a process only when that process is what it tests

Spawning a process costs far more than a function call, and most of a test's behaviour doesn't depend on it.

### A fixture costing more than a few milliseconds is built once per file and copied or reset for each test

Each test still starts from a clean fixture, and only the first pays to build it.

### A test never really waits: time goes through an injected clock or fake timers

A real wait costs its full length on every run, and one tuned to pass on a quiet machine flakes on a loaded one.

### A test reaches no network and opens no real port

Either one makes the result depend on what is outside the test, and a port also collides with the tests running beside it.
