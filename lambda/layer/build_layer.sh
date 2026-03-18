#!/bin/bash
# ============================================================================
# Lambda Layer Builder for PyMuPDF + pdfplumber
# Builds a Lambda-compatible layer using Docker (Amazon Linux 2023)
# ============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUTPUT_ZIP="$SCRIPT_DIR/lambda-layer.zip"
PYTHON_VERSION="3.11"

echo "========================================="
echo "  Lambda Layer Builder"
echo "  Python $PYTHON_VERSION | PyMuPDF + pdfplumber"
echo "========================================="

# Clean previous builds
rm -rf "$SCRIPT_DIR/python" "$OUTPUT_ZIP"

# Convert Git Bash path to Windows path for Docker volume mount
if [[ "$OSTYPE" == "msys" ]] || [[ "$OSTYPE" == "mingw"* ]]; then
    # Windows (Git Bash / MSYS2) - convert /c/Users/... to C:/Users/...
    DOCKER_MOUNT_DIR="$(cygpath -w "$SCRIPT_DIR")"
else
    DOCKER_MOUNT_DIR="$SCRIPT_DIR"
fi

if command -v docker &> /dev/null; then
    echo ""
    echo "[1/3] Building with Docker (Lambda Python 3.11 image)..."
    MSYS_NO_PATHCONV=1 docker run --rm --entrypoint bash \
        -v "${DOCKER_MOUNT_DIR}:/out" \
        public.ecr.aws/lambda/python:$PYTHON_VERSION -c "
        yum install -y zip > /dev/null 2>&1
        pip install --no-cache-dir --only-binary=:all: \
            PyMuPDF==1.25.3 \
            pdfplumber==0.11.4 \
            'openai>=1.60.0,<2' \
            -t /out/python/lib/python${PYTHON_VERSION}/site-packages/
        # Remove numpy - openai lists it as optional and we don't need it
        rm -rf /out/python/lib/python${PYTHON_VERSION}/site-packages/numpy*
        # Remove unnecessary files to reduce size
        find /out/python -type d -name '__pycache__' -exec rm -rf {} + 2>/dev/null || true
        find /out/python -type d -name '*.dist-info' -exec rm -rf {} + 2>/dev/null || true
        find /out/python -type d -name 'tests' -exec rm -rf {} + 2>/dev/null || true
        find /out/python -name '*.pyc' -delete 2>/dev/null || true
        cd /out && zip -r9 lambda-layer.zip python/
    "
else
    echo ""
    echo "[!] Docker not found. Attempting local pip install..."
    echo "    WARNING: This may not work on Windows/macOS. Use Docker or WSL for best results."
    echo ""
    echo "[1/3] Installing packages locally..."
    pip install --no-cache-dir \
        PyMuPDF==1.25.3 \
        pdfplumber==0.11.4 \
        'openai>=1.60.0,<2' \
        'numpy<2.1' \
        -t "$SCRIPT_DIR/python/lib/python${PYTHON_VERSION}/site-packages/" \
        --platform manylinux2014_x86_64 \
        --only-binary=:all:
    cd "$SCRIPT_DIR"
    zip -r9 "$OUTPUT_ZIP" python/
fi

echo ""
echo "[2/3] Verifying..."
if [ -f "$OUTPUT_ZIP" ]; then
    ZIP_SIZE=$(du -sh "$OUTPUT_ZIP" | cut -f1)
    echo "  Output: $OUTPUT_ZIP"
    echo "  Size:   $ZIP_SIZE"
else
    echo "  [ERROR] lambda-layer.zip was not created!"
    exit 1
fi

echo ""
ZIP_BYTES=$(wc -c < "$OUTPUT_ZIP")
if [ "$ZIP_BYTES" -gt 52428800 ]; then
    echo "  WARNING: Zip exceeds 50MB Lambda Layer limit!"
    echo "  Consider removing unused packages."
else
    echo "  [3/3] Layer is within the 50MB Lambda limit. Ready to deploy."
fi

# Clean up extracted directory
rm -rf "$SCRIPT_DIR/python"

echo ""
echo "Done!"
