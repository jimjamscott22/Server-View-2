# Enhanced Language Process Detection Design

## Context

Finding 3 in `docs/REVIEW_FINDINGS.md` identifies limited development-process
detection as a high-priority gap. The current scanner recognizes Node.js and
Python development processes but does not recognize common Go, Java, Rust,
Ruby, or PHP development servers and watch commands.

This design expands language-toolchain coverage without adding databases,
container runtimes, or other infrastructure processes.

## Goals

- Detect recognized Go, Java, Rust, Ruby, and PHP development commands before
  they bind a listening port.
- Detect generic Java, Ruby, and PHP runtime processes when they own a
  listening port.
- Preserve current Node.js and Python behavior.
- Use exact, case-insensitive command signatures rather than substring
  matching.
- Preserve Windows executable-suffix handling.
- Keep the API response, data model, and frontend unchanged.

## Non-Goals

- Detecting databases, Docker, container runtimes, or infrastructure daemons.
- Identifying arbitrary compiled Go server binaries whose names provide no
  language or framework evidence.
- Adding user-configurable detection rules.
- Refactoring process scanning outside the detection logic.

## Detection Rules

The scanner will normalize the process name and command tokens with the
existing `executable_name()` and `command_tokens()` helpers. Detection will use
exact executable names and adjacent command-token signatures.

The new language signatures are:

| Ecosystem | Recognized development signatures |
| --- | --- |
| Go | `go run`, `air`, `fresh` |
| Java | Maven or Maven Wrapper with `spring-boot:run`, `quarkus:dev`, or `micronaut:run`; Gradle or Gradle Wrapper with `bootRun` or `quarkusDev` |
| Rust | `cargo run`, `cargo watch`, `cargo leptos watch`, `cargo tauri dev`, `trunk serve` |
| Ruby | `rails server`, `rails s`, `bundle exec rails server`, `bundle exec rails s`, `rackup`, `puma` |
| PHP | `php -S`, `php artisan serve`, `artisan serve`, `symfony server:start` |

Signature matching is case-insensitive after normalization. Options may appear
after a recognized signature, but unrelated commands such as `go version`,
`cargo build`, `java -version`, `ruby cleanup.rb`, and `php migrate.php` do not
qualify.

Specific development signatures qualify without a listening port. Generic
runtime names do not qualify on name alone. A `java`, `javaw`, `ruby`, or `php`
process qualifies when it owns a listening port, matching the scanner's
existing runtime-plus-port fallback for Node.js and Python.

## Architecture

Detection remains in `backend/app/scanner.py`. Small signature helpers will
separate exact token-sequence matching from ecosystem-specific policy:

- A token-sequence helper answers whether normalized command tokens contain an
  exact adjacent sequence.
- Ecosystem constants define executable names and command signatures.
- `is_dev_process()` delegates to the ecosystem signatures after applying the
  existing normalization.
- The runtime-plus-port fallback in `process_to_info()` expands to the new
  generic runtime names.

The unused `DEV_PROCESS_KEYWORDS` constant will be removed. This avoids
maintaining a misleading flat list that is not part of detection.

No new exceptions or fallback behavior are required. Existing access-denied,
missing-process, and malformed-command handling remains unchanged.

## Data Flow

1. `process_to_info()` obtains the process name, command line, and listening
   ports.
2. The process name and command tokens are normalized.
3. `is_dev_process()` checks exact development signatures.
4. If no signature matches, `process_to_info()` applies the generic
   runtime-plus-port fallback.
5. Matching processes continue through the existing resource, grouping,
   conflict, summary, REST, and WebSocket paths without schema changes.

## Testing

`backend/tests/test_scanner.py` will gain:

- Parameterized positive cases for every documented language signature.
- Parameterized negative cases for generic or build-only commands.
- Windows suffix/path cases for newly supported tools.
- `process_to_info()` coverage proving a recognized command is returned before
  it binds a port.
- `process_to_info()` coverage proving a generic new runtime is included with
  a listening port and excluded without one.

The full backend test suite will verify that existing Node.js, Python, grouping,
port-conflict, API, WebSocket, and process-termination behavior remains intact.
Because the API and frontend contracts do not change, frontend source changes
are not required.

## Documentation

After implementation and verification, finding 3 in
`docs/REVIEW_FINDINGS.md` will be marked implemented and will summarize the
language-toolchain scope. The review will continue to list databases and Docker
as excluded from this delivered scope.
