# Enhanced Language Process Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Detect long-running Go, Java, Rust, Ruby, and PHP development commands while excluding unrelated language processes.

**Architecture:** Keep detection in `backend/app/scanner.py`, preserve raw argv element boundaries, normalize process and command tokens once, and match exact ecosystem signatures only at explicit executable or known-wrapper positions. Specific development commands qualify without a port; generic Java, Ruby, and PHP runtimes qualify only through the existing listening-port fallback.

**Tech Stack:** Python 3.11+, psutil, pytest

## Global Constraints

- Detect only Go, Java, Rust, Ruby, and PHP language toolchains in this change; do not add databases, Docker, container runtimes, or infrastructure daemons.
- Recognized development signatures qualify before they bind a listening port.
- Generic `java`, `javaw`, `ruby`, and `php` runtimes qualify only when they own a listening port.
- Preserve current Node.js and Python behavior.
- Use exact, case-insensitive command signatures rather than substring matching.
- Match language signatures only at the command prefix or through a documented
  wrapper grammar; never treat arbitrary file, option, or trailing arguments as
  executable evidence.
- Classify the original `psutil` argv sequence. Use `command_to_text()` only to
  serialize the API display field.
- Preserve Windows executable-suffix and path handling.
- Do not change the API response, data model, or frontend.

## User-Approved Final-Review Correction

This correction supersedes Task 2's anywhere-in-argv adjacent-sequence matcher.
The accepted grammar recognizes direct command prefixes plus the approved
Maven/Gradle wrapper executables and `bundle exec rails` forms. It rejects
tool-like filenames and signatures in arbitrary arguments, including
`python /tmp/puma` and `python worker.py go run`. Classification accepts the
original argv sequence so an element such as `"go run"` remains one argument;
joining argv is display serialization only.

---

### Task 1: Repair cross-platform executable normalization

**Files:**
- Modify: `backend/app/scanner.py:8`
- Modify: `backend/app/scanner.py:63`
- Test: `backend/tests/test_scanner.py:61`

**Interfaces:**
- Consumes: Raw executable token as `str`.
- Produces: `executable_name(token: str) -> str`, returning a lowercase basename without `.exe`, `.bat`, `.cmd`, or `.com`.

- [ ] **Step 1: Reproduce the existing Windows-path regression**

Run:

```bash
cd backend
.venv/bin/python -m pytest tests/test_scanner.py::test_executable_name_strips_windows_suffixes -v
```

Expected: FAIL because `executable_name(r"C:\Program Files\nodejs\node.exe")` returns the full backslash path without the `.exe` suffix instead of `node`.

- [ ] **Step 2: Fix basename selection at the normalization boundary**

Change the pathlib import and `executable_name()` in `backend/app/scanner.py`:

```python
from pathlib import PurePath, PureWindowsPath
```

```python
def executable_name(token: str) -> str:
    path = PureWindowsPath(token) if "\\" in token else PurePath(token)
    name = path.name.lower()
    for suffix in WINDOWS_EXECUTABLE_SUFFIXES:
        if name.endswith(suffix):
            return name[: -len(suffix)]
    return name
```

This selects path semantics from the token rather than from the host running Server-View or pytest.

- [ ] **Step 3: Verify the regression test passes**

Run:

```bash
cd backend
.venv/bin/python -m pytest tests/test_scanner.py::test_executable_name_strips_windows_suffixes -v
```

Expected: PASS.

- [ ] **Step 4: Verify existing Windows process cases still pass**

Run:

```bash
cd backend
.venv/bin/python -m pytest tests/test_scanner.py -k "windows or executable_name" -v
```

Expected: All selected tests pass.

- [ ] **Step 5: Commit the normalization repair**

```bash
git add backend/app/scanner.py backend/tests/test_scanner.py
git commit -m "fix: normalize Windows executable paths"
```

---

### Task 2: Add exact language-development signatures

