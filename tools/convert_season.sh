#!/usr/bin/env bash
# Converts a whole season of team PDFs and rebuilds the catalog.
#   tools/convert_season.sh <folder with Team1984.PDF files> <year> [folder with WPF xml files]
# Run from the project folder. Needs: pip install pdfplumber
set -euo pipefail
src="$1"; year="$2"; xml="${3:-}"
out="public/cards/teams/$year"; mkdir -p "$out"
for pdf in "$src"/*"$year".PDF "$src"/*"$year".pdf; do
  [ -e "$pdf" ] || continue
  stem=$(basename "$pdf"); stem="${stem%$year.*}"; name=$(echo "$stem" | tr '[:upper:]' '[:lower:]')
  python3 tools/pdf_to_team.py "$pdf" "$out/$name.json"
  if [ -n "$xml" ] && [ -e "$xml/$name.xml" ]; then
    python3 tools/xml_to_team.py "$xml/$name.xml" "/tmp/$name-xml.json" > /dev/null
    extra=""; [ "$name" = "patriots" ] && extra="--extras-only"   # Patriots XML verified to have typos only
    python3 tools/merge_xml.py "$out/$name.json" "/tmp/$name-xml.json" $extra
  fi
done
python3 tools/build_catalog.py
