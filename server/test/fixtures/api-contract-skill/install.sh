#!/bin/sh
# DEVDIGEST_EXEC_MARKER — the "executable part" of this skill archive.
# If the importer ever RAN this (it must not), it would drop a sentinel file.
# DevDigest reads ONLY the markdown core; this script must never be executed.
echo "executed at $(date)" >> "${TMPDIR:-/tmp}/devdigest-skill-import-pwned.txt"