**Files:**
- Modify: `backend/app/scanner.py:15`
- Modify: `backend/app/scanner.py:71`
- Test: `backend/tests/test_scanner.py:49`

**Interfaces:**
- Consumes: Normalized process name plus parsed command-line tokens.
- Produces: `command_contains_signature(tokens: list[str], signature: tuple[str, ...]) -> bool`.
- Produces: `is_dev_process(name: str, command: str) -> bool` with Go, Java, Rust, Ruby, and PHP signature support.

- [ ] **Step 1: Add the positive signature matrix**

Add this parameterized test after the existing process-filter test in `backend/tests/test_scanner.py`:

```python
@pytest.mark.parametrize(
    ("name", "command"),
    [
        ("go", "go run ./cmd/api"),
        ("air", "air -c .air.toml"),
        ("fresh", "fresh"),
        ("mvn", "mvn spring-boot:run"),
        ("mvnw.cmd", "mvnw.cmd quarkus:dev"),
        ("mvn", "mvn micronaut:run"),
        ("gradle", "gradle bootRun"),
        ("gradlew.bat", "gradlew.bat quarkusDev"),
        ("cargo", "cargo run"),
        ("cargo", "cargo watch -x run"),
        ("cargo", "cargo leptos watch"),
        ("cargo", "cargo tauri dev"),
        ("trunk", "trunk serve"),
        ("rails", "rails server"),
        ("rails", "rails s"),
        ("ruby", "bundle exec rails server"),
        ("ruby", "bundle exec rails s"),
        ("rackup", "rackup"),
        ("puma", "puma"),
        ("php", "php -S localhost:8000"),
        ("php", "php artisan serve"),
        ("artisan", "artisan serve"),
        ("symfony", "symfony server:start"),
    ],
)
def test_detects_language_development_commands(name: str, command: str) -> None:
    assert is_dev_process(name, command)
```

- [ ] **Step 2: Add the negative command matrix**

Add this test immediately after the positive matrix:

```python
@pytest.mark.parametrize(
    ("name", "command"),
    [
        ("go", "go version"),
        ("java", "java -version"),
        ("mvn", "mvn package"),
        ("gradle", "gradle build"),
        ("cargo", "cargo build"),
        ("trunk", "trunk build"),
        ("ruby", "ruby cleanup.rb"),
        ("rails", "rails db:migrate"),
        ("php", "php migrate.php"),
        ("artisan", "artisan migrate"),
        ("symfony", "symfony console"),
    ],
)
def test_excludes_non_server_language_commands(name: str, command: str) -> None:
    assert not is_dev_process(name, command)
```

- [ ] **Step 3: Add a Windows wrapper-path case**

Add this test after the language matrices:

```python
def test_detects_windows_java_wrapper_path(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr("app.scanner.os.name", "nt")

    assert is_dev_process("java.exe", r"C:\work\mvnw.cmd spring-boot:run")
```

- [ ] **Step 4: Run the new tests and verify they fail**

Run:

```bash
cd backend
.venv/bin/python -m pytest tests/test_scanner.py -k "language_development or non_server_language or windows_java_wrapper" -v
```

Expected: The positive language and Windows-wrapper cases fail because the new signatures are not implemented; the negative matrix passes.

- [ ] **Step 5: Replace the unused flat keyword tuple with exact signatures**

Remove `DEV_PROCESS_KEYWORDS` and add these constants after the existing Node/Python constants in `backend/app/scanner.py`:

