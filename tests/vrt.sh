#!/usr/bin/env bash
set -euo pipefail

project_root=$(cd "$(dirname "$0")/.." && pwd)
cd "${project_root}"

vrt_dir="tests/vrt"
baseline_dir="${vrt_dir}/baseline"

mkdir -p "${baseline_dir}"

status=0

# Run every executable test case so it can (re)generate its actual image.
for case_file in "${vrt_dir}"/*; do
    [ -f "${case_file}" ] || continue
    # Only treat files that look like scripts (start with a shebang) as test
    # cases. This skips generated PNG outputs and other non-script files.
    [ "$(head -c 2 "${case_file}")" = "#!" ] || continue
    # The executable bit may be lost when commits are created through the
    # GitHub API, so ensure the case is runnable before invoking it.
    chmod +x "${case_file}" 2>/dev/null || true

    "${case_file}" || status=1

    # Compare the corresponding actual output with its baseline right away.
    base=$(basename "${case_file}")
    stem="${base%.*}"
    actual="${vrt_dir}/${stem}.png"
    baseline="${baseline_dir}/${stem}.png"

    if [ ! -f "${actual}" ]; then
        echo "VRT: missing actual output for ${stem} (${actual})" >&2
        status=1
        continue
    fi

    if [ ! -f "${baseline}" ]; then
        echo "VRT: missing baseline for ${stem} (${baseline})" >&2
        status=1
        continue
    fi

    if ! cmp -s "${actual}" "${baseline}"; then
        echo "VRT: mismatch for ${stem}.png" >&2
        status=1
    fi
done

exit "${status}"
