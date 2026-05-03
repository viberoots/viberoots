# PRs Full-Suite Timing Memory Template

This checked-in file documents the clone-local timing memory used by `$prs`.

The mutable timing memory lives in `full-suite-timing.local.md`. Create that local file from this template when `$prs` first records a successful full-suite run.

`$prs` compares each PR's successful full-suite execution time against the most recent recorded successful full-suite execution time before authorizing a commit.

Treat a timing increase as significant when it is both at least 25% slower and at least 120 seconds slower than the most recent recorded successful run, unless repository docs or the user specify a stricter threshold.

- `last_successful_full_suite_seconds`: `unset`
- `last_successful_pr`: `unset`
- `last_successful_commit`: `unset`
- `last_successful_log`: `unset`
- `last_successful_date`: `unset`