```python
LANGUAGE_DEV_TOOL_NAMES = {"air", "fresh", "puma", "rackup"}
GO_DEV_SIGNATURES = (("go", "run"),)
JAVA_DEV_SIGNATURES = (
    ("mvn", "spring-boot:run"),
    ("mvnw", "spring-boot:run"),
    ("mvn", "quarkus:dev"),
    ("mvnw", "quarkus:dev"),
    ("mvn", "micronaut:run"),
    ("mvnw", "micronaut:run"),
    ("gradle", "bootrun"),
    ("gradlew", "bootrun"),
    ("gradle", "quarkusdev"),
    ("gradlew", "quarkusdev"),
)
RUST_DEV_SIGNATURES = (
    ("cargo", "run"),
    ("cargo", "watch"),
    ("cargo", "leptos", "watch"),
    ("cargo", "tauri", "dev"),
    ("trunk", "serve"),
)
RUBY_DEV_SIGNATURES = (
    ("rails", "server"),
    ("rails", "s"),
)
PHP_DEV_SIGNATURES = (
    ("php", "-s"),
    ("artisan", "serve"),
    ("symfony", "server:start"),
)
LANGUAGE_DEV_SIGNATURES = (
    *GO_DEV_SIGNATURES,
    *JAVA_DEV_SIGNATURES,
    *RUST_DEV_SIGNATURES,
    *RUBY_DEV_SIGNATURES,
    *PHP_DEV_SIGNATURES,
)
```

- [ ] **Step 6: Add exact adjacent-signature matching**

Add this helper before `is_dev_process()`:

```python
def command_contains_signature(tokens: list[str], signature: tuple[str, ...]) -> bool:
    width = len(signature)
    return any(
        tuple(tokens[start : start + width]) == signature
        for start in range(len(tokens) - width + 1)
    )
```

Update `is_dev_process()` so the normalized process name participates in matching while all comparisons remain exact:

```python
def is_dev_process(name: str, command: str) -> bool:
    process_name = executable_name(name)
    tokens = [
        process_name,
        *(executable_name(token) for token in command_tokens(command)),
    ]
    token_text = " ".join(tokens)

    if any(token in NODE_DEV_TOOL_NAMES for token in tokens):
        return True

    if any(token in LANGUAGE_DEV_TOOL_NAMES for token in tokens):
        return True

    if any(command_contains_signature(tokens, signature) for signature in LANGUAGE_DEV_SIGNATURES):
        return True

    if "uvicorn" in tokens or "fastapi" in tokens:
        return True

    if process_name in PYTHON_RUNTIME_NAMES or any(token in {"python", "python3"} for token in tokens):
        return any(hint in token_text for hint in PYTHON_DEV_HINTS)

    return False
```

- [ ] **Step 7: Run the focused classifier tests**

Run:

```bash
cd backend
.venv/bin/python -m pytest tests/test_scanner.py -k "filters_dev_processes or language_development or non_server_language or windows_java_wrapper" -v
```

Expected: All selected tests pass, including the existing system-process exclusions.

- [ ] **Step 8: Commit the signature classifier**

```bash
git add backend/app/scanner.py backend/tests/test_scanner.py
git commit -m "feat: detect more language dev tools"
```

---

### Task 3: Integrate port fallback and close the review finding

**Files:**
- Modify: `backend/app/scanner.py:25`
- Modify: `backend/app/scanner.py:130`
- Modify: `backend/tests/test_scanner.py:118`
- Modify: `docs/REVIEW_FINDINGS.md:94`

**Interfaces:**
- Consumes: `LANGUAGE_RUNTIME_NAMES` and listening ports passed to `process_to_info()`.
- Produces: `PORT_DETECTABLE_RUNTIME_NAMES`, the complete exact-name set used by the listening-port fallback.
- Produces: Updated finding 3 status documenting delivered and deferred scope.

- [ ] **Step 1: Add process-level tests for pre-port signatures and generic runtimes**

Add these tests after the existing Windows process tests in `backend/tests/test_scanner.py`:

