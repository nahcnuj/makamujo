#!/usr/bin/env bash
set -euo pipefail

project_root=$(cd "$(dirname "$0")/.." && pwd)
cd "${project_root}"

vrt_dir="tests/vrt"
baseline_dir="${vrt_dir}/baseline"

mkdir -p "${baseline_dir}"

status=0

# Run every test case (any non-PNG file) so it can (re)generate its actual image.
for case_file in "${vrt_dir}"/*; do
    [ -f "${case_file}" ] || continue
    case "${case_file}" in
        *.png) continue ;;
    esac

    case "${case_file}" in
        *.sh)
            bash "${case_file}" || status=1
            ;;
        *.ts)
            bun run "${case_file}" || status=1
            ;;
        *.py)
            python3 "${case_file}" || status=1
            ;;
        *)
            if [ -x "${case_file}" ]; then
                "${case_file}" || status=1
            else
                echo "Unknown VRT case (not executable): ${case_file}" >&2
                status=1
            fi
            ;;
    esac
done

# Compare each actual output (tests/vrt/*.png) with its baseline.
for actual in "${vrt_dir}"/*.png; do
    [ -f "${actual}" ] || continue
    name=$(basename "${actual}")
    stem="${name%.png}"
    baseline="${baseline_dir}/${stem}.png"

    if [ ! -f "${baseline}" ]; then
        echo "VRT: missing baseline for ${name} (${baseline})" >&2
        status=1
        continue
    fi

    if ! cmp -s "${actual}" "${baseline}"; then
        echo "VRT: mismatch for ${name}" >&2
        status=1
    fi
done

exit "${status}"