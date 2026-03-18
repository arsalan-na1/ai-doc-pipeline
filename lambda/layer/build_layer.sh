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

# Check if Docker is available
if command -v docker &> /dev/null; then
    echo ""
    echo "[1/3] Building with Docker (Amazon Linux 2023)..."
    docker run --rm -v "$SCRIPT_DIR":/out public.ecr.aws/lambda/python:$PYTHON_VERSION bash -c "
        pip install --no-cache-dir \
            PyMuPDF==1.25.3 \
            pdfplumber==0.11.4 \
            openai==1.68.0 \
            -t /out/python/lib/python${PYTHON_VERSION}/site-packages/
        # Remove unnecessary files to reduce size
        find /out/python -type d -name '__pycache__' -exec rm -rf {} + 2>/dev/null || true
        find /out/python -type d -name '*.dist-info' -exec rm -rf {} + 2>/dev/null || true
        find /out/python -type d -name 'tests' -exec rm -rf {} + 2>/dev/null || true
        find /out/python -name '*.pyc' -delete 2>/dev/null || true
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
        openai==1.68.0 \
        -t "$SCRIPT_DIR/python/lib/python${PYTHON_VERSION}/site-packages/" \
        --platform manylinux2014_x86_64 \
        --only-binary=:all:
fi

echo ""
echo "[2/3] Creating zip archive..."
cd "$SCRIPT_DIR"
zip -r9 "$OUTPUT_ZIP" python/

echo ""
echo "[3/3] Verifying..."
ZIP_SIZE=$(du -sh "$OUTPUT_ZIP" | cut -f1)
echo "  Output: $OUTPUT_ZIP"
echo "  Size:   $ZIP_SIZE"
echo ""

# Check size limits
ZIP_BYTES=$(wc -c < "$OUTPUT_ZIP")
if [ "$ZIP_BYTES" -gt 52428800 ]; then
    echo "  WARNING: Zip exceeds 50MB Lambda Layer limit!"
    echo "  Consider removing unused packages or using a smaller subset."
else
    echo "  Layer is within the 50MB Lambda limit."
fi

echo ""
echo "Done! Upload with:"
echo "  aws lambda publish-layer-version \\"
echo "    --layer-name ai-doc-pipeline-deps \\"
echo "    --compatible-runtimes python${PYTHON_VERSION} \\"
echo "    --zip-file fileb://$OUTPUT_ZIP"

# Clean up extracted directory
rm -rf "$SCRIPT_DIR/python"
