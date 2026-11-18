#!/usr/bin/env bash
set -euo pipefail

# Visual Regression Test cases for the non-RTMPS path. Each case regenerates
# its actual image, which is then compared byte-for-byte with the committed
# baseline.

project_root=$(cd "$(dirname "$0")/.." && pwd)
cd "${project_root}"

vrt_dir="tests/vrt"
baseline_dir="${vrt_dir}/baseline"

mkdir -p "${baseline_dir}"

status=0
cases_executed=0

for case_file in "${vrt_dir}"/*; do
    [ -f "${case_file}" ] || continue
    case "${case_file}" in
        *.png|*.jpg|*.jpeg) continue ;;
    esac

    base=$(basename "${case_file}")
    stem="${base%.*}"
    actual="${vrt_dir}/${stem}.png"
    baseline="${baseline_dir}/${stem}.png"

    if [ -x "${case_file}" ]; then
        "${case_file}" || status=1
    elif [[ "${case_file}" == *.sh ]]; then
        bash "${case_file}" || status=1
    elif [[ "${case_file}" == *.py ]]; then
        python3 "${case_file}" || status=1
    else
        continue
    fi
    cases_executed=$((cases_executed + 1))

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

if [ "${cases_executed}" -eq 0 ]; then
    echo "VRT: no VRT case was executed in ${vrt_dir}" >&2
    status=1
fi

exit "${status}"
