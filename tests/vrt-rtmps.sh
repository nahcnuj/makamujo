#!/usr/bin/env bash
set -euo pipefail

project_root=$(cd "$(dirname "$0")/.." && pwd)
cd "${project_root}"

vrt_dir="${1:-tests/vrt-rtmps}"
baseline_dir="${vrt_dir}/baseline"

mkdir -p "${baseline_dir}"

status=0

# Run every executable test case so it can (re)generate its actual image.
for case_file in "${vrt_dir}"/*; do
    [ -f "${case_file}" ] || continue
    # Skip generated images and other non-case files.
    case "${case_file}" in
      *.png|*.jpg|*.jpeg) continue ;;
    esac
    # Case files are normally executable, but commits created through the
    # GitHub API cannot carry the executable bit, so fall back to bash for
    # shell scripts that lost it.
    if [ -x "${case_file}" ]; then
        "${case_file}" || status=1
    elif [[ "${case_file}" == *.sh ]]; then
        bash "${case_file}" || status=1
    else
        continue
    fi

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
        if [ -f "${actual}" ]; then
            cp "${actual}" "${baseline}"
            echo "VRT: created baseline for ${stem} (${baseline})"
        else
            echo "VRT: missing baseline for ${stem} (${baseline})" >&2
            status=1
            continue
        fi
    fi

    if ! cmp -s "${actual}" "${baseline}"; then
        echo "VRT: mismatch for ${stem}.png" >&2
        status=1
    fi
done

exit "${status}"