```python
def test_process_to_info_keeps_recognized_command_without_port() -> None:
    process = FakeProcess(
        {
            "pid": 47,
            "name": "cargo",
            "cmdline": ["cargo", "run"],
            "cwd": "/work/rust-api",
            "cpu_percent": 1.0,
            "memory_info": SimpleNamespace(rss=2097152),
            "create_time": 90.0,
            "status": "running",
        }
    )

    info = process_to_info(process, [], now=100.0)

    assert info is not None
    assert info.pid == 47
    assert info.ports == []


@pytest.mark.parametrize(
    ("name", "cmdline"),
    [
        ("java", ["java", "-jar", "app.jar"]),
        ("javaw.exe", ["javaw.exe", "-jar", "app.jar"]),
        ("ruby", ["ruby", "app.rb"]),
        ("php.exe", ["php.exe", "app.php"]),
    ],
)
def test_process_to_info_requires_port_for_generic_language_runtime(
    name: str,
    cmdline: list[str],
) -> None:
    process = FakeProcess(
        {
            "pid": 48,
            "name": name,
            "cmdline": cmdline,
            "cwd": "/work/api",
            "cpu_percent": 1.0,
            "memory_info": SimpleNamespace(rss=2097152),
            "create_time": 90.0,
            "status": "running",
        }
    )

    assert process_to_info(process, [], now=100.0) is None

    info = process_to_info(process, [8080], now=100.0)

    assert info is not None
    assert info.ports == [8080]
```

- [ ] **Step 2: Run the process-level tests and verify the fallback cases fail**

Run:

```bash
cd backend
.venv/bin/python -m pytest tests/test_scanner.py -k "recognized_command_without_port or generic_language_runtime" -v
```

Expected: The recognized `cargo run` case passes through signature detection; the generic Java, JavaW, Ruby, and PHP with-port cases fail because the runtime fallback still contains only Node.js and Python names.

- [ ] **Step 3: Expand the centralized runtime-plus-port set**

Add these constants after the signature constants in `backend/app/scanner.py`:

```python
LANGUAGE_RUNTIME_NAMES = {"java", "javaw", "ruby", "php"}
PORT_DETECTABLE_RUNTIME_NAMES = (
    NODE_RUNTIME_NAMES
    | PYTHON_RUNTIME_NAMES
    | LANGUAGE_RUNTIME_NAMES
)
```

Replace the inline union in `process_to_info()`:

```python
runtime_with_port = bool(ports) and executable_name(name) in PORT_DETECTABLE_RUNTIME_NAMES
```

- [ ] **Step 4: Verify all scanner behavior**

Run:

```bash
cd backend
.venv/bin/python -m pytest tests/test_scanner.py -v
```

Expected: All scanner tests pass, including Node.js, Python, Windows, language signatures, runtime fallback, grouping, port conflict, and termination tests.

- [ ] **Step 5: Mark the scoped review finding implemented**

Replace finding 3 in `docs/REVIEW_FINDINGS.md` with:

```markdown
#### 3. **Enhanced Process Detection** ✅ **IMPLEMENTED**
- **Current**: Detects Node.js, Python, Go, Java, Rust, Ruby, and PHP development commands
- **Scope**: Exact language-tool signatures plus port-based fallback for generic Java, Ruby, and PHP runtimes
- **Remaining**: Database and Docker detection remain separate future enhancements
- **Impact**: More comprehensive monitoring coverage without broad keyword false positives
- **Status**: ✅ Language-toolchain expansion implemented
```

- [ ] **Step 6: Run full backend verification**

Run:

```bash
cd backend
.venv/bin/python -m pytest
.venv/bin/python -m compileall -q app tests
```

Expected: The full backend suite exits with zero failures and Python compilation exits successfully. Frontend verification is not required because the API schema and frontend source are unchanged.

- [ ] **Step 7: Check the final diff**

Run:

```bash
git diff --check
git diff -- backend/app/scanner.py backend/tests/test_scanner.py docs/REVIEW_FINDINGS.md
```

Expected: `git diff --check` exits successfully; the diff contains only the scoped detection, test, and finding-status changes.

- [ ] **Step 8: Commit the integration and documentation**

```bash
git add backend/app/scanner.py backend/tests/test_scanner.py docs/REVIEW_FINDINGS.md
git commit -m "feat: expand process detection coverage"
```
